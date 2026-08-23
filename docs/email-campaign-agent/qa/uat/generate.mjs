/**
 * Email Campaign Agent — LIVE generation UAT, campaign-archetype sweep.
 *
 * Model (Gemini 2.5 Flash on Vertex — the prod agent's lane, spec 16) authors
 * COPY + STRUCTURE + product CURATION; the harness resolves real product data
 * and hero imagery so nothing commercial is hallucinated; the vendored pipeline
 * assembles + gates it.
 *
 * Each ARCHETYPE is grounded in a different slice of the LIVE Picasso art graph
 * (spec 18; registered active for Arthaus). Query strategies:
 *   concept → explore_concept        (generalized editorial, new arrivals)
 *   artist  → search_artworks(name)  (per-artist drop)
 *   set     → explore_concept seed → recommend_similar (cohesive gallery set)
 * Facets for every surfaced piece come from get_artwork_facets.
 *
 *   VERTEX_TOKEN=$(gcloud auth application-default print-access-token) node generate.mjs
 *   node generate.mjs editorial artist-drop      # subset by name
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MO = process.env.MOS_ROOT ?? "/Users/garretteastham/dev/avant-garde/platform/marketing-os";
const EMAILS = process.env.STORE_EMAILS ?? "/Users/garretteastham/dev/arthaus/platform/marketplace/emails";
const BRAND = process.env.STORE_BRAND ?? "/Users/garretteastham/dev/arthaus/platform/marketplace/agents/brand";
const HERE = new URL("./", import.meta.url).pathname;
const OUT = join(HERE, "out");

const MODEL = process.env.MODEL ?? "gemini-2.5-flash";
const TEMP = Number(process.env.TEMP ?? "0.7");
const PROJECT = process.env.VERTEX_PROJECT ?? "avant-garde-platform";
const LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";
const TOKEN = process.env.VERTEX_TOKEN?.trim();
if (!TOKEN) throw new Error("VERTEX_TOKEN not set (export VERTEX_TOKEN=$(gcloud auth application-default print-access-token))");
const PICASSO_URL = process.env.PICASSO_MCP_URL ?? "https://picasso-concierge-spfdrt2aha-uc.a.run.app/mcp/";

const { compileDesignTokens } = await import(`${MO}/packages/brand-md/dist/index.js`);
const { composePartials, assembleEmail } = await import(`${MO}/packages/email-assembly/dist/index.js`);

const tokens = compileDesignTokens(readFileSync(join(BRAND, "DESIGN.md"), "utf8"), { compiledAt: "1970-01-01T00:00:00.000Z" });
const partials = {};
for (const f of readdirSync(join(EMAILS, "partials"))) if (f.endsWith(".html")) partials[f.replace(/\.html$/, "")] = readFileSync(join(EMAILS, "partials", f), "utf8");
const systemPrompt = readFileSync(join(HERE, "prompt.md"), "utf8");

// --- LIVE Picasso art-knowledge-graph MCP -----------------------------------
async function callPicasso(name, args) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 40000);
  try {
    const res = await fetch(PICASSO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Picasso ${name} ${res.status}`);
    const raw = await res.text();
    const dataLine = raw.split("\n").find((l) => l.startsWith("data:")) ?? raw;
    const env = JSON.parse(dataLine.replace(/^data:\s*/, ""));
    if (env.error) throw new Error(`Picasso ${name}: ${JSON.stringify(env.error).slice(0, 160)}`);
    return env.result?.structuredContent ?? JSON.parse(env.result?.content?.[0]?.text ?? "{}");
  } finally { clearTimeout(timer); }
}

function pieceFrom(r, facetsByHandle) {
  const fx = facetsByHandle[r.handle] ?? facetsByHandle[(r.handle || "").replace(/-no-frame$|-old$/, "")] ?? {};
  return {
    title: (r.title || "").trim(), vendor: r.artist || "", handle: r.handle,
    price: (r.price && r.price.trim()) || "View piece", href: r.url, imageUrl: r.image,
    palette: fx.palette ?? [], subject: fx.subject ?? [], movement: fx.movement ?? [], why: r.why ?? [],
  };
}
async function enrich(results, n) {
  const picks = results.slice(0, n);
  const handles = picks.map((r) => r.handle).filter(Boolean);
  let facetsByHandle = {};
  try { const f = await callPicasso("get_artwork_facets", { handles }); for (const a of f.artworks ?? []) facetsByHandle[a.handle] = a; } catch { /* optional */ }
  return picks.map((r) => pieceFrom(r, facetsByHandle)).filter((p) => p.title);
}

/** Dispatch a graph query by strategy → {label, pieces, note}. */
async function loadArtGraph(graph, n = 4) {
  if (graph.kind === "concept") {
    const r = await callPicasso("explore_concept", { concept: graph.concept, limit: n });
    const note = (r.knowledge?.concepts ?? []).map((c) => c.name).slice(0, 8).join(", ");
    return { label: `concept "${graph.concept}"`, pieces: await enrich(r.results ?? [], n), note };
  }
  if (graph.kind === "artist") {
    const r = await callPicasso("search_artworks", { query: graph.artist, limit: n });
    const only = (r.results ?? []).filter((x) => !graph.strict || (x.artist || "").toLowerCase() === graph.artist.toLowerCase());
    return { label: `artist "${graph.artist}"`, pieces: await enrich(only.length ? only : r.results ?? [], n), note: graph.artist };
  }
  if (graph.kind === "set") {
    const seed = await callPicasso("explore_concept", { concept: graph.seedConcept, limit: 1 });
    const seedHandle = seed.results?.[0]?.handle;
    if (!seedHandle) return { label: `set (no seed for "${graph.seedConcept}")`, pieces: [], note: "" };
    const rec = await callPicasso("recommend_similar", { seed_handles: [seedHandle], limit: n });
    const results = [seed.results[0], ...(rec.results ?? rec.recommendations ?? [])];
    return { label: `set from "${seed.results[0].title}"`, pieces: await enrich(results, n), note: graph.seedConcept };
  }
  throw new Error(`unknown graph kind ${graph.kind}`);
}

function artGraphTextFrom(ag) {
  const lines = ag.pieces.map((p) => `  · "${p.title}" (${p.vendor || "artist"}) — palette: ${p.palette.join(", ") || "—"}; subject: ${p.subject.slice(0, 4).join(", ") || "—"}`);
  return `Art-knowledge-graph context (LIVE from the store's Picasso graph — ${ag.label}):
- Related concepts: ${ag.note || "—"}
- Pieces surfaced, with real facets:\n${lines.join("\n")}`;
}

// --- The campaign archetype library (what we iterate + refine) ----------------
const ARCHETYPES = [
  {
    name: "editorial", title: "Generalized editorial — collection mood",
    slots: ["hero", "intro", "products", "closing"], ctaHref: "https://myarthaus.com/collections/quiet-hours",
    graph: { kind: "concept", concept: "calm and contemplative" },
    brief: (cat, ag) => `Archetype: editorial-story (mood-led collection announcement).
Audience: newsletter subscribers who browse but haven't all purchased.
Intent: introduce a contemplative collection for calm, lived-in rooms. Lead with the mood and the room; then the works.
Slots: hero (heroImage), intro (heading L1 + paragraph + button), products (heading L2 + productRow up to 2), closing (framing/shipping reassurance paragraph).
${ag}\nCatalog (use exact titles):\n${cat}`,
  },
  {
    name: "artist-drop", title: "Per-artist drop — a newly added artist",
    slots: ["hero", "intro", "works", "closing"], ctaHref: "https://myarthaus.com/collections/new",
    graph: { kind: "artist", artist: "Judy Kaufmann", strict: true },
    brief: (cat, ag) => `Archetype: artist-drop (a newly added artist just landed on Arthaus).
Audience: subscribers who follow new work.
Intent: introduce THIS artist as a person and their aesthetic (artist intimacy, never a CV), then show a few of their pieces. This is the template we reuse each time we add an artist.
Slots: hero (heroImage of the lead piece), intro (heading L1 = a warm artist-forward line + paragraph on their voice/aesthetic + button "See the collection"), works (heading L2 + productRow of up to 3 of their pieces), closing (a short invitation paragraph).
${ag}\nAll pieces below are by this one artist — feature them:\n${cat}`,
  },
  {
    name: "set-feature", title: "Dramatic set — a curated gallery wall",
    slots: ["hero", "intro", "set", "closing"], ctaHref: "https://myarthaus.com/collections/sets",
    graph: { kind: "set", seedConcept: "bold graphic statement" },
    brief: (cat, ag) => `Archetype: set-feature (a dramatic, curated gallery-wall SET that hangs together).
Audience: subscribers styling a feature wall.
Intent: present these pieces as ONE cohesive, confident set — the drama is in the grouping. Bolder, more declarative voice than editorial (still Arthaus: no shouting, no clichés). Explain why they work together (shared palette/subject from the facets).
Slots: hero (heroImage), intro (heading L1 = a bold set name + paragraph on why the set coheres + button "Shop the set"), set (heading L2 + productRow of 2-3 pieces from the set), closing (styling note paragraph — how to hang them).
${ag}\nThe cohesive set (use exact titles):\n${cat}`,
  },
  {
    name: "new-arrivals", title: "New arrivals — just landed",
    slots: ["hero", "intro", "products", "closing"], ctaHref: "https://myarthaus.com/collections/new",
    graph: { kind: "concept", concept: "contemporary bold color" },
    brief: (cat, ag) => `Archetype: new-arrivals (a lively "just landed" roundup).
Audience: the full newsletter list.
Intent: a fresh, energetic sweep of new work — a little more upbeat than editorial, still tasteful. Invite discovery.
Slots: hero (heroImage), intro (heading L1 + a short punchy paragraph + button "See what's new"), products (heading L2 + productRow up to 3), closing (one-line paragraph).
${ag}\nCatalog (use exact titles):\n${cat}`,
  },
  {
    // NOTE: refine graph query + structure against the real emails/room.html
    // once the emails/ introspection lands (match its spatial framing).
    name: "room-recommendation", title: "Room recommendation — art for your space",
    slots: ["hero", "intro", "products", "closing"], ctaHref: "https://myarthaus.com/collections/all",
    graph: { kind: "concept", concept: "calm art for a bedroom reading nook" },
    brief: (cat, ag) => `Archetype: room-recommendation (Arthaus's room-first signature — "see it in your space").
Audience: subscribers who've browsed but not committed; decorating a specific room.
Intent: recommend art FOR a room. Lead hard with the space and how the work lives in it (this is the most room-forward archetype), then the pieces. Name the room, the wall, the light.
Slots: hero (heroImage of art in-situ), intro (heading L1 = a room-forward line + paragraph placing the art in the room + button "See it in your room"), products (heading L2 + productRow up to 3 suited to that room), closing (a sizing/hanging reassurance paragraph).
${ag}\nCatalog (use exact titles):\n${cat}`,
  },
  {
    name: "seasonal", title: "Seasonal / occasion — a moment",
    slots: ["hero", "intro", "products", "closing"], ctaHref: "https://myarthaus.com/collections/all",
    graph: { kind: "concept", concept: "warm autumn earth tones" },
    brief: (cat, ag) => `Archetype: seasonal/occasion (a seasonal palette moment — brand-safe, NO urgency clichés, no discount shouting).
Audience: the full list.
Intent: tie a seasonal mood to the art via real palette facets — an invitation, not a sale. Let the season set the palette and the feeling.
Slots: hero (heroImage), intro (heading L1 + paragraph connecting the season's palette/mood to the works + button), products (heading L2 + productRow up to 3 matching the seasonal palette), closing (a warm one-line paragraph).
${ag}\nCatalog (use exact titles):\n${cat}`,
  },
];

const responseSchema = {
  type: "object",
  properties: {
    subject: { type: "string" }, previewText: { type: "string" },
    sections: { type: "array", items: { type: "object",
      properties: { slot: { type: "string" }, kind: { type: "string", enum: ["heading", "paragraph", "button", "productRow", "heroImage"] }, text: { type: "string" }, level: { type: "integer" }, href: { type: "string" }, productTitles: { type: "array", items: { type: "string" } }, alt: { type: "string" } },
      required: ["slot", "kind"], propertyOrdering: ["slot", "kind", "text", "level", "href", "productTitles", "alt"] } },
  },
  required: ["subject", "previewText", "sections"], propertyOrdering: ["subject", "previewText", "sections"],
};

async function generate(a, briefText) {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
  const body = { systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: `Draft this campaign email.\n\n${briefText}\n\nSlots: ${a.slots.join(", ")}. Default CTA href if you add a button: ${a.ctaHref}` }] }], generationConfig: { responseMimeType: "application/json", responseSchema, temperature: TEMP } };
  let data, lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body), signal: ac.signal });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`Vertex ${res.status}`); await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
      if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 300)}`);
      data = await res.json(); break;
    } catch (e) { lastErr = e?.name === "AbortError" ? new Error(`timeout attempt ${attempt}`) : e; await new Promise((r) => setTimeout(r, 1500 * attempt)); }
    finally { clearTimeout(timer); }
  }
  if (!data) throw lastErr ?? new Error("no response");
  const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) throw new Error(`no text: ${JSON.stringify(data).slice(0, 200)}`);
  return { gen: JSON.parse(txt), usage: data.usageMetadata ?? {} };
}

function resolve(a, gen, catalog, heroImg) {
  const notes = [];
  const findCat = (t) => { const q = t.trim().toLowerCase(); return catalog.find((c) => c.title.toLowerCase() === q) ?? catalog.find((c) => c.title.toLowerCase().includes(q) || q.includes(c.title.toLowerCase())); };
  const bySlot = new Map(); const sections = [];
  for (const s of gen.sections ?? []) {
    if (!a.slots.includes(s.slot)) { notes.push(`dropped unknown slot "${s.slot}"`); continue; }
    if (s.kind === "heroImage") { sections.push({ slot: s.slot, type: "surface", imageUrl: heroImg, alt: s.alt || "Featured artwork", width: 1200, height: 680 }); continue; }
    const copy = (s.text ?? s.alt ?? "").trim();
    if ((s.kind === "heading" || s.kind === "paragraph") && !s.text && s.alt) notes.push(`recovered ${s.kind} from 'alt' in "${s.slot}"`);
    let block;
    if (s.kind === "heading") block = { kind: "heading", text: copy, level: s.level === 1 || s.level === 3 ? s.level : 2 };
    else if (s.kind === "paragraph") block = { kind: "paragraph", text: copy };
    else if (s.kind === "button") block = { kind: "button", text: s.text ?? "Explore", href: s.href || a.ctaHref };
    else if (s.kind === "productRow") {
      const items = (s.productTitles ?? []).map(findCat).filter(Boolean).map((c) => ({ name: c.title, price: c.price, href: c.href, imageUrl: c.imageUrl, alt: `${c.title}${c.vendor ? " by " + c.vendor : ""}` }));
      const uniq = [...new Map(items.map((i) => [i.name, i])).values()].slice(0, 3);
      if (!uniq.length) { notes.push(`productRow in "${s.slot}" matched no catalog titles`); continue; }
      block = { kind: "productRow", products: uniq };
    } else continue;
    if (!block.text && block.kind !== "productRow") { notes.push(`empty ${block.kind} in "${s.slot}"`); continue; }
    if (!bySlot.has(s.slot)) bySlot.set(s.slot, []); bySlot.get(s.slot).push(block);
  }
  for (const [slot, blocks] of bySlot) sections.push({ slot, type: "html", block: blocks });
  return { sections, notes };
}

const DEFAULT_FRAME = (slots) => [
  "<!--PARTIAL:head-->", "<body>",
  '<div class="email-wrapper" style="background-color:#F5F2ED;padding:32px 0;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td align="center">',
  '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container">',
  "  <tr><td><!--PARTIAL:header--></td></tr>",
  ...slots.map((s) => `  <tr><td>{{slot:${s}}}</td></tr>`),
  "  <tr><td><!--PARTIAL:footer--></td></tr>",
  "</table>", "</td></tr></table></div>", "</body>", "</html>",
].join("\n");

// --- Run ---------------------------------------------------------------------
const only = process.argv.slice(2);
const selected = only.length ? ARCHETYPES.filter((a) => only.includes(a.name)) : ARCHETYPES;
const results = [];
for (const a of selected) {
  try {
    const ag = await loadArtGraph(a.graph, a.slots.includes("works") || a.slots.includes("set") ? 4 : 3);
    if (!ag.pieces.length) throw new Error(`no pieces from graph (${ag.label})`);
    const catalog = ag.pieces;
    const heroImg = catalog[0]?.imageUrl ?? "https://picasso.arthaus.cloud/cache/artworks/13304-botanical-blush.webp";
    const catText = catalog.map((c, i) => `${i + 1}. "${c.title}"${c.vendor ? " — " + c.vendor : ""}`).join("\n");
    const briefText = a.brief(catText, artGraphTextFrom(ag));
    const { gen, usage } = await generate(a, briefText);
    const { sections, notes } = resolve(a, gen, catalog, heroImg);
    const { html: frame } = composePartials(DEFAULT_FRAME(a.slots), partials);
    const { html, report } = assembleEmail({ skeleton: { html: frame, slots: a.slots.map((name) => ({ name })) }, sections, tokens, meta: { subject: gen.subject ?? "(no subject)", previewText: gen.previewText ?? "", skeletonVersion: "uat" }, options: { strict: false } });
    writeFileSync(join(OUT, `arch-${a.name}.html`), html); writeFileSync(join(OUT, `arch-${a.name}.json`), JSON.stringify(gen, null, 2));
    results.push({ ...a, gen, usage, report, notes, sections, agLabel: ag.label });
  } catch (e) { results.push({ ...a, error: String(e?.stack ?? e) }); }
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const card = (r) => {
  if (r.error) return `<section><h2>${esc(r.title)} <span class="badge" style="background:#c0392b">THREW</span></h2><pre class="err">${esc(r.error)}</pre></section>`;
  const rep = r.report, ok = rep.ok, lines = [];
  lines.push(`<div class="subj"><b>${esc(r.name)}</b> · ${esc(r.agLabel)}<br><b>Subject:</b> ${esc(r.gen.subject)}<br><b>Preview:</b> <i>${esc(r.gen.previewText)}</i></div>`);
  if (r.notes.length) lines.push(`<div class="meta warn">${r.notes.map(esc).join("<br>")}</div>`);
  if (rep.errors.length) lines.push(`<div class="meta err">${rep.errors.map((e) => esc(e.message ?? e)).join("<br>")}</div>`);
  lines.push(`<details><summary>generated JSON · ${r.usage.promptTokenCount ?? "?"}→${r.usage.candidatesTokenCount ?? "?"} tok</summary><pre>${esc(JSON.stringify(r.gen, null, 2))}</pre></details>`);
  return `<section><h2>${esc(r.title)} <span class="badge" style="background:${ok ? "#2e7d32" : "#b7791f"}">${ok ? "OK" : "warn"}</span></h2><div class="path"><a href="./arch-${r.name}.html" target="_blank">open ↗</a></div>${lines.join("\n")}<iframe src="./arch-${r.name}.html" loading="lazy"></iframe></section>`;
};
writeFileSync(join(OUT, "archetypes.html"), `<!doctype html><meta charset="utf8"><title>Campaign archetype sweep</title><style>
 body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;background:#f6f4f0;color:#222}
 header{padding:20px 28px;background:#2D2D2D;color:#F5F2ED}header h1{margin:0;font:400 20px/1.2 Georgia,serif;letter-spacing:.05em}header p{margin:6px 0 0;opacity:.75;font-size:12px}
 main{display:grid;grid-template-columns:repeat(auto-fill,minmax(640px,1fr));gap:24px;padding:24px}
 section{background:#fff;border:1px solid #e5e0d8;border-radius:8px;padding:16px}h2{margin:0 0 4px;font:400 16px/1.3 Georgia,serif}
 .badge{font:600 10px/1 sans-serif;color:#fff;padding:3px 6px;border-radius:4px;vertical-align:middle}.path{font:11px monospace;color:#888;margin-bottom:8px}
 .subj{background:#faf8f5;border-radius:4px;padding:8px 10px;margin:6px 0;font-size:13px}
 .meta{font:11px/1.5 monospace;border-radius:4px;padding:6px 8px;margin:6px 0;white-space:pre-wrap}.meta.warn{background:#fff7e6;color:#8a6d3b}.meta.err{background:#fdecea;color:#a12}
 details{margin:6px 0;font:11px monospace}summary{cursor:pointer;color:#666}details pre{background:#faf8f5;padding:8px;border-radius:4px;overflow:auto;max-height:300px}
 .err{color:#a12;font:11px monospace;white-space:pre-wrap}iframe{width:100%;height:860px;border:1px solid #e5e0d8;border-radius:4px;margin-top:8px;background:#fff}
</style><header><h1>Campaign archetype sweep — Arthaus</h1><p>${MODEL} · live Picasso graph grounding · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</p></header><main>${results.map(card).join("\n")}</main>`);

for (const r of results) {
  if (r.error) { console.log(`✗ ${r.name} THREW: ${r.error.split("\n")[0]}`); continue; }
  console.log(`${r.report.ok ? "✓" : "•"} ${r.name} [${r.agLabel}] — "${r.gen.subject}"`);
  console.log(`   ${r.sections.map((s) => `${s.slot}:${s.type === "surface" ? "img" : s.block.map((b) => b.kind).join("+")}`).join("  ")}`);
  if (r.notes.length) console.log(`   notes: ${r.notes.join(" | ")}`);
}
console.log(`\nSweep → ${join(OUT, "archetypes.html")}`);
