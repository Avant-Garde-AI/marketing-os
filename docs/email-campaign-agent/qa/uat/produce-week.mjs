/**
 * Produce a week of sample campaigns — the reviewable backlog.
 *
 * For each shortlisted artist (never spotlighted; see artist-backlog.mjs), builds
 * a full artist-drop campaign:
 *   art graph (their real catalogue + facets) → Gemini authors copy/structure
 *   → assembled on the store's REAL emails/partials frame
 *   → written to marketplace/emails/templates/campaign-<id>.html  (Klaviyo-pushable)
 *   → indexed into Supabase mos_email_campaigns + mos_calendar_items (emitted as
 *     SQL mirroring lib/email/index-sync.ts exactly, applied separately)
 *   → a review index so every piece can be judged side by side
 *
 * Nothing is pushed to Klaviyo and nothing sends: status stays `drafted`.
 *
 *   VERTEX_TOKEN=$(gcloud auth application-default print-access-token) node produce-week.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MO = process.env.MOS_ROOT ?? "/Users/garretteastham/dev/avant-garde/platform/marketing-os";
const STORE = process.env.STORE_ROOT ?? "/Users/garretteastham/dev/arthaus/platform/marketplace";
const EMAILS = join(STORE, "emails");
const BRAND = join(STORE, "agents/brand");
const HERE = new URL("./", import.meta.url).pathname;
const OUT = join(HERE, "out");
const TENANT_ID = process.env.TENANT_ID ?? "bd77037d-0457-4b2a-8cfa-3c7b8656d8b4";

const MODEL = process.env.MODEL ?? "gemini-2.5-flash";
const TEMP = Number(process.env.TEMP ?? "0.75");
const PROJECT = process.env.VERTEX_PROJECT ?? "avant-garde-platform";
const LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";
const TOKEN = process.env.VERTEX_TOKEN?.trim();
if (!TOKEN) throw new Error("VERTEX_TOKEN not set");
const PICASSO_URL = process.env.PICASSO_MCP_URL ?? "https://picasso-concierge-spfdrt2aha-uc.a.run.app/mcp/";

const { compileDesignTokens } = await import(`${MO}/packages/brand-md/dist/index.js`);
const { composePartials, assembleEmail } = await import(`${MO}/packages/email-assembly/dist/index.js`);

const tokens = compileDesignTokens(readFileSync(join(BRAND, "DESIGN.md"), "utf8"), { compiledAt: "1970-01-01T00:00:00.000Z" });
const partials = {};
for (const f of readdirSync(join(EMAILS, "partials"))) if (f.endsWith(".html")) partials[f.replace(/\.html$/, "")] = readFileSync(join(EMAILS, "partials", f), "utf8");
const systemPrompt = readFileSync(join(HERE, "prompt.md"), "utf8");

// The week's schedule — the strategy's Tue/Thu at 10:00, two weeks of slots.
const ONLY = process.env.ONLY_ARTIST;
const SCHEDULE_ALL = [
  { date: "2026-09-01", artist: "83 Oranges" },
  { date: "2026-09-03", artist: "Benjamin Mckay" },
  { date: "2026-09-08", artist: "Shelly Bremmer" },
  { date: "2026-09-10", artist: "MIRIMO" },
];
const SCHEDULE = ONLY ? SCHEDULE_ALL.filter(s=>s.artist===ONLY) : SCHEDULE_ALL;
const AUDIENCE = [{ type: "list", id: "HRSdjT", label: "Arthaus Newsletter" }];

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

async function artistCatalogue(artist, n = 4) {
  const r = await picasso("search_artworks", { query: artist, limit: n + 4 });
  const mine = (r.results ?? []).filter((x) => (x.artist || "").toLowerCase() === artist.toLowerCase());
  const picks = (mine.length ? mine : r.results ?? []).slice(0, n);
  let facets = {};
  try {
    const f = await picasso("get_artwork_facets", { handles: picks.map((p) => p.handle).filter(Boolean) });
    for (const a of f.artworks ?? []) facets[a.handle] = a;
  } catch {}
  return picks.map((p) => {
    const fx = facets[p.handle] ?? facets[(p.handle || "").replace(/-no-frame$|-old$/, "")] ?? {};
    return {
      title: (p.title || "").trim(), vendor: p.artist || artist, handle: p.handle,
      price: (p.price && p.price.trim()) || "View piece", href: p.url, imageUrl: p.image,
      palette: fx.palette ?? [], subject: fx.subject ?? [],
    };
  }).filter((p) => p.title);
}

const responseSchema = {
  type: "object",
  properties: {
    subject: { type: "string" }, previewText: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: {
      slot: { type: "string" },
      kind: { type: "string", enum: ["heading", "paragraph", "button", "productRow", "heroImage", "eyebrow", "callout", "ctaBand", "trustBadges", "divider"] },
      text: { type: "string" }, level: { type: "integer" }, href: { type: "string" },
      productTitles: { type: "array", items: { type: "string" } }, alt: { type: "string" },
      heading: { type: "string" }, buttonText: { type: "string" }, eyebrow: { type: "string" },
      badges: { type: "array", items: { type: "string" } }, emphasis: { type: "boolean" } },
      required: ["slot", "kind"],
      propertyOrdering: ["slot", "kind", "text", "level", "href", "productTitles", "alt", "heading", "buttonText", "eyebrow", "badges", "emphasis"] } },
  },
  required: ["subject", "previewText", "sections"], propertyOrdering: ["subject", "previewText", "sections"],
};

const SLOTS = ["hero", "intro", "works", "closing"];

async function generate(artist, catalogue) {
  const facetText = catalogue.map((p) => `  · "${p.title}" — palette: ${p.palette.join(", ") || "—"}; subject: ${p.subject.slice(0, 4).join(", ") || "—"}`).join("\n");
  const catText = catalogue.map((c, i) => `${i + 1}. "${c.title}"`).join("\n");
  const brief = `Archetype: artist-drop — ${artist} is newly spotlighted on Arthaus. This is the template reused for every new artist.
Audience: Arthaus Newsletter subscribers.
Intent: introduce ${artist} as a person and an aesthetic (artist intimacy, never a CV), then show their work. Ground every art claim in the real facets below — name the actual colours and subjects.
Slots & blocks: hero (heroImage of the lead piece) · intro (eyebrow "New to Arthaus" + heading L1 [the artist's name — put it in text, NEVER alt] + paragraph on their voice/aesthetic) · works (eyebrow + heading L2 + productRow of up to 3 of their pieces) · closing (ctaBand with heading + buttonText "See the collection" + trustBadges).

Art-knowledge-graph context (LIVE from the store's Picasso graph — artist "${artist}"):
${facetText}

Catalogue (use exact titles):
${catText}`;

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: `Draft this campaign email.\n\n${brief}\n\nSlots: ${SLOTS.join(", ")}. Default CTA href: https://myarthaus.com/collections/new` }] }], generationConfig: { responseMimeType: "application/json", responseSchema, temperature: TEMP } }),
        signal: AbortSignal.timeout(50000),
      });
      if (!res.ok) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
      const data = await res.json();
      return { gen: JSON.parse(data.candidates[0].content.parts[0].text), usage: data.usageMetadata ?? {} };
    } catch { await new Promise((r) => setTimeout(r, 2000 * attempt)); }
  }
  throw new Error("generation failed after retries");
}

const isMockup = (u) => /\/mockup-/i.test(u ?? "");

function assemble(gen, catalogue, heroImg) {
  const findCat = (t) => { const q = String(t).trim().toLowerCase(); return catalogue.find((c) => c.title.toLowerCase() === q) ?? catalogue.find((c) => c.title.toLowerCase().includes(q) || q.includes(c.title.toLowerCase())); };
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
    else if (s.kind === "productRow") { const items = (s.productTitles ?? []).map(findCat).filter(Boolean).map((c) => ({ name: c.title, price: c.price, href: c.href, imageUrl: c.imageUrl, alt: `${c.title} by ${c.vendor}` })); const uniq = [...new Map(items.map((i) => [i.name, i])).values()].slice(0, 3); if (!uniq.length) { notes.push("productRow matched nothing"); continue; } b = { kind: "productRow", products: uniq }; }
    else continue;
    if (["heading", "paragraph", "eyebrow", "callout", "button"].includes(b.kind) && !b.text) { notes.push(`empty ${b.kind} in "${s.slot}"`); continue; }
    if (!bySlot.has(s.slot)) bySlot.set(s.slot, []); bySlot.get(s.slot).push(b);
  }
  for (const [slot, blocks] of bySlot) sections.push({ slot, type: "html", block: blocks });

  const FRAME = ["<!--PARTIAL:head-->", "<body>",
    '<div class="email-wrapper" style="background-color:#F5F2ED;padding:32px 0;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td align="center">',
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container">',
    "  <tr><td><!--PARTIAL:header--></td></tr>",
    ...SLOTS.map((s) => `  <tr><td>{{slot:${s}}}</td></tr>`),
    "  <tr><td><!--PARTIAL:footer--></td></tr>",
    "</table>", "</td></tr></table></div>", "</body>", "</html>"].join("\n");
  const { html: frame } = composePartials(FRAME, partials);
  // The store head's <!--TITLE--> marker isn't a PARTIAL — fill it, same as the
  // runtime assemble binding does.
  const titled = frame.replace(/<!--TITLE-->/g, (gen.subject ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  const out = assembleEmail({ skeleton: { html: titled, slots: SLOTS.map((name) => ({ name })) }, sections, tokens, meta: { subject: gen.subject, previewText: gen.previewText, skeletonVersion: "sample" }, options: { strict: false } });
  return { ...out, sections, notes };
}

const sqlStr = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// ---- Run --------------------------------------------------------------------
mkdirSync(join(EMAILS, "templates"), { recursive: true });
const results = []; const sql = [];
for (const { date, artist } of SCHEDULE) {
  const id = `${date}-artist-${artist.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  try {
    console.log(`\n▸ ${artist} (${date})`);
    const catalogue = await artistCatalogue(artist, 4);
    if (!catalogue.length) throw new Error("no catalogue from the graph");
    const heroPiece = catalogue.find((p) => isMockup(p.imageUrl)) ?? catalogue[0];
    const { gen, usage } = await generate(artist, catalogue);
    const { html, report, sections, notes } = assemble(gen, catalogue, heroPiece.imageUrl);

    const repoPath = `emails/templates/campaign-${id}.html`;
    writeFileSync(join(STORE, repoPath), html);
    writeFileSync(join(OUT, `sample-${id}.html`), html);

    const scheduledAt = `${date}T10:00:00-05:00`;
    sql.push(`INSERT INTO mos_email_campaigns (id, tenant_id, calendar_month, archetype, audience_refs, subject, scheduled_at, status, skeleton_ref, repo_path)
VALUES (${sqlStr(id)}, ${sqlStr(TENANT_ID)}, ${sqlStr(date.slice(0, 7))}, 'artist-drop', ${sqlStr(JSON.stringify(AUDIENCE))}::jsonb, ${sqlStr(gen.subject)}, ${sqlStr(scheduledAt)}::timestamptz, 'drafted', 'emails-frame', ${sqlStr(repoPath)})
ON CONFLICT (tenant_id, id) DO UPDATE SET subject=EXCLUDED.subject, scheduled_at=EXCLUDED.scheduled_at, status=EXCLUDED.status, repo_path=EXCLUDED.repo_path, updated_at=now();`);
    sql.push(`INSERT INTO mos_calendar_items (tenant_id, channel, item_id, pack_id, month, scheduled_at, status, title, intent, thumbnail_url)
VALUES (${sqlStr(TENANT_ID)}, 'email', ${sqlStr(id)}, 'email-campaign', ${sqlStr(date.slice(0, 7))}, ${sqlStr(scheduledAt)}::timestamptz, 'drafted', ${sqlStr(gen.subject)}, 'artist-drop', ${sqlStr(heroPiece.imageUrl)})
ON CONFLICT (tenant_id, channel, item_id) DO UPDATE SET month=EXCLUDED.month, scheduled_at=EXCLUDED.scheduled_at, status=EXCLUDED.status, title=EXCLUDED.title, intent=EXCLUDED.intent, thumbnail_url=EXCLUDED.thumbnail_url, updated_at=now();`);

    results.push({ id, date, artist, gen, report, sections, notes, catalogue, heroPiece, repoPath, usage, heroKind: isMockup(heroPiece.imageUrl) ? "lifestyle mockup" : "flat scan" });
    console.log(`  "${gen.subject}"`);
    console.log(`  ${catalogue.map((c) => c.title).join(" · ")}`);
    console.log(`  hero: ${isMockup(heroPiece.imageUrl) ? "lifestyle mockup" : "flat scan"} | assembly ${report.ok ? "OK" : "warnings"} | → ${repoPath}`);
    if (notes.length) console.log(`  notes: ${notes.join(" | ")}`);
  } catch (e) {
    results.push({ id, date, artist, error: String(e.message ?? e) });
    console.log(`  ✗ ${e.message ?? e}`);
  }
}

writeFileSync(join(OUT, "index-sync.sql"), `-- Sample week index rows (mirrors lib/email/index-sync.ts).\n-- Apply with: psql "$DIRECT_URL" -f index-sync.sql\n\n${sql.join("\n\n")}\n`);

// ---- Review index -----------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const card = (r) => r.error
  ? `<section><h2>${esc(r.artist)} <span class="b err">FAILED</span></h2><pre>${esc(r.error)}</pre></section>`
  : `<section>
      <h2>${esc(r.artist)} <span class="b ${r.report.ok ? "ok" : "warn"}">${r.report.ok ? "RENDERS CLEAN" : "WARNINGS"}</span></h2>
      <div class="meta">${esc(r.date)} · 10:00 · Arthaus Newsletter · <code>${esc(r.repoPath)}</code></div>
      <div class="subj"><b>${esc(r.gen.subject)}</b><br><i>${esc(r.gen.previewText)}</i></div>
      <div class="meta">pieces: ${r.catalogue.map((c) => esc(c.title)).join(" · ")}<br>hero: ${esc(r.heroKind)} · blocks: ${r.sections.map((s) => `${esc(s.slot)}:${s.type === "surface" ? "img" : s.block.map((b) => b.kind).join("+")}`).join("  ")}</div>
      ${r.notes.length ? `<div class="note">${r.notes.map(esc).join("<br>")}</div>` : ""}
      <iframe src="./sample-${esc(r.id)}.html"></iframe>
    </section>`;
writeFileSync(join(OUT, "sample-week.html"), `<!doctype html><meta charset="utf8"><title>Sample week — artist drops</title><style>
 body{font:14px/1.6 -apple-system,system-ui,sans-serif;margin:0;background:#f6f4f0;color:#222}
 header{padding:22px 28px;background:#2D2D2D;color:#F5F2ED}header h1{margin:0;font:400 22px/1.2 Georgia,serif;letter-spacing:.04em}header p{margin:6px 0 0;opacity:.75;font-size:12px}
 main{display:grid;grid-template-columns:repeat(auto-fill,minmax(660px,1fr));gap:24px;padding:24px}
 section{background:#fff;border:1px solid #e5e0d8;border-radius:8px;padding:18px}
 h2{margin:0 0 6px;font:400 18px/1.3 Georgia,serif}
 .b{font:600 10px/1 sans-serif;color:#fff;padding:4px 7px;border-radius:4px;vertical-align:middle}.ok{background:#2e7d32}.warn{background:#b7791f}.err{background:#c0392b}
 .meta{font:11.5px/1.6 monospace;color:#6B6560;margin:6px 0}
 .subj{background:#faf8f5;border-radius:4px;padding:10px 12px;margin:8px 0;font-size:14px}
 .note{background:#fff7e6;color:#8a6d3b;border-radius:4px;padding:8px 10px;font:11px monospace;margin:6px 0}
 code{background:#f4f1ec;padding:1px 5px;border-radius:3px}
 iframe{width:100%;height:1500px;border:1px solid #e5e0d8;border-radius:6px;margin-top:10px;background:#fff}
</style>
<header><h1>Sample week — artist drops</h1><p>4 never-spotlighted artists · live Picasso art graph → ${esc(MODEL)} → assembled on the real Arthaus frame · written to emails/templates/ · nothing pushed to Klaviyo, nothing sends</p></header>
<main>${results.map(card).join("\n")}</main>`);

console.log(`\n${results.filter((r) => !r.error).length}/${results.length} produced`);
console.log(`Review  → ${join(OUT, "sample-week.html")}`);
console.log(`Index   → ${join(OUT, "index-sync.sql")}`);
