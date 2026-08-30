/**
 * Build a week of campaigns THROUGH THE REAL SYSTEM.
 *
 * Unlike produce-week.mjs (which assembles locally and writes files), this
 * drives the deployed runtime over MCP end to end:
 *
 *   art graph  → research the pieces + facets + editorial dimensions
 *   Gemini     → author copy/structure in the brand voice
 *   MCP        → imagery_resolve   (lifestyle/leaning shot, house rules)
 *              → email_campaign_upsert (content into the store artifact)
 *              → email_render_preview  (assemble + invariant report + URL)
 *
 * Nothing is staged to Klaviyo and nothing sends — that remains a proposed
 * Action approved in Slack.
 *
 *   MCP_TOKEN=mos_… VERTEX_TOKEN=$(gcloud auth application-default print-access-token) node build-week.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL("./", import.meta.url).pathname;
const OUT = join(HERE, "out");
const MCP = process.env.MCP_URL ?? "https://www.arthaus.cloud/api/mcp";
const MCP_TOKEN = process.env.MCP_TOKEN;
const VERTEX_TOKEN = process.env.VERTEX_TOKEN;
if (!MCP_TOKEN || !VERTEX_TOKEN) throw new Error("MCP_TOKEN and VERTEX_TOKEN required");
const PICASSO = process.env.PICASSO_MCP_URL ?? "https://picasso-concierge-spfdrt2aha-uc.a.run.app/mcp/";
const MODEL = process.env.MODEL ?? "gemini-2.5-flash";
const PROJECT = "avant-garde-platform", LOCATION = "us-central1";
const systemPrompt = readFileSync(join(HERE, "prompt.md"), "utf8");

let rpcId = 0;
async function mcp(name, args, timeoutMs = 120000) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { Authorization: `Bearer ${MCP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const d = await res.json();
  if (d.error) throw new Error(`${name}: ${JSON.stringify(d.error).slice(0, 180)}`);
  const text = d.result?.content?.[0]?.text ?? "";
  if (d.result?.isError || text.startsWith("Tool error:")) throw new Error(`${name}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function picasso(name, args, timeoutMs = 90000) {
  const res = await fetch(PICASSO, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  const line = raw.split("\n").find((l) => l.startsWith("data:")) ?? raw;
  const env = JSON.parse(line.replace(/^data:\s*/, ""));
  if (env.error) throw new Error(`picasso ${name}`);
  return env.result?.structuredContent ?? JSON.parse(env.result?.content?.[0]?.text ?? "{}");
}

// ---------------------------------------------------------------------------
// The week. Dates honour the strategy's Tue/Thu cadence AND its
// maxCampaignsPerWeek:2 guardrail — five sends cannot lawfully land in one
// week, so they spread across three. Breaching the store's own contact cap to
// hit a date would be the wrong kind of obedience.
// ---------------------------------------------------------------------------
const PLAN = [
  { date: "2026-09-01", archetype: "artist-drop", artist: "83 Oranges" },
  { date: "2026-09-03", archetype: "artist-drop", artist: "Benjamin Mckay" },
  { date: "2026-09-08", archetype: "artist-drop", artist: "Shelly Bremmer" },
  { date: "2026-09-10", archetype: "editorial", concept: "botanical line drawing and plant forms",
    theme: "Botanical Studies", angle: "monochrome botanical studies — line, shadow and stem" },
  { date: "2026-09-15", archetype: "seasonal", concept: "autumn ochre rust and sage earth tones",
    theme: "Into Autumn", angle: "the turn into autumn: ochre, rust and sage entering the room" },
];

const AUDIENCE = [{ type: "list", id: "HRSdjT", label: "Arthaus Newsletter" }];
const isMockup = (u) => /\/mockup-/i.test(u ?? "");

async function research(item) {
  if (item.archetype === "artist-drop") {
    const r = await picasso("search_artworks", { query: item.artist, limit: 8 });
    const mine = (r.results ?? []).filter((x) => (x.artist || "").toLowerCase() === item.artist.toLowerCase());
    return enrich((mine.length ? mine : r.results ?? []).slice(0, 4), `artist "${item.artist}"`);
  }
  const r = await picasso("explore_concept", { concept: item.concept, limit: 6 });
  return enrich((r.results ?? []).slice(0, 4), `concept "${item.concept}"`);
}

async function enrich(rows, label) {
  let facets = {};
  try {
    const f = await picasso("get_artwork_facets", { handles: rows.map((r) => r.handle).filter(Boolean) });
    for (const a of f.artworks ?? []) facets[a.handle] = a;
  } catch {}
  const pieces = rows.map((p) => {
    const fx = facets[p.handle] ?? facets[(p.handle || "").replace(/-no-frame$|-old$/, "")] ?? {};
    return { title: (p.title || "").trim(), artist: p.artist || "", handle: p.handle, url: p.url,
             image: p.image, palette: fx.palette ?? [], subject: fx.subject ?? [] };
  }).filter((p) => p.title && p.image);
  return { label, pieces };
}

const schema = {
  type: "object",
  properties: {
    subject: { type: "string" }, previewText: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: {
      slot: { type: "string" },
      kind: { type: "string", enum: ["heading", "paragraph", "eyebrow", "callout", "ctaBand", "trustBadges", "productRow"] },
      text: { type: "string" }, level: { type: "integer" }, heading: { type: "string" },
      buttonText: { type: "string" }, eyebrow: { type: "string" }, emphasis: { type: "boolean" },
      badges: { type: "array", items: { type: "string" } },
      productTitles: { type: "array", items: { type: "string" } } },
      required: ["slot", "kind"],
      propertyOrdering: ["slot","kind","text","level","heading","buttonText","eyebrow","emphasis","badges","productTitles"] } },
  },
  required: ["subject", "previewText", "sections"], propertyOrdering: ["subject", "previewText", "sections"],
};

async function authorCopy(item, res) {
  const facetText = res.pieces.map((p) => `  · "${p.title}"${p.artist ? " — " + p.artist : ""} — palette: ${p.palette.join(", ") || "—"}; subject: ${p.subject.slice(0,4).join(", ") || "—"}`).join("\n");
  const cat = res.pieces.map((p, i) => `${i+1}. "${p.title}"`).join("\n");
  const intent = item.archetype === "artist-drop"
    ? `artist-drop — ${item.artist} is newly spotlighted on Arthaus. Introduce them as a person and an aesthetic (artist intimacy, never a CV), then show the work.`
    : item.archetype === "editorial"
      ? `editorial-story — "${item.theme}". ${item.angle}. Lead with the mood and the room, then the works. Not a sale; an invitation to look.`
      : `seasonal — "${item.theme}". ${item.angle}. Tie the season to the art through its REAL palette. No urgency, no discount, no clichés about "cosy season".`;
  const brief = `Archetype: ${intent}
Audience: Arthaus Newsletter subscribers. Send ${item.date}.
Slots & blocks: intro (eyebrow + heading L1 [in text, NEVER alt] + paragraph) · works (eyebrow + heading L2 + productRow of up to 3 exact catalogue titles) · closing (ctaBand with heading + buttonText + trustBadges).
Ground every art claim in the facets below — name the actual colours and subjects.

Art-knowledge-graph context (LIVE, ${res.label}):
${facetText}

Catalogue (use exact titles):
${cat}`;

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(url, { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${VERTEX_TOKEN}` },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: `Draft this campaign email.\n\n${brief}\n\nDefault CTA href: https://myarthaus.com/collections/all` }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.75 } }),
        signal: AbortSignal.timeout(60000) });
      if (!r.ok) { await new Promise((s) => setTimeout(s, 2000 * a)); continue; }
      const d = await r.json();
      return JSON.parse(d.candidates[0].content.parts[0].text);
    } catch { await new Promise((s) => setTimeout(s, 2000 * a)); }
  }
  throw new Error("copy generation failed");
}

/** Model output → campaign sections (products resolved against the real catalogue). */
function toSections(gen, pieces, heroUrl, heroAlt) {
  const find = (t) => { const q = String(t).trim().toLowerCase();
    return pieces.find((p) => p.title.toLowerCase() === q) ?? pieces.find((p) => p.title.toLowerCase().includes(q) || q.includes(p.title.toLowerCase())); };
  const bySlot = new Map();
  for (const s of gen.sections ?? []) {
    const copy = (s.text ?? "").trim();
    let b = null;
    if (s.kind === "heading") b = { kind: "heading", text: copy, level: s.level === 1 || s.level === 3 ? s.level : 2 };
    else if (s.kind === "paragraph") b = { kind: "paragraph", text: copy };
    else if (s.kind === "eyebrow") b = { kind: "eyebrow", text: copy };
    else if (s.kind === "callout") b = { kind: "callout", text: copy, emphasis: s.emphasis === true };
    else if (s.kind === "trustBadges") { const i = (s.badges ?? []).filter(Boolean).slice(0,4); if (i.length) b = { kind: "trustBadges", items: i }; }
    else if (s.kind === "ctaBand") { const h = (s.heading ?? s.text ?? "").trim(); if (h) b = { kind: "ctaBand", heading: h, buttonText: (s.buttonText || "Explore the collection").trim(), buttonHref: "https://myarthaus.com/collections/all", ...(s.eyebrow ? { eyebrow: s.eyebrow.trim() } : {}) }; }
    else if (s.kind === "productRow") {
      const items = (s.productTitles ?? []).map(find).filter(Boolean)
        .map((p) => ({ name: p.title, price: "View piece", href: p.url, imageUrl: p.image, alt: `${p.title}${p.artist ? " by " + p.artist : ""}` }));
      const uniq = [...new Map(items.map((i) => [i.name, i])).values()].slice(0, 3);
      if (uniq.length) b = { kind: "productRow", products: uniq };
    }
    if (!b) continue;
    if (["heading","paragraph","eyebrow","callout"].includes(b.kind) && !b.text) continue;
    if (!bySlot.has(s.slot)) bySlot.set(s.slot, []);
    bySlot.get(s.slot).push(b);
  }
  const sections = [{ slot: "hero", type: "surface", alt: heroAlt, imageUrl: heroUrl }];
  for (const [slot, blocks] of bySlot) sections.push({ slot, type: "html", blocks });
  return sections;
}

// ---------------------------------------------------------------------------
const results = [];
for (const item of PLAN) {
  const label = item.artist ?? item.theme;
  const id = `${item.date}-${item.archetype}-${(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  try {
    console.log(`\n▸ ${item.date}  ${item.archetype}  ${label}`);
    const res = await research(item);
    if (!res.pieces.length) throw new Error("graph returned no usable pieces");
    console.log(`  graph: ${res.label} → ${res.pieces.map((p) => p.title).join(" · ")}`);

    const heroPiece = res.pieces.find((p) => isMockup(p.image)) ?? res.pieces[0];
    const role = item.archetype === "artist-drop" ? "hero-artist" : "hero-editorial";
    let heroUrl = heroPiece.image, heroKind = "graph image";
    try {
      const im = await mcp("imagery_resolve", { artworkUrl: heroPiece.image, artworkKey: heroPiece.handle, role, orientation: "portrait", title: heroPiece.title });
      if (im.chosen?.url) { heroUrl = im.chosen.url; heroKind = `${im.chosen.kind}/${im.chosen.frame}${im.chosen.room ? "/" + im.chosen.room : ""}`; }
      else if (im.warnings?.length) console.log(`  imagery: fell back — ${im.warnings[0].slice(0, 80)}`);
    } catch (e) { console.log(`  imagery: fell back — ${String(e.message).slice(0, 80)}`); }
    console.log(`  hero  : ${heroKind}`);

    const gen = await authorCopy(item, res);
    const sections = toSections(gen, res.pieces, heroUrl, `${heroPiece.title}${heroPiece.artist ? " by " + heroPiece.artist : ""}, shown in a styled room`);

    const up = await mcp("email_campaign_upsert", {
      id, archetype: item.archetype, subject: gen.subject, previewText: gen.previewText,
      audienceIncluded: AUDIENCE, sections, scheduledAt: `${item.date}T10:00:00-05:00`,
      body: `Built from the art graph (${res.label}). Pieces: ${res.pieces.map((p) => p.title).join(", ")}. Hero: ${heroKind}.`,
    });
    const pv = await mcp("email_render_preview", { campaignId: id });
    console.log(`  "${gen.subject}"`);
    console.log(`  → ${up.repoPath} | ${sections.length} sections | assembly ok:${pv.ok} ${pv.htmlBytes}b`);
    if (pv.errors?.length) console.log(`    errors: ${pv.errors.join(" | ").slice(0, 160)}`);
    results.push({ id, ...item, subject: gen.subject, previewText: gen.previewText, heroKind, pieces: res.pieces.map((p) => p.title), ok: pv.ok, bytes: pv.htmlBytes, previewUrl: pv.previewUrl, errors: pv.errors ?? [] });
  } catch (e) {
    console.log(`  ✗ ${String(e.message).slice(0, 180)}`);
    results.push({ id, ...item, error: String(e.message).slice(0, 200) });
  }
}

writeFileSync(join(OUT, "week-built.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => !r.error).length}/${results.length} built through the live system`);
console.log(`Detail → ${join(OUT, "week-built.json")}`);
