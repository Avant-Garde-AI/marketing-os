/**
 * Rebuild the sample-week review page from what actually exists — the rendered
 * files on disk plus a caller-supplied index (so a partial re-run of
 * produce-week.mjs, e.g. ONLY_ARTIST=…, never leaves a review page showing one
 * campaign when four were produced).
 *
 *   node rebuild-review.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL("./", import.meta.url).pathname;
const OUT = join(HERE, "out");

// Ordered by send date; kept here (not in the DB) so this stays runnable
// without credentials. Mirrors the produce-week schedule.
const WEEK = [
  { date: "2026-09-01", artist: "83 Oranges", id: "2026-09-01-artist-83-oranges" },
  { date: "2026-09-03", artist: "Benjamin Mckay", id: "2026-09-03-artist-benjamin-mckay" },
  { date: "2026-09-08", artist: "Shelly Bremmer", id: "2026-09-08-artist-shelly-bremmer" },
  { date: "2026-09-10", artist: "MIRIMO", id: "2026-09-10-artist-mirimo" },
];

const files = new Set(readdirSync(OUT).filter((f) => f.startsWith("sample-") && f.endsWith(".html")));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const cards = WEEK.map((w) => {
  const file = `sample-${w.id}.html`;
  if (!files.has(file)) {
    return `<section><h2>${esc(w.artist)} <span class="b err">NOT PRODUCED</span></h2><div class="meta">${esc(w.date)}</div></section>`;
  }
  const html = readFileSync(join(OUT, file), "utf8");
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) ?? [])[1]?.trim() ?? "(no subject)";
  const preheader = (html.match(/class="eab-preheader"[^>]*>([\s\S]{0,160}?)(?:&#847;|<)/i) ?? [])[1]?.trim() ?? "";
  const blocks = [...new Set([...html.matchAll(/class="eab-(\w+)/g)].map((m) => m[1]))].join(", ");
  return `<section>
    <h2>${esc(w.artist)} <span class="b ok">RENDERED</span></h2>
    <div class="meta">${esc(w.date)} · 10:00 · Arthaus Newsletter · <code>emails/templates/campaign-${esc(w.id)}.html</code></div>
    <div class="subj"><b>${esc(title)}</b>${preheader ? `<br><i>${esc(preheader)}</i>` : ""}</div>
    <div class="meta">${(html.length / 1024).toFixed(1)} KB · blocks: ${esc(blocks)}</div>
    <iframe src="./${file}"></iframe>
  </section>`;
}).join("\n");

writeFileSync(join(OUT, "sample-week.html"), `<!doctype html><meta charset="utf8"><title>Sample week — artist drops</title><style>
 body{font:14px/1.6 -apple-system,system-ui,sans-serif;margin:0;background:#f6f4f0;color:#222}
 header{padding:22px 28px;background:#2D2D2D;color:#F5F2ED}header h1{margin:0;font:400 22px/1.2 Georgia,serif;letter-spacing:.04em}header p{margin:6px 0 0;opacity:.75;font-size:12px}
 main{display:grid;grid-template-columns:repeat(auto-fill,minmax(660px,1fr));gap:24px;padding:24px}
 section{background:#fff;border:1px solid #e5e0d8;border-radius:8px;padding:18px}
 h2{margin:0 0 6px;font:400 18px/1.3 Georgia,serif}
 .b{font:600 10px/1 sans-serif;color:#fff;padding:4px 7px;border-radius:4px;vertical-align:middle}.ok{background:#2e7d32}.err{background:#c0392b}
 .meta{font:11.5px/1.6 monospace;color:#6B6560;margin:6px 0}
 .subj{background:#faf8f5;border-radius:4px;padding:10px 12px;margin:8px 0;font-size:14px}
 code{background:#f4f1ec;padding:1px 5px;border-radius:3px}
 iframe{width:100%;height:1500px;border:1px solid #e5e0d8;border-radius:6px;margin-top:10px;background:#fff}
</style>
<header><h1>Sample week — artist drops</h1><p>4 never-spotlighted artists · live Picasso art graph → gemini-2.5-flash → assembled on the real Arthaus frame · written to emails/templates/ + indexed in Supabase · nothing pushed to Klaviyo, nothing sends</p></header>
<main>${cards}</main>`);

console.log(`rebuilt with ${WEEK.filter((w) => files.has(`sample-${w.id}.html`)).length}/${WEEK.length} campaigns → ${join(OUT, "sample-week.html")}`);
