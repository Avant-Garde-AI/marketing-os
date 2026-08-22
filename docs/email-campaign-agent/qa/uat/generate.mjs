/**
 * Email Campaign Agent — LIVE generation UAT.
 *
 * Model (Gemini 2.5 Flash on Vertex — the prod agent's lane, spec 16) authors
 * COPY + STRUCTURE + product CURATION; the harness resolves real product data
 * and hero imagery so nothing commercial is hallucinated; the vendored pipeline
 * assembles + gates it.
 *
 * Art-graph grounding: each brief may carry `artGraph` facts (concepts, facets,
 * pieces) — a stand-in for a live Picasso art-knowledge-graph MCP lookup. They
 * are woven into the brief so we can UAT KG-grounded creative exploration. TODO
 * (needs server URL/creds): replace the fixture facts with a live tools/call to
 * the tenant's Picasso MCP (explore_concept / faceted_discovery / get_artwork_facets).
 *
 *   VERTEX_TOKEN=$(gcloud auth application-default print-access-token) node generate.mjs
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

const { compileDesignTokens } = await import(`${MO}/packages/brand-md/dist/index.js`);
const { composePartials, assembleEmail } = await import(`${MO}/packages/email-assembly/dist/index.js`);

const tokens = compileDesignTokens(readFileSync(join(BRAND, "DESIGN.md"), "utf8"), { compiledAt: "1970-01-01T00:00:00.000Z" });
const partials = {};
for (const f of readdirSync(join(EMAILS, "partials"))) if (f.endsWith(".html")) partials[f.replace(/\.html$/, "")] = readFileSync(join(EMAILS, "partials", f), "utf8");
const systemPrompt = readFileSync(join(HERE, "prompt.md"), "utf8");

// ---- LIVE Picasso art-knowledge-graph MCP (spec 18; registered active for
// Arthaus). Stateless streamable-HTTP: one tools/call POST, SSE reply. Same
// endpoint the hosted runtime uses (external_mcp_connections.server_url). -----
const PICASSO_URL = process.env.PICASSO_MCP_URL ?? "https://picasso-concierge-spfdrt2aha-uc.a.run.app/mcp/";

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
    // SSE: pull the data: line, then the JSON-RPC envelope's content text.
    const dataLine = raw.split("\n").find((l) => l.startsWith("data:")) ?? raw;
    const env = JSON.parse(dataLine.replace(/^data:\s*/, ""));
    if (env.error) throw new Error(`Picasso ${name}: ${JSON.stringify(env.error).slice(0, 160)}`);
    const sc = env.result?.structuredContent;
    if (sc) return sc;
    return JSON.parse(env.result?.content?.[0]?.text ?? "{}");
  } finally { clearTimeout(timer); }
}

/** Explore a concept in the graph, then enrich the chosen pieces with real
 * facets (palette/subject/movement). Returns a live catalog + grounding text. */
async function loadArtGraph(concept, n = 4) {
  const explore = await callPicasso("explore_concept", { concept, limit: n });
  const results = (explore.results ?? []).slice(0, n);
  const handles = results.map((r) => r.handle).filter(Boolean);
  let facetsByHandle = {};
  try {
    const f = await callPicasso("get_artwork_facets", { handles });
    for (const a of f.artworks ?? []) facetsByHandle[a.handle] = a;
  } catch { /* facets optional */ }
  const pieces = results.map((r) => {
    const fx = facetsByHandle[r.handle] ?? facetsByHandle[(r.handle || "").replace(/-no-frame$|-old$/, "")] ?? {};
    return {
      title: (r.title || "").trim(), vendor: r.artist || "", handle: r.handle,
      // Graph carries no price; use a neutral placeholder (never a fabricated
      // number). In prod the price comes from Shopify, not the graph.
      price: (r.price && r.price.trim()) || "View piece",
      href: r.url, imageUrl: r.image,
      palette: fx.palette ?? [], subject: fx.subject ?? [], movement: fx.movement ?? [], why: r.why ?? [],
    };
  }).filter((p) => p.title);
  const conceptFreq = (explore.knowledge?.concepts ?? []).map((c) => c.name).slice(0, 8).join(", ");
  return { concept, pieces, conceptFreq };
}

function artGraphTextFrom(ag) {
  const lines = ag.pieces.map((p) => `  · "${p.title}" (${p.vendor || "artist"}) — palette: ${p.palette.join(", ") || "—"}; subject: ${p.subject.slice(0, 4).join(", ") || "—"}${p.movement.length ? `; movement: ${p.movement.join(", ")}` : ""}`);
  return `Art-knowledge-graph context (LIVE from the store's Picasso graph, concept "${ag.concept}"):
- Related concepts in the graph: ${ag.conceptFreq || "—"}
- Pieces surfaced, with real facets:\n${lines.join("\n")}`;
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

const briefs = [
  {
    name: "gen-editorial", title: "Editorial — new collection (LIVE, KG-grounded)",
    slots: ["hero", "intro", "products", "closing"], ctaHref: "https://myarthaus.com/collections/quiet-hours",
    concept: "calm and contemplative",
    brief: (catalogText, agText) => `Archetype: editorial-story (mood-led new-collection announcement).
Audience: newsletter subscribers who browse but haven't all purchased.
Intent: introduce "The Quiet Hours" — contemplative works for calm, lived-in rooms.
Slots, in order: hero (heroImage), intro (heading level 1 + paragraph + button), products (heading level 2 + productRow up to 2 from the catalog), closing (one short framing/shipping reassurance paragraph).
${agText}
Catalog (use exact titles):\n${catalogText}`,
  },
  {
    name: "gen-winback", title: "Win-back — we've missed you (LIVE, KG-grounded)",
    slots: ["intro", "products", "closing"], ctaHref: "https://myarthaus.com/collections/all",
    concept: "botanical and organic warmth",
    brief: (catalogText, agText) => `Archetype: win-back (lapsed browser, no visit in 90 days).
Intent: a warm, low-pressure return — new works since they last looked; no discount, no urgency.
Slots, in order: intro (heading level 1 + paragraph), products (a paragraph in the art-description formula above ONE piece you single out, then a productRow of that one piece), closing (paragraph + a gentle button).
${agText}
Catalog (use exact titles):\n${catalogText}`,
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

async function generate(b, briefText) {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
  const body = { systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: `Draft this campaign email.\n\n${briefText}\n\nSlots: ${b.slots.join(", ")}. Default CTA href if you add a button: ${b.ctaHref}` }] }], generationConfig: { responseMimeType: "application/json", responseSchema, temperature: TEMP } };
  let data, lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body), signal: ac.signal });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`Vertex ${res.status}`); await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
      if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 300)}`);
      data = await res.json(); break;
    } catch (e) { lastErr = e?.name === "AbortError" ? new Error(`timeout (45s) attempt ${attempt}`) : e; await new Promise((r) => setTimeout(r, 1500 * attempt)); }
    finally { clearTimeout(timer); }
  }
  if (!data) throw lastErr ?? new Error("no response");
  const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) throw new Error(`no text: ${JSON.stringify(data).slice(0, 200)}`);
  return { gen: JSON.parse(txt), usage: data.usageMetadata ?? {} };
}

function resolve(b, gen, catalog, heroImg) {
  const notes = [];
  const findCat = (title) => { const t = title.trim().toLowerCase(); return catalog.find((c) => c.title.toLowerCase() === t) ?? catalog.find((c) => c.title.toLowerCase().includes(t) || t.includes(c.title.toLowerCase())); };
  const bySlotHtml = new Map(); const sections = [];
  for (const s of gen.sections ?? []) {
    if (!b.slots.includes(s.slot)) { notes.push(`dropped section for unknown slot "${s.slot}"`); continue; }
    if (s.kind === "heroImage") { sections.push({ slot: s.slot, type: "surface", imageUrl: heroImg, alt: s.alt || "Featured artwork", width: 1200, height: 680 }); continue; }
    const copy = (s.text ?? s.alt ?? "").trim();
    if ((s.kind === "heading" || s.kind === "paragraph") && !s.text && s.alt) notes.push(`recovered ${s.kind} copy from misplaced 'alt' in "${s.slot}"`);
    let block;
    if (s.kind === "heading") block = { kind: "heading", text: copy, level: s.level === 1 || s.level === 3 ? s.level : 2 };
    else if (s.kind === "paragraph") block = { kind: "paragraph", text: copy };
    else if (s.kind === "button") block = { kind: "button", text: s.text ?? "Explore", href: s.href || b.ctaHref };
    else if (s.kind === "productRow") {
      const items = (s.productTitles ?? []).map(findCat).filter(Boolean).map((c) => ({ name: c.title, price: c.price, href: c.href, imageUrl: c.imageUrl, alt: `${c.title} by ${c.vendor}` }));
      const uniq = [...new Map(items.map((i) => [i.name, i])).values()].slice(0, 3);
      if (uniq.length === 0) { notes.push(`productRow in "${s.slot}" matched no catalog titles`); continue; }
      block = { kind: "productRow", products: uniq };
    } else continue;
    if (!block.text && block.kind !== "productRow") { notes.push(`empty ${block.kind} in "${s.slot}" dropped`); continue; }
    if (!bySlotHtml.has(s.slot)) bySlotHtml.set(s.slot, []); bySlotHtml.get(s.slot).push(block);
  }
  for (const [slot, blocks] of bySlotHtml) sections.push({ slot, type: "html", block: blocks });
  return { sections, notes };
}

const results = [];
for (const b of briefs) {
  try {
    const ag = await loadArtGraph(b.concept, 4);
    const catalog = ag.pieces;
    const heroImg = catalog[0]?.imageUrl ?? "https://picasso.arthaus.cloud/cache/artworks/13304-botanical-blush.webp";
    const catalogText = catalog.map((c, i) => `${i + 1}. "${c.title}" — ${c.vendor || "artist"}`).join("\n");
    const briefText = b.brief(catalogText, artGraphTextFrom(ag));
    const { gen, usage } = await generate(b, briefText);
    const { sections, notes } = resolve(b, gen, catalog, heroImg);
    const { html: frame } = composePartials(DEFAULT_FRAME(b.slots), partials);
    const { html, report } = assembleEmail({ skeleton: { html: frame, slots: b.slots.map((name) => ({ name })) }, sections, tokens, meta: { subject: gen.subject ?? "(no subject)", previewText: gen.previewText ?? "", skeletonVersion: "uat" }, options: { strict: false } });
    writeFileSync(join(OUT, `${b.name}.html`), html); writeFileSync(join(OUT, `${b.name}.json`), JSON.stringify(gen, null, 2));
    results.push({ ...b, gen, usage, report, notes, sections });
  } catch (e) { results.push({ ...b, error: String(e?.stack ?? e) }); }
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const card = (r) => {
  if (r.error) return `<section><h2>${esc(r.title)} <span class="badge" style="background:#c0392b">THREW</span></h2><pre class="err">${esc(r.error)}</pre></section>`;
  const rep = r.report, ok = rep.ok, lines = [];
  lines.push(`<div class="subj"><b>Subject:</b> ${esc(r.gen.subject)}<br><b>Preview:</b> <i>${esc(r.gen.previewText)}</i></div>`);
  if (r.notes.length) lines.push(`<div class="meta warn">resolve notes:<br>${r.notes.map(esc).join("<br>")}</div>`);
  if (rep.errors.length) lines.push(`<div class="meta err">errors:<br>${rep.errors.map((e) => esc(e.message ?? e)).join("<br>")}</div>`);
  if (rep.warnings.length) lines.push(`<div class="meta warn">warnings:<br>${rep.warnings.map((w) => esc(w.message ?? w)).join("<br>")}</div>`);
  lines.push(`<details><summary>generated JSON · ${r.usage.promptTokenCount ?? "?"}→${r.usage.candidatesTokenCount ?? "?"} tok · ${MODEL}</summary><pre>${esc(JSON.stringify(r.gen, null, 2))}</pre></details>`);
  return `<section><h2>${esc(r.title)} <span class="badge" style="background:${ok ? "#2e7d32" : "#b7791f"}">${ok ? "OK" : "OK (warnings)"}</span></h2><div class="path">live gen · <a href="./${r.name}.html" target="_blank">open ↗</a></div>${lines.join("\n")}<iframe src="./${r.name}.html" loading="lazy"></iframe></section>`;
};
writeFileSync(join(OUT, "generated.html"), `<!doctype html><meta charset="utf8"><title>Email UAT — live generation</title><style>
 body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;background:#f6f4f0;color:#222}
 header{padding:20px 28px;background:#2D2D2D;color:#F5F2ED}header h1{margin:0;font:400 20px/1.2 Georgia,serif;letter-spacing:.05em}header p{margin:6px 0 0;opacity:.75;font-size:12px}
 main{display:grid;grid-template-columns:repeat(auto-fill,minmax(660px,1fr));gap:24px;padding:24px}
 section{background:#fff;border:1px solid #e5e0d8;border-radius:8px;padding:16px}h2{margin:0 0 4px;font:400 16px/1.3 Georgia,serif}
 .badge{font:600 10px/1 sans-serif;color:#fff;padding:3px 6px;border-radius:4px;vertical-align:middle}.path{font:11px monospace;color:#888;margin-bottom:8px}
 .subj{background:#faf8f5;border-radius:4px;padding:8px 10px;margin:6px 0;font-size:13px}
 .meta{font:11px/1.5 monospace;border-radius:4px;padding:6px 8px;margin:6px 0;white-space:pre-wrap}.meta.warn{background:#fff7e6;color:#8a6d3b}.meta.err{background:#fdecea;color:#a12}
 details{margin:6px 0;font:11px monospace}summary{cursor:pointer;color:#666}details pre{background:#faf8f5;padding:8px;border-radius:4px;overflow:auto;max-height:320px}
 .err{color:#a12;font:11px monospace;white-space:pre-wrap}iframe{width:100%;height:840px;border:1px solid #e5e0d8;border-radius:4px;margin-top:8px;background:#fff}
</style><header><h1>Email Campaign Agent — live generation UAT</h1><p>${MODEL} · temp ${TEMP} · real brand.md voice + DESIGN.md tokens + Arthaus catalog + art-graph facts · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</p></header><main>${results.map(card).join("\n")}</main>`);

for (const r of results) {
  if (r.error) { console.log(`✗ ${r.name} THREW: ${r.error.split("\n")[0]}`); continue; }
  console.log(`${r.report.ok ? "✓" : "•"} ${r.name} — "${r.gen.subject}"`);
  console.log(`   preview: ${r.gen.previewText}`);
  console.log(`   sections: ${r.sections.map((s) => `${s.slot}:${s.type === "surface" ? "img" : s.block.map((b) => b.kind).join("+")}`).join("  ")}`);
  if (r.notes.length) console.log(`   notes: ${r.notes.join(" | ")}`);
  console.log(`   tokens: ${r.usage.promptTokenCount}→${r.usage.candidatesTokenCount}`);
}
console.log(`\nGallery → ${join(OUT, "generated.html")}`);
