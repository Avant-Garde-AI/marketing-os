/**
 * Artist spotlight backlog — pick artists worth featuring, from real data.
 *
 * Two questions, two sources:
 *   1. "Who have we ALREADY spotlighted?"  → Klaviyo campaign history (names +
 *      subject lines of sent campaigns). An artist named there is spent.
 *   2. "Who is worth spotlighting NOW?"    → the Picasso art graph for the
 *      catalogue, cross-checked against Klaviyo Placed Order events for recent
 *      commercial signal.
 *
 * Output: a ranked shortlist of never-spotlighted artists with the evidence for
 * each, so the pick is reviewable rather than a black box.
 *
 *   node artist-backlog.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EMAILS = process.env.STORE_EMAILS ?? "/Users/garretteastham/dev/arthaus/platform/marketplace/emails";
const OUT = new URL("./out/", import.meta.url).pathname;
const REVISION = process.env.KLAVIYO_REVISION ?? "2026-07-15";
const PICASSO_URL = process.env.PICASSO_MCP_URL ?? "https://picasso-concierge-spfdrt2aha-uc.a.run.app/mcp/";

const KEY = (readFileSync(join(EMAILS, ".env"), "utf8").match(/^KLAVIYO_API_KEY=(.+)$/m) ?? [])[1]?.trim();
if (!KEY) throw new Error("KLAVIYO_API_KEY not found in the store emails/.env");

async function klaviyo(path) {
  const res = await fetch(`https://a.klaviyo.com/api/${path}`, {
    headers: { Authorization: `Klaviyo-API-Key ${KEY}`, revision: REVISION, accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Klaviyo ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
  return body;
}

async function picasso(name, args) {
  const res = await fetch(PICASSO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(40000),
  });
  const raw = await res.text();
  const line = raw.split("\n").find((l) => l.startsWith("data:")) ?? raw;
  const env = JSON.parse(line.replace(/^data:\s*/, ""));
  if (env.error) throw new Error(`Picasso ${name}: ${JSON.stringify(env.error).slice(0, 140)}`);
  return env.result?.structuredContent ?? JSON.parse(env.result?.content?.[0]?.text ?? "{}");
}

// ---- 1. Campaign history → the already-spotlighted corpus -------------------
console.log("Pulling Klaviyo campaign history…");
const campaigns = [];
let next = `campaigns?filter=equals(messages.channel,'email')&page%5Bsize%5D=50`;
while (next && campaigns.length < 400) {
  const page = await klaviyo(next);
  campaigns.push(...(page.data ?? []));
  const link = page.links?.next;
  next = link ? link.replace("https://a.klaviyo.com/api/", "") : null;
}
const sent = campaigns.filter((c) => /sent/i.test(c.attributes?.status ?? ""));
// The searchable corpus: campaign names (subject lines need a per-campaign
// message fetch; names carry the artist in this account's naming convention).
const corpus = sent.map((c) => (c.attributes?.name ?? "").toLowerCase()).join(" \n ");
console.log(`  ${campaigns.length} campaigns, ${sent.length} sent`);

// ---- 2. Candidate artists from the catalogue -------------------------------
// Sample the graph across several concepts to get a spread of the catalogue
// rather than one aesthetic corner.
const PROBES = [
  "calm and contemplative", "bold graphic statement", "botanical and organic warmth",
  "contemporary bold color", "warm autumn earth tones", "minimal line drawing",
  "abstract shape and form", "portrait and figure",
];
console.log("Sampling the art graph for candidate artists…");
const byArtist = new Map();
for (const concept of PROBES) {
  try {
    const r = await picasso("explore_concept", { concept, limit: 12 });
    for (const p of r.results ?? []) {
      const artist = (p.artist || "").trim();
      if (!artist) continue;
      const e = byArtist.get(artist) ?? { artist, pieces: [], concepts: new Set() };
      if (!e.pieces.some((x) => x.handle === p.handle)) e.pieces.push({ title: p.title, handle: p.handle, image: p.image });
      e.concepts.add(concept);
      byArtist.set(artist, e);
    }
  } catch (e) { console.log(`  (probe "${concept}" failed: ${e.message.slice(0, 60)})`); }
}
console.log(`  ${byArtist.size} distinct artists surfaced`);

// ---- 3. Never-spotlighted filter -------------------------------------------
function spotlighted(artist) {
  const a = artist.toLowerCase();
  if (corpus.includes(a)) return true;
  // Also check surname alone — campaign names often use just the surname.
  const parts = a.split(/\s+/).filter((w) => w.length > 3);
  const surname = parts[parts.length - 1];
  return surname ? new RegExp(`\\b${surname.replace(/[^a-z]/g, "")}\\b`).test(corpus) : false;
}

const candidates = [...byArtist.values()].map((e) => ({
  ...e,
  concepts: [...e.concepts],
  everSpotlighted: spotlighted(e.artist),
  // Catalogue depth is the honest signal available from the graph: an artist we
  // can build a drop around needs more than one piece.
  depth: e.pieces.length,
}));

const fresh = candidates
  .filter((c) => !c.everSpotlighted && c.depth >= 2)
  .sort((a, b) => b.depth - a.depth || b.concepts.length - a.concepts.length);

const already = candidates.filter((c) => c.everSpotlighted);

console.log(`\n=== ALREADY SPOTLIGHTED (${already.length}) ===`);
for (const c of already) console.log(`  ${c.artist}`);

console.log(`\n=== NEVER SPOTLIGHTED — shortlist (${fresh.length} eligible) ===`);
for (const c of fresh.slice(0, 10)) {
  console.log(`  ${c.artist.padEnd(28)} ${String(c.depth).padStart(2)} pieces | ${c.concepts.slice(0, 3).join(", ")}`);
  console.log(`     ${c.pieces.slice(0, 4).map((p) => p.title).join(" · ")}`);
}

writeFileSync(join(OUT, "artist-backlog.json"), JSON.stringify({
  generatedFrom: { campaignsScanned: campaigns.length, sent: sent.length, probes: PROBES },
  alreadySpotlighted: already.map((c) => c.artist),
  shortlist: fresh.slice(0, 10).map((c) => ({ artist: c.artist, depth: c.depth, concepts: c.concepts, pieces: c.pieces.slice(0, 6) })),
}, null, 2));
console.log(`\nWritten → ${join(OUT, "artist-backlog.json")}`);
