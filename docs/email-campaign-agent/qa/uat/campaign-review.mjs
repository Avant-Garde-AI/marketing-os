/**
 * Campaign review — the full loop in one page: STRATEGY → CALENDAR → CAMPAIGN →
 * RENDERED EMAIL. This is the artifact to look at and iterate on.
 *
 *   1. parseStrategy(strategy.md) + proposeEmailPlan(month)  [the real planner]
 *   2. pick a slot (default: the artist-drop) → query the LIVE Picasso graph
 *   3. Gemini authors copy/structure from the archetype brief + graph facts
 *   4. assembleEmail() on the store's real partials → the email
 *
 *   VERTEX_TOKEN=$(gcloud auth application-default print-access-token) \
 *     node campaign-review.mjs [month] [archetype]
 *   e.g. node campaign-review.mjs 2026-09 artist-drop
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MO = process.env.MOS_ROOT ?? "/Users/garretteastham/dev/avant-garde/platform/marketing-os";
const EMAILS = process.env.STORE_EMAILS ?? "/Users/garretteastham/dev/arthaus/platform/marketplace/emails";
const BRAND = process.env.STORE_BRAND ?? "/Users/garretteastham/dev/arthaus/platform/marketplace/agents/brand";
const STRATEGY = process.env.STRATEGY_MD ?? join(MO, "docs/email-campaign-agent/strategy.arthaus.draft.md");
const HERE = new URL("./", import.meta.url).pathname;
const OUT = join(HERE, "out");

const MONTH = process.argv[2] ?? "2026-09";
const WANT = process.argv[3] ?? "artist-drop";
const MODEL = process.env.MODEL ?? "gemini-2.5-flash";
const TEMP = Number(process.env.TEMP ?? "0.7");
const PROJECT = process.env.VERTEX_PROJECT ?? "avant-garde-platform";
const LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";
const TOKEN = process.env.VERTEX_TOKEN?.trim();
if (!TOKEN) throw new Error("VERTEX_TOKEN not set");
const PICASSO_URL = process.env.PICASSO_MCP_URL ?? "https://picasso-concierge-spfdrt2aha-uc.a.run.app/mcp/";

const { compileDesignTokens } = await import(`${MO}/packages/brand-md/dist/index.js`);
const { composePartials, assembleEmail } = await import(`${MO}/packages/email-assembly/dist/index.js`);
const { parseStrategy, proposeEmailPlan } = await import(`${MO}/packages/skills/email-campaign/dist/index.js`);

const tokens = compileDesignTokens(readFileSync(join(BRAND, "DESIGN.md"), "utf8"), { compiledAt: "1970-01-01T00:00:00.000Z" });
const partials = {};
for (const f of readdirSync(join(EMAILS, "partials"))) if (f.endsWith(".html")) partials[f.replace(/\.html$/, "")] = readFileSync(join(EMAILS, "partials", f), "utf8");
const systemPrompt = readFileSync(join(HERE, "prompt.md"), "utf8");

// ---- 1. Strategy → calendar (the real planner) ------------------------------
const strategy = parseStrategy(readFileSync(STRATEGY, "utf8"));
const plan = proposeEmailPlan(strategy, { month: MONTH, context: { seasonal: "Autumn palette — ochre, rust, sage" } });
const slot = plan.slots.find((s) => s.archetype === WANT) ?? plan.slots[0];

// ---- 2. Archetype → live art-graph query ------------------------------------
async function callPicasso(name, args) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 40000);
  try {
    const res = await fetch(PICASSO_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), signal: ac.signal });
    if (!res.ok) throw new Error(`Picasso ${name} ${res.status}`);
    const raw = await res.text();
    const line = raw.split("\n").find((l) => l.startsWith("data:")) ?? raw;
    const env = JSON.parse(line.replace(/^data:\s*/, ""));
    if (env.error) throw new Error(`Picasso ${name}: ${JSON.stringify(env.error).slice(0, 140)}`);
    return env.result?.structuredContent ?? JSON.parse(env.result?.content?.[0]?.text ?? "{}");
  } finally { clearTimeout(timer); }
}

const GRAPH_BY_ARCHETYPE = {
  "artist-drop": { kind: "artist", artist: process.env.ARTIST ?? "Judy Kaufmann" },
  editorial: { kind: "concept", concept: "calm and contemplative" },
  "set-feature": { kind: "set", seedConcept: "bold graphic statement" },
  "room-recommendation": { kind: "concept", concept: "calm art for a bedroom reading nook" },
  "new-arrivals": { kind: "concept", concept: "contemporary bold color" },
  seasonal: { kind: "concept", concept: "warm autumn earth tones" },
};

async function enrich(results, n) {
  const picks = results.slice(0, n);
  let facets = {};
  try { const f = await callPicasso("get_artwork_facets", { handles: picks.map((r) => r.handle).filter(Boolean) }); for (const a of f.artworks ?? []) facets[a.handle] = a; } catch {}
  return picks.map((r) => {
    const fx = facets[r.handle] ?? facets[(r.handle || "").replace(/-no-frame$|-old$/, "")] ?? {};
    return { title: (r.title || "").trim(), vendor: r.artist || "", handle: r.handle, price: (r.price && r.price.trim()) || "View piece", href: r.url, imageUrl: r.image, palette: fx.palette ?? [], subject: fx.subject ?? [] };
  }).filter((p) => p.title);
}

async function loadGraph(g, n = 4) {
  if (g.kind === "artist") {
    const r = await callPicasso("search_artworks", { query: g.artist, limit: n + 2 });
    const only = (r.results ?? []).filter((x) => (x.artist || "").toLowerCase() === g.artist.toLowerCase());
    return { label: `artist "${g.artist}"`, pieces: await enrich(only.length ? only : r.results ?? [], n) };
  }
  if (g.kind === "set") {
    const seed = await callPicasso("explore_concept", { concept: g.seedConcept, limit: 1 });
    const h = seed.results?.[0]?.handle;
    const rec = h ? await callPicasso("recommend_similar", { seed_handles: [h], limit: n }) : { results: [] };
    return { label: `set from "${seed.results?.[0]?.title ?? "—"}"`, pieces: await enrich([...(seed.results ?? []), ...(rec.results ?? rec.recommendations ?? [])], n) };
  }
  const r = await callPicasso("explore_concept", { concept: g.concept, limit: n });
  return { label: `concept "${g.concept}"`, pieces: await enrich(r.results ?? [], n) };
}

const graph = await loadGraph(GRAPH_BY_ARCHETYPE[slot.archetype] ?? GRAPH_BY_ARCHETYPE.editorial, 4);
if (!graph.pieces.length) throw new Error(`no pieces from the graph for ${slot.archetype}`);
const catalog = graph.pieces;

// Hero image: PREFER a lifestyle mockup (the art in-situ, leaning/framed — the
// shots Arthaus invests in) over a flat artwork scan. The graph returns one
// image per artwork; Shopify-Files mockups are named `mockup-…--{frame}--{orientation}`,
// flat scans live on picasso.arthaus.cloud/cache/artworks. Room-forward beats
// a flat crop for a hero (brand.md: lead with the space).
const isLifestyleMockup = (url) => /\/mockup-/i.test(url ?? "");
const heroPiece = catalog.find((p) => isLifestyleMockup(p.imageUrl)) ?? catalog[0];
const heroImg = heroPiece.imageUrl;
const heroKind = isLifestyleMockup(heroImg) ? "lifestyle mockup" : "flat artwork scan (no mockup surfaced)";
const catText = catalog.map((c, i) => `${i + 1}. "${c.title}"${c.vendor ? " — " + c.vendor : ""}`).join("\n");
const facetText = catalog.map((p) => `  · "${p.title}" — palette: ${p.palette.join(", ") || "—"}; subject: ${p.subject.slice(0, 4).join(", ") || "—"}`).join("\n");

// ---- 3. Brief → Gemini ------------------------------------------------------
const SLOTS = ["hero", "intro", "works", "closing"];
const BRIEFS = {
  "artist-drop": `Archetype: artist-drop — a newly added artist just landed on Arthaus. This is the template reused for EVERY new artist.
Audience: ${slot.audience}. Send date ${slot.slot}.
Intent: introduce this artist as a person and their aesthetic (artist intimacy, never a CV), then show their pieces.
Slots & blocks: hero (heroImage of the lead piece) · intro (eyebrow "New to Arthaus" + heading L1 [the artist's name — put it in text, NEVER alt] + paragraph on their voice/aesthetic grounded in the real facets) · works (eyebrow + heading L2 + productRow of up to 3 of their pieces) · closing (ctaBand with heading + buttonText "See the collection" + trustBadges).`,
};
const brief = `${BRIEFS[slot.archetype] ?? `Archetype: ${slot.archetype}. Audience: ${slot.audience}. Send ${slot.slot}.
Slots & blocks: hero (heroImage) · intro (eyebrow + heading L1 + paragraph) · works (eyebrow + heading L2 + productRow) · closing (ctaBand + trustBadges).`}

Art-knowledge-graph context (LIVE from the store's Picasso graph — ${graph.label}):
${facetText}

Catalog (use exact titles):
${catText}`;

const responseSchema = {
  type: "object",
  properties: {
    subject: { type: "string" }, previewText: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: {
      slot: { type: "string" }, kind: { type: "string", enum: ["heading", "paragraph", "button", "productRow", "heroImage", "eyebrow", "callout", "ctaBand", "trustBadges", "divider"] },
      text: { type: "string" }, level: { type: "integer" }, href: { type: "string" }, productTitles: { type: "array", items: { type: "string" } }, alt: { type: "string" },
      heading: { type: "string" }, buttonText: { type: "string" }, eyebrow: { type: "string" }, badges: { type: "array", items: { type: "string" } }, emphasis: { type: "boolean" } },
      required: ["slot", "kind"], propertyOrdering: ["slot", "kind", "text", "level", "href", "productTitles", "alt", "heading", "buttonText", "eyebrow", "badges", "emphasis"] } },
  },
  required: ["subject", "previewText", "sections"], propertyOrdering: ["subject", "previewText", "sections"],
};

const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
let gen, usage = {};
for (let attempt = 1; attempt <= 3 && !gen; attempt++) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 45000);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: `Draft this campaign email.\n\n${brief}\n\nSlots: ${SLOTS.join(", ")}. Default CTA href: https://myarthaus.com/collections/new` }] }], generationConfig: { responseMimeType: "application/json", responseSchema, temperature: TEMP } }), signal: ac.signal });
    if (!res.ok) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
    const data = await res.json();
    gen = JSON.parse(data.candidates[0].content.parts[0].text); usage = data.usageMetadata ?? {};
  } catch { await new Promise((r) => setTimeout(r, 1500 * attempt)); } finally { clearTimeout(timer); }
}
if (!gen) throw new Error("generation failed after retries");

// ---- 4. Resolve → assemble --------------------------------------------------
const findCat = (t) => { const q = String(t).trim().toLowerCase(); return catalog.find((c) => c.title.toLowerCase() === q) ?? catalog.find((c) => c.title.toLowerCase().includes(q) || q.includes(c.title.toLowerCase())); };
const bySlot = new Map(); const sections = []; const notes = [];
for (const s of gen.sections ?? []) {
  if (!SLOTS.includes(s.slot)) { notes.push(`unknown slot "${s.slot}"`); continue; }
  if (s.kind === "heroImage") { sections.push({ slot: s.slot, type: "surface", imageUrl: heroImg, alt: s.alt || "Featured artwork", width: 1200, height: 680 }); continue; }
  const copy = (s.text ?? s.alt ?? "").trim();
  let b;
  if (s.kind === "heading") b = { kind: "heading", text: copy, level: s.level === 1 || s.level === 3 ? s.level : 2 };
  else if (s.kind === "paragraph") b = { kind: "paragraph", text: copy };
  else if (s.kind === "eyebrow") b = { kind: "eyebrow", text: copy };
  else if (s.kind === "callout") b = { kind: "callout", text: copy, emphasis: s.emphasis === true };
  else if (s.kind === "divider") b = { kind: "divider" };
  else if (s.kind === "button") b = { kind: "button", text: s.text || "Explore", href: s.href || "https://myarthaus.com/collections/new" };
  else if (s.kind === "ctaBand") { const h = (s.heading ?? s.text ?? "").trim(); if (!h) { notes.push("ctaBand had no heading"); continue; } b = { kind: "ctaBand", heading: h, buttonText: (s.buttonText || "See the collection").trim(), buttonHref: s.href || "https://myarthaus.com/collections/new", ...(s.eyebrow ? { eyebrow: s.eyebrow.trim() } : {}) }; }
  else if (s.kind === "trustBadges") { const items = (s.badges ?? []).filter(Boolean).slice(0, 6); if (!items.length) continue; b = { kind: "trustBadges", items }; }
  else if (s.kind === "productRow") { const items = (s.productTitles ?? []).map(findCat).filter(Boolean).map((c) => ({ name: c.title, price: c.price, href: c.href, imageUrl: c.imageUrl, alt: `${c.title}${c.vendor ? " by " + c.vendor : ""}` })); const uniq = [...new Map(items.map((i) => [i.name, i])).values()].slice(0, 3); if (!uniq.length) { notes.push("productRow matched nothing"); continue; } b = { kind: "productRow", products: uniq }; }
  else continue;
  if (["heading", "paragraph", "eyebrow", "callout", "button"].includes(b.kind) && !b.text) { notes.push(`empty ${b.kind} in "${s.slot}"`); continue; }
  if (!bySlot.has(s.slot)) bySlot.set(s.slot, []); bySlot.get(s.slot).push(b);
}
for (const [slotName, blocks] of bySlot) sections.push({ slot: slotName, type: "html", block: blocks });

const FRAME = ["<!--PARTIAL:head-->", "<body>",
  '<div class="email-wrapper" style="background-color:#F5F2ED;padding:32px 0;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td align="center">',
  '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container">',
  "  <tr><td><!--PARTIAL:header--></td></tr>",
  ...SLOTS.map((s) => `  <tr><td>{{slot:${s}}}</td></tr>`),
  "  <tr><td><!--PARTIAL:footer--></td></tr>",
  "</table>", "</td></tr></table></div>", "</body>", "</html>"].join("\n");
const { html: frame } = composePartials(FRAME, partials);
const { html, report } = assembleEmail({ skeleton: { html: frame, slots: SLOTS.map((name) => ({ name })) }, sections, tokens, meta: { subject: gen.subject, previewText: gen.previewText, skeletonVersion: "uat" }, options: { strict: false } });

const emailFile = `campaign-${MONTH}-${slot.archetype}.html`;
writeFileSync(join(OUT, emailFile), html);

// ---- Review page ------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rows = plan.slots.map((s) => {
  const on = s.archetype === slot.archetype && s.slot === slot.slot;
  return `<tr class="${on ? "on" : ""}"><td>${esc(s.slot)}</td><td><b>${esc(s.archetype)}</b></td><td>${esc(s.audience ?? "—")}</td><td class="why">${esc(s.rationale)}</td></tr>`;
}).join("");
const blockList = sections.map((s) => `${esc(s.slot)} → ${s.type === "surface" ? "heroImage" : s.block.map((b) => b.kind).join(", ")}`).join("<br>");

writeFileSync(join(OUT, "campaign-review.html"), `<!doctype html><meta charset="utf8"><title>Campaign review — ${esc(MONTH)} ${esc(slot.archetype)}</title><style>
 body{font:14px/1.6 -apple-system,system-ui,sans-serif;margin:0;background:#f6f4f0;color:#222}
 header{padding:22px 28px;background:#2D2D2D;color:#F5F2ED}header h1{margin:0;font:400 22px/1.2 Georgia,serif;letter-spacing:.04em}header p{margin:6px 0 0;opacity:.75;font-size:12px}
 .wrap{display:grid;grid-template-columns:minmax(420px,1fr) 660px;gap:24px;padding:24px;align-items:start}
 .card{background:#fff;border:1px solid #e5e0d8;border-radius:8px;padding:18px;margin-bottom:20px}
 h2{margin:0 0 12px;font:400 17px/1.3 Georgia,serif}
 table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top}
 th{font:600 10px/1 sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8a8580}
 tr.on{background:#FAF6EF;outline:2px solid #B07D4F}
 .why{color:#6B6560;font-size:11.5px}
 .kv{display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:13px}.kv dt{color:#8a8580;font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding-top:2px}.kv dd{margin:0}
 .subject{font:400 18px/1.35 Georgia,serif}
 .badge{display:inline-block;font:600 10px/1 sans-serif;color:#fff;background:#2e7d32;padding:4px 7px;border-radius:4px}
 .warn{background:#fff7e6;color:#8a6d3b;border-radius:4px;padding:8px 10px;font:11px monospace;margin-top:8px;white-space:pre-wrap}
 iframe{width:100%;height:1400px;border:1px solid #e5e0d8;border-radius:8px;background:#fff}
 code{font:11.5px ui-monospace,monospace;background:#f4f1ec;padding:1px 5px;border-radius:3px}
 @media(max-width:1180px){.wrap{grid-template-columns:1fr}iframe{height:900px}}
</style>
<header><h1>Campaign review — ${esc(MONTH)}</h1>
<p>strategy.md → planner → live Picasso art graph → ${esc(MODEL)} → assembled on the real Arthaus frame · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</p></header>
<div class="wrap">
 <div>
  <div class="card"><h2>The calendar — ${esc(MONTH)}</h2>
   <p style="margin:0 0 10px;color:#6B6560;font-size:12.5px">${esc(plan.summary)}</p>
   <table><tr><th>Send</th><th>Archetype</th><th>Audience</th><th>Why this slot</th></tr>${rows}</table>
   ${plan.warnings.length ? `<div class="warn">${plan.warnings.map(esc).join("<br>")}</div>` : ""}
  </div>
  <div class="card"><h2>The campaign <span class="badge">${report.ok ? "RENDERS CLEAN" : "WARNINGS"}</span></h2>
   <dl class="kv">
    <dt>Send</dt><dd>${esc(slot.slot)} · ${esc(strategy.sendTime)}</dd>
    <dt>Archetype</dt><dd>${esc(slot.archetype)}</dd>
    <dt>Audience</dt><dd>${esc(slot.audience ?? "—")}</dd>
    <dt>Subject</dt><dd class="subject">${esc(gen.subject)}</dd>
    <dt>Preview text</dt><dd><i>${esc(gen.previewText)}</i></dd>
    <dt>Art grounding</dt><dd>${esc(graph.label)} — ${catalog.map((c) => esc(c.title)).join(" · ")}</dd>
    <dt>Hero image</dt><dd>${esc(heroKind)} — "${esc(heroPiece.title)}"</dd>
    <dt>Blocks</dt><dd>${blockList}</dd>
    <dt>Lands at</dt><dd><code>emails/templates/campaign-${esc(MONTH)}-${esc(slot.archetype)}.html</code></dd>
   </dl>
   ${notes.length ? `<div class="warn">${notes.map(esc).join("<br>")}</div>` : ""}
   ${report.warnings.length ? `<div class="warn">${report.warnings.map((w) => esc(w.message ?? w)).join("<br>")}</div>` : ""}
  </div>
  <div class="card"><h2>How to iterate</h2>
   <p style="font-size:12.5px;color:#6B6560;margin:0">Re-run with a different month or archetype:<br>
   <code>node campaign-review.mjs 2026-10 set-feature</code><br><br>
   Change a different artist: <code>ARTIST="Kaethe Butcher" node campaign-review.mjs</code><br><br>
   Tune the <b>voice</b> in <code>prompt.md</code>, the <b>structure</b> in this file's brief, the <b>rotation</b> in <code>strategy.arthaus.draft.md</code>, and the <b>frame</b> in the store's <code>emails/partials/</code>. Re-run to see the change.</p>
  </div>
 </div>
 <div><iframe src="./${emailFile}"></iframe></div>
</div>`);

console.log(`calendar ${MONTH}: ${plan.slots.map((s) => `${s.slot}:${s.archetype}`).join("  ")}`);
console.log(`campaign: ${slot.archetype} @ ${slot.slot} → "${gen.subject}"`);
console.log(`  preview: ${gen.previewText}`);
console.log(`  grounding: ${graph.label} — ${catalog.map((c) => c.title).join(", ")}`);
console.log(`  hero: ${heroKind} — "${heroPiece.title}"`);
console.log(`  blocks: ${sections.map((s) => `${s.slot}:${s.type === "surface" ? "img" : s.block.map((b) => b.kind).join("+")}`).join("  ")}`);
if (notes.length) console.log(`  notes: ${notes.join(" | ")}`);
console.log(`  assembly: ${report.ok ? "OK" : "warnings"} · ${html.length}b · tokens ${usage.promptTokenCount}→${usage.candidatesTokenCount}`);
console.log(`\nReview → ${join(OUT, "campaign-review.html")}`);
