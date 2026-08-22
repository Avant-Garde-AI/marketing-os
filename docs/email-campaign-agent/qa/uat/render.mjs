/**
 * Email Campaign Agent — deterministic render UAT harness.
 *
 * Runs the vendored runtime pipeline against a real store-repo email folder +
 * DESIGN.md tokens. No Slack, Klaviyo, LLM, or Supabase. Edit partials/tokens/
 * campaign specs, re-run, re-view out/index.html.
 *
 *   compileDesignTokens(DESIGN.md)  [brand-md]
 *   composePartials → extractSkeleton (ingest) → assembleEmail  [email-assembly]
 *
 * Store paths (override via env):
 *   STORE_EMAILS   default: Arthaus marketplace/emails
 *   STORE_BRAND    default: Arthaus marketplace/agents/brand
 *   MOS_ROOT       default: this monorepo (for the built packages)
 *
 * NOTE: DEFAULT_FRAME below mirrors lib/email/assemble.ts and carries the
 * 2026-08 fix — partials wrapped in <tr><td> so the body stays in the 600px
 * column. Keep in sync with the binding if that frame changes.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MO = process.env.MOS_ROOT ?? "/Users/garretteastham/dev/avant-garde/platform/marketing-os";
const EMAILS = process.env.STORE_EMAILS ?? "/Users/garretteastham/dev/arthaus/platform/marketplace/emails";
const BRAND = process.env.STORE_BRAND ?? "/Users/garretteastham/dev/arthaus/platform/marketplace/agents/brand";
const OUT = new URL("./out/", import.meta.url).pathname;

const { compileDesignTokens } = await import(`${MO}/packages/brand-md/dist/index.js`);
const { composePartials, extractSkeleton, assembleEmail } = await import(`${MO}/packages/email-assembly/dist/index.js`);

const tokens = compileDesignTokens(readFileSync(join(BRAND, "DESIGN.md"), "utf8"), { compiledAt: "1970-01-01T00:00:00.000Z" });
const partials = {};
for (const f of readdirSync(join(EMAILS, "partials"))) if (f.endsWith(".html")) partials[f.replace(/\.html$/, "")] = readFileSync(join(EMAILS, "partials", f), "utf8");
const ctx = JSON.parse(readFileSync(join(EMAILS, "fixtures", "sample-context.json"), "utf8"));
const recs = ctx.event?.Recommendations ?? [];
const heroImg = recs[0]?.ImageUrl ?? "https://myarthaus.com/cdn/shop/products/hero.jpg";
const products = recs.slice(0, 3).map((r) => ({ name: r.Title, price: r.Price, href: r.ProductUrl, imageUrl: r.ImageUrl, alt: `${r.Title} by ${r.Vendor}` }));

// Mirrors lib/email/assemble.ts DEFAULT_FRAME (2026-08 <tr><td> partial fix).
const DEFAULT_FRAME = (slots) => [
  "<!--PARTIAL:head-->", "<body>",
  '<div class="email-wrapper" style="background-color:#F5F2ED;padding:32px 0;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td align="center">',
  '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container">',
  "  <tr><td><!--PARTIAL:header--></td></tr>",
  ...slots.map((s) => `  <tr><td>{{slot:${s}}}</td></tr>`),
  "  <tr><td><!--PARTIAL:footer--></td></tr>",
  "</table>", "</td></tr></table></div>", "</body>", "</html>",
].join("\n");

const META = (c) => ({ subject: c.subject, previewText: c.previewText, skeletonVersion: "uat" });

const scaffoldCampaigns = [
  {
    name: "editorial-scaffold", title: "Editorial — new collection (scaffold path)",
    subject: "The quiet hours collection", previewText: "Art for the contemplative home — twelve new works in natural light.",
    slots: ["hero", "intro", "products", "closing"],
    sections: [
      { slot: "hero", type: "surface", imageUrl: heroImg, alt: "The Quiet Hours — new collection", width: 1200, height: 680 },
      { slot: "intro", type: "html", block: [
        { kind: "heading", text: "The Quiet Hours", level: 1 },
        { kind: "paragraph", text: "Twelve new works chosen for the contemplative home — pieces that hold a room without demanding it. Photographed as you would live with them: in natural light, with real shadow." },
        { kind: "button", text: "Explore the Edit", href: "https://myarthaus.com/collections/quiet-hours" } ] },
      { slot: "products", type: "html", block: [ { kind: "heading", text: "In This Edit", level: 2 }, { kind: "productRow", products } ] },
      { slot: "closing", type: "html", block: [ { kind: "paragraph", text: "Each work ships framed and ready to hang, with a certificate of authenticity from the artist." } ] },
    ],
  },
  {
    name: "cart-scaffold", title: "Cart reminder (scaffold path)",
    subject: "Still thinking it over?", previewText: "The piece you were considering is still available.",
    slots: ["intro", "products", "closing"],
    sections: [
      { slot: "intro", type: "html", block: [
        { kind: "heading", text: "Still on your wall?", level: 1 },
        { kind: "paragraph", text: "The piece you were considering is still available. No rush — good art waits. But if it's found its place, it's ready when you are." } ] },
      { slot: "products", type: "html", block: [{ kind: "productRow", products: products.slice(0, 1) }] },
      { slot: "closing", type: "html", block: [
        { kind: "button", text: "Return to your cart", href: "https://myarthaus.com/cart" },
        { kind: "paragraph", text: "Questions about sizing or framing? Reply to this email — a real person reads it." } ] },
    ],
  },
];

function renderScaffold(c) {
  const { html: frame, report: cReport } = composePartials(DEFAULT_FRAME(c.slots), partials);
  const { html, report } = assembleEmail({ skeleton: { html: frame, slots: c.slots.map((name) => ({ name })) }, sections: c.sections, tokens, meta: META(c), options: { strict: false } });
  return { html, report, compose: cReport, path: "scaffold" };
}
function renderIngest(templateFile, c) {
  const raw = readFileSync(join(EMAILS, "templates", templateFile), "utf8");
  const { html: full, report: cReport } = composePartials(raw, partials);
  const { skeletonHtml, slots, findings } = extractSkeleton(full);
  const slotNames = slots.map((s) => s.name);
  const { html, report } = assembleEmail({ skeleton: { html: skeletonHtml, slots: slotNames.map((name) => ({ name })) }, sections: c.sections(slotNames), tokens, meta: META(c), options: { strict: false } });
  return { html, report, compose: cReport, extract: { slots: slotNames, findings }, path: `ingest:${templateFile}` };
}

const results = [];
for (const c of scaffoldCampaigns) {
  try { const r = renderScaffold(c); writeFileSync(join(OUT, `${c.name}.html`), r.html); results.push({ ...c, ...r }); }
  catch (e) { results.push({ ...c, error: String(e?.stack ?? e), path: "scaffold" }); }
}
{
  const c = { name: "editorial-ingest", title: "Editorial — ingested from real templates/editorial.html",
    subject: "The quiet hours collection", previewText: "Art for the contemplative home.",
    sections: (slotNames) => slotNames.map((slot, i) => i === 0
      ? { slot, type: "html", block: [ { kind: "heading", text: "The Quiet Hours", level: 1 }, { kind: "paragraph", text: "Twelve new works chosen for the contemplative home." }, { kind: "button", text: "Explore the Edit", href: "https://myarthaus.com/collections/quiet-hours" } ] }
      : { slot, type: "html", block: [{ kind: "productRow", products: products.slice(0, Math.min(3, products.length)) }] }) };
  try { const r = renderIngest("editorial.html", c); writeFileSync(join(OUT, `${c.name}.html`), r.html); results.push({ ...c, ...r }); }
  catch (e) { results.push({ ...c, error: String(e?.stack ?? e), path: "ingest:editorial.html" }); }
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const card = (r) => {
  const rep = r.report, badge = r.error ? "#c0392b" : rep?.ok ? "#2e7d32" : "#b7791f", status = r.error ? "THREW" : rep?.ok ? "OK" : "OK (warnings)";
  const lines = [];
  if (r.error) lines.push(`<pre class="err">${esc(r.error)}</pre>`);
  if (r.extract) lines.push(`<div class="meta">extracted slots: <b>${r.extract.slots.join(", ") || "—"}</b> · findings: ${r.extract.findings.length} (${[...new Set(r.extract.findings.map((f) => f.type))].join(", ") || "none"})</div>`);
  if (rep?.errors?.length) lines.push(`<div class="meta err">errors:<br>${rep.errors.map(esc).join("<br>")}</div>`);
  if (rep?.warnings?.length) lines.push(`<div class="meta warn">warnings:<br>${rep.warnings.map(esc).join("<br>")}</div>`);
  return `<section><h2>${esc(r.title)} <span class="badge" style="background:${badge}">${status}</span></h2><div class="path">${esc(r.path)}${r.error ? "" : ` · <a href="./${r.name}.html" target="_blank">open ↗</a>`}</div>${lines.join("\n")}${r.error ? "" : `<iframe src="./${r.name}.html" loading="lazy"></iframe>`}</section>`;
};
writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset="utf8"><title>Email UAT — Arthaus</title><style>
 body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;background:#f6f4f0;color:#222}
 header{padding:20px 28px;background:#2D2D2D;color:#F5F2ED}header h1{margin:0;font:400 20px/1.2 Georgia,serif;letter-spacing:.05em}header p{margin:6px 0 0;opacity:.75;font-size:12px}
 main{display:grid;grid-template-columns:repeat(auto-fill,minmax(640px,1fr));gap:24px;padding:24px}
 section{background:#fff;border:1px solid #e5e0d8;border-radius:8px;padding:16px;overflow:hidden}h2{margin:0 0 4px;font:400 16px/1.3 Georgia,serif}
 .badge{font:600 10px/1 sans-serif;color:#fff;padding:3px 6px;border-radius:4px;vertical-align:middle}.path{font:11px monospace;color:#888;margin-bottom:10px}
 .meta{font:11px/1.5 monospace;background:#faf8f5;border-radius:4px;padding:6px 8px;margin:6px 0;white-space:pre-wrap}.meta.warn{background:#fff7e6;color:#8a6d3b}.meta.err{background:#fdecea;color:#a12}
 .err{color:#a12;font:11px monospace;white-space:pre-wrap}iframe{width:100%;height:820px;border:1px solid #e5e0d8;border-radius:4px;margin-top:8px;background:#fff}
</style><header><h1>Email Campaign Agent — UAT preview</h1><p>Real Arthaus partials + templates/ + DESIGN.md tokens · vendored pipeline · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</p></header><main>${results.map(card).join("\n")}</main>`);

for (const r of results) {
  if (r.error) { console.log(`✗ ${r.name} [${r.path}] THREW: ${r.error.split("\n")[0]}`); continue; }
  console.log(`${r.report.ok ? "✓" : "•"} ${r.name} [${r.path}] ${r.report.ok ? "OK" : "OK+warn"} — ${r.html.length}b` + (r.extract ? ` · slots[${r.extract.slots.join(",")}] findings=${r.extract.findings.length}` : "") + (r.report.warnings.length ? `\n    warn: ${r.report.warnings.join(" | ")}` : ""));
}
console.log(`\nGallery → ${join(OUT, "index.html")}`);
