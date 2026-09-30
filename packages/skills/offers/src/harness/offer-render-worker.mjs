/* eslint-env node */
/**
 * Offer render worker — runs INSIDE a host's sandbox (the hosted app uploads it
 * into a Vercel Sandbox — offer-render.server.ts), or locally for tests. Plain
 * Node + playwright-core, no other dependencies, because the whole file is
 * uploaded as one script. Hosts get it from the pack as
 * `@avant-garde/skill-offers/offer-render-worker.mjs` (or OFFER_RENDER_WORKER_URL).
 *
 *   node offer-render-worker.mjs <task.json>
 *
 * task.json: { outDir, concurrency, fingerprints, storefrontPassword?, tasks: [{ id, url, viewport, mode }] }
 * Writes <outDir>/<id>.jpg per task and <outDir>/results.json.
 *
 * storefrontPassword: for a password-protected storefront (every development
 * store, many stores before launch). Each browser context submits it on the
 * store's /password page before its first real load. The worker deletes it
 * from task.json as soon as it has been read, and never writes it anywhere.
 *
 * Two modes:
 *   audit   — a first-visit look at the merchant's CURRENT popup: wait up to
 *             20 s for an incumbent to appear, measure it (AuditFacts), shoot it.
 *   preview — one of OUR staged offers through the signed preview link: wait
 *             for the runtime's diag handshake (dataset.mosReady), read
 *             window.__mosDiag, shoot it.
 *
 * Safety: every context aborts the storefront runtime's event and capture
 * endpoints — at the network layer AND by patching sendBeacon/fetch before any
 * page script runs. A render visit must never count as an exposure in a live
 * experiment and must never create a customer.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.MOS_PLAYWRIGHT_MODULE || "playwright-core");

const BLOCKED = /\/apps\/mcp\/surfaces\/(events|capture)(\?|$|\/)/;
/** Set once from task.json; module-level so it never rides along in results. */
let storefrontPassword = null;
const TASK_TIMEOUT_MS = 50_000;
const AUDIT_WAIT_MS = 20_000;
const PREVIEW_WAIT_MS = 15_000;

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOBILE_UA },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: CHROME_UA },
};

// Runs in the page before any storefront script. Belt and braces with the
// route abort below: beacons are the one request type interception has
// historically been unreliable for.
function blockInitScript() {
  const re = /\/apps\/mcp\/surfaces\/(events|capture)(\?|$|\/)/;
  const w = window;
  w.__mosBlocked = 0;
  try {
    const beacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (re.test(String(url))) { w.__mosBlocked++; return true; }
      return beacon ? beacon(url, data) : false;
    };
  } catch (e) { /* ignore */ }
  try {
    const f = w.fetch.bind(w);
    w.fetch = function (input, init) {
      const u = typeof input === "string" ? input : input && input.url;
      if (re.test(String(u))) { w.__mosBlocked++; return Promise.reject(new TypeError("blocked by render worker")); }
      return f(input, init);
    };
  } catch (e) { /* ignore */ }
}

/**
 * Popup detection + measurement, evaluated in the page. Pure DOM; returns a
 * plain object. `fps` is the serialized VENDOR_FINGERPRINTS list.
 */
function detectInPage(fps) {
  const vw = innerWidth, vh = innerHeight;
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  };
  const scriptSrcs = [
    ...Array.from(document.scripts).map((s) => s.src).filter(Boolean),
    ...performance.getEntriesByType("resource").map((e) => e.name),
  ];
  let vendorByScript = null;
  for (const fp of fps) {
    const re = fp.scriptSrcPattern ? new RegExp(fp.scriptSrcPattern) : null;
    const hit =
      scriptSrcs.some((s) => fp.scriptSrc.some((needle) => s.includes(needle)) || (re && re.test(s))) ||
      fp.globals.some((g) => { try { return typeof window[g] !== "undefined"; } catch (e) { return false; } });
    if (hit) { vendorByScript = fp.vendor; break; }
  }

  const ours = (el) => !!(el.closest && el.closest("[data-mos-surface]"));
  // One of OUR surfaces on screen: not an incumbent, but worth saying.
  const oursPresent = !!document.querySelector("[data-mos-surface]");
  let dialog = null, vendor = null;
  for (const fp of fps) {
    for (const sel of fp.selectors) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch (e) { nodes = []; }
      const el = nodes.find((n) => visible(n) && !ours(n));
      if (el) { dialog = el; vendor = fp.vendor; break; }
    }
    if (dialog) break;
  }
  if (!dialog) {
    // Unknown vendor: a fixed-position layer holding an email field (or a
    // vendor iframe) that is not one of our surfaces.
    const emailSel = 'input[type="email"],input[name*="email" i],input[autocomplete="email"],input[placeholder*="email" i]';
    const inputs = Array.from(document.querySelectorAll(emailSel)).filter((i) => visible(i) && !ours(i));
    for (const input of inputs) {
      let n = input;
      while (n && n !== document.body) {
        const pos = getComputedStyle(n).position;
        if (pos === "fixed") { dialog = n; break; }
        n = n.parentElement;
      }
      if (dialog) break;
    }
    if (!dialog) {
      const frames = Array.from(document.querySelectorAll("iframe")).filter((f) => {
        if (!visible(f) || ours(f)) return false;
        const src = f.src || "";
        return fps.some((fp) => fp.scriptSrc.some((needle) => src.includes(needle)));
      });
      const big = frames.find((f) => { const r = f.getBoundingClientRect(); return r.width * r.height > vw * vh * 0.08; });
      if (big) dialog = big;
    }
    if (dialog) vendor = vendorByScript || "unknown";
  }
  if (!dialog) return { found: false, vendorByScript, oursPresent };

  // Grow a tiny matched node to its visible panel: the first ancestor with a
  // real box, stopping short of a full-viewport backdrop.
  let panel = dialog;
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  while (panel.parentElement && area(panel) < vw * vh * 0.02 && panel.parentElement !== document.body) {
    panel = panel.parentElement;
  }
  const pr = panel.getBoundingClientRect();
  const clip = {
    x: Math.max(0, pr.left), y: Math.max(0, pr.top),
    w: Math.min(vw, pr.right) - Math.max(0, pr.left), h: Math.min(vh, pr.bottom) - Math.max(0, pr.top),
  };
  const coversPct = Math.max(0, Math.min(1, (clip.w * clip.h) / (vw * vh)));

  const clickables = Array.from(panel.querySelectorAll('button,[role="button"],a,input[type="submit"]')).filter(visible);
  const label = (el) => ((el.getAttribute("aria-label") || "") + " " + (el.textContent || "") + " " + (el.getAttribute("title") || "")).trim();
  const closeEl = clickables.find((el) => /close|dismiss|×|✕|✖/i.test(label(el)) || /^\s*x\s*$/i.test(el.textContent || ""));
  const ctaEl =
    clickables.find((el) => el !== closeEl && (el.type === "submit" || el.getAttribute("type") === "submit")) ||
    clickables.find((el) => el !== closeEl && label(el).length > 1 && label(el).length < 60 && !/no thanks|close|dismiss/i.test(label(el)));
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };

  const parseColor = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const bgOf = (el) => {
    let n = el;
    while (n) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  let ctaContrast = null;
  if (ctaEl) {
    const fg = parseColor(getComputedStyle(ctaEl).color);
    const bg = bgOf(ctaEl);
    if (fg) {
      const a = lum(fg), b = lum(bg);
      ctaContrast = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
    }
  }
  const text = (panel.innerText || "").replace(/\s+\n/g, "\n").trim().slice(0, 2000);
  const hasImage =
    Array.from(panel.querySelectorAll("img,picture,video")).some((i) => { const r = i.getBoundingClientRect(); return r.width > 80 && r.height > 80; }) ||
    Array.from(panel.querySelectorAll("*")).slice(0, 400).some((n) => /url\(/.test(getComputedStyle(n).backgroundImage) && n.getBoundingClientRect().width > 80);
  const incentive = text.match(/\b\d{1,2}\s?%\s?off\b|\b\d{1,2}\s?%|free shipping|\$\s?\d+\s?off|free gift|discount/i);
  return {
    found: true,
    vendor,
    vendorByScript,
    oursPresent,
    panel: clip,
    coversPct: Math.round(coversPct * 1000) / 1000,
    closeTarget: rect(closeEl),
    closeVisible: !!closeEl,
    ctaTarget: rect(ctaEl),
    ctaContrast,
    hasImage,
    hasConsentText: /privacy|unsubscribe|consent|terms|agree|opt[ -]?out/i.test(text),
    incentiveText: incentive ? incentive[0] : null,
    visibleText: text,
    isFrame: panel.tagName === "IFRAME",
  };
}

function vendorScriptKbInPage({ fps, vendor }) {
  const fp = fps.find((f) => f.vendor === vendor);
  if (!fp) return null;
  const re = fp.scriptSrcPattern ? new RegExp(fp.scriptSrcPattern) : null;
  let bytes = 0;
  for (const e of performance.getEntriesByType("resource")) {
    if (fp.scriptSrc.some((n) => e.name.includes(n)) || (re && re.test(e.name))) {
      bytes += e.transferSize || e.encodedBodySize || 0;
    }
  }
  return bytes ? Math.round(bytes / 102.4) / 10 : null;
}

async function withTimeout(p, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }
}

/** The faces the storefront actually renders — what an offer should use.
 * A computed font-family is only a request: DESIGN.md and even the theme's own
 * CSS can name faces that never load (myarthaus.com's headings ask for
 * "Didot-Regular", which errors, and fall back). So each element's stack is
 * resolved to its first family the page really loaded; display is the largest
 * visible text that resolves to something other than the body face. */
async function storefrontFontsInPage() {
  try { await document.fonts.ready; } catch (e) { /* measure what we have */ }
  const loaded = new Set();
  document.fonts.forEach((f) => { if (f.status === "loaded") loaded.add(f.family.replace(/^["']|["']$/g, "").toLowerCase()); });
  const generic = /^(serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-[a-z-]+|-apple-system)$/i;
  const resolve = (stack) => {
    const fams = String(stack || "").split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
    const hit = fams.find((f) => loaded.has(f.toLowerCase()));
    if (!hit) return null;
    const tail = fams.find((f) => generic.test(f));
    return `"${hit}"${tail ? `, ${tail}` : ""}`;
  };
  const skip = (el) => !!(el.closest && el.closest("[data-mos-surface],[role=dialog],[aria-modal=true]"));
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const texty = Array.from(document.body.querySelectorAll("h1,h2,h3,p,span,a,div,li"))
    .slice(0, 2500)
    .filter((el) => !skip(el) && visible(el) && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 2));
  const body = resolve(getComputedStyle(document.body).fontFamily) ||
    resolve((texty.find((el) => el.tagName === "P") && getComputedStyle(texty.find((el) => el.tagName === "P")).fontFamily) || "");
  const bySize = texty
    .map((el) => ({ el, size: parseFloat(getComputedStyle(el).fontSize) || 0 }))
    .sort((a, b) => b.size - a.size);
  let display = null;
  for (const { el, size } of bySize) {
    if (size < 24) break;
    const f = resolve(getComputedStyle(el).fontFamily);
    if (f && f !== body) { display = f; break; }
  }
  const monoEl = texty.find((el) => /mono/i.test(getComputedStyle(el).fontFamily) && resolve(getComputedStyle(el).fontFamily));
  return { body, display, mono: monoEl ? resolve(getComputedStyle(monoEl).fontFamily) : null };
}

/** Shopify answers bursts of headless loads with a generic "There was a
 * problem loading this website" page. That is the storefront throttling us,
 * not the offer failing: back off and load again (3 tries), and report it as
 * `storefront_unavailable` if it never clears so callers can tell the two apart. */
/** Shopify's password gate: every storefront path redirects to /password. */
function onPasswordPage(page) {
  try { return /^\/password\/?$/.test(new URL(page.url()).pathname); } catch (e) { return false; }
}

/** Submit the storefront password the way a visitor would. The field usually
 * sits in a closed modal, so it is filled and submitted in-page rather than
 * clicked. Throws storefront_password_required / _rejected so callers can tell
 * a locked store from a broken offer. */
async function unlockStorefront(page) {
  if (!storefrontPassword) throw new Error("storefront_password_required");
  const submitted = await page.evaluate((pw) => {
    const input = document.querySelector('form input[type="password"]');
    if (!input || !input.form) return false;
    input.value = pw;
    input.form.submit();
    return true;
  }, storefrontPassword);
  if (!submitted) throw new Error("storefront_password_required");
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(300);
  if (onPasswordPage(page)) throw new Error("storefront_password_rejected");
}

async function gotoStorefront(page, url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (onPasswordPage(page)) {
      // The unlock visit is not the measured one: load the real URL again so
      // an audit's clock and a preview's handshake start on the storefront.
      await unlockStorefront(page);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (onPasswordPage(page)) throw new Error("storefront_password_rejected");
    }
    const blocked = await page
      .evaluate(() => /There was a problem loading this website/i.test(document.body ? document.body.innerText.slice(0, 400) : ""))
      .catch(() => false);
    if (!blocked) return true;
    await page.waitForTimeout(3000 * attempt + Math.floor(Math.random() * 1500));
  }
  return false;
}

async function runAudit(page, task, fps) {
  const started = Date.now();
  if (!(await gotoStorefront(page, task.url))) throw new Error("storefront_unavailable");
  let first = null;
  let firstAt = null;
  let lastVendorByScript = null;
  let oursPresent = false;
  while (Date.now() - started < (task.waitMs || AUDIT_WAIT_MS)) {
    const r = await page.evaluate(detectInPage, fps).catch(() => null);
    if (r) {
      lastVendorByScript = r.vendorByScript || lastVendorByScript;
      oursPresent = oursPresent || !!r.oursPresent;
    }
    if (r && r.found) {
      first = r;
      firstAt = await page.evaluate(() => Math.round(performance.now())).catch(() => Date.now() - started);
      break;
    }
    await page.waitForTimeout(400);
  }
  let settled = first;
  if (first) {
    // Let the entrance animation finish before measuring and shooting.
    await page.waitForTimeout(1500);
    settled = (await page.evaluate(detectInPage, fps).catch(() => null)) || first;
    if (!settled.found) settled = first;
  } else {
    await page.waitForTimeout(500);
  }
  const vendor = settled ? settled.vendor : lastVendorByScript;
  const kb = vendor ? await page.evaluate(vendorScriptKbInPage, { fps, vendor }).catch(() => null) : null;
  const blocked = await page.evaluate(() => window.__mosBlocked || 0).catch(() => 0);
  const fonts = await page.evaluate(storefrontFontsInPage).catch(() => null);
  const facts = {
    viewport: task.viewport,
    vendor: settled ? settled.vendor : lastVendorByScript || null,
    appeared: !!settled,
    timeToShowMs: firstAt,
    coversPct: settled ? settled.coversPct : null,
    closeTarget: settled ? settled.closeTarget : null,
    ctaTarget: settled ? settled.ctaTarget : null,
    ctaContrast: settled ? settled.ctaContrast : null,
    hasImage: settled ? settled.hasImage : false,
    hasConsentText: settled ? settled.hasConsentText : false,
    stepCount: null,
    incentiveText: settled ? settled.incentiveText : null,
    visibleText: settled ? settled.visibleText : "",
    closeVisibleAtFirstPaint: first ? first.closeVisible : null,
    vendorScriptKb: kb,
    renderId: null,
  };
  return { facts, extra: { panel: settled ? settled.panel : null, vendorByScript: lastVendorByScript, oursPresent, blockedBeacons: blocked, fonts, finalUrl: page.url() } };
}

async function runPreview(page, task) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message ? e.message : e).slice(0, 300)));
  if (!(await gotoStorefront(page, task.url))) {
    return { facts: null, extra: { ready: false, unavailable: true, pageErrors: [], blockedBeacons: 0, finalUrl: page.url() } };
  }
  let ready = false;
  try {
    await page.waitForFunction(() => document.documentElement.dataset.mosReady === "1", null, {
      timeout: task.waitMs || PREVIEW_WAIT_MS,
      polling: 250,
    });
    ready = true;
  } catch (e) { /* not ready: report it rather than fail the batch */ }
  // Let late image decodes land before the shot; the runtime already disabled
  // animations under mos_diag=1.
  await page.waitForTimeout(ready ? 600 : 200);
  const diag = ready ? await page.evaluate(() => window.__mosDiag || null).catch(() => null) : null;
  const blocked = await page.evaluate(() => window.__mosBlocked || 0).catch(() => 0);
  return { facts: diag, extra: { ready, pageErrors: errors.slice(0, 10), blockedBeacons: blocked, finalUrl: page.url() } };
}

async function runTask(browser, task, fps, outDir) {
  const t0 = Date.now();
  const vp = VIEWPORTS[task.viewport] || VIEWPORTS.desktop;
  const context = await browser.newContext({ ...vp, locale: "en-US", serviceWorkers: "block" });
  let blockedRequests = 0;
  await context.route(BLOCKED, (route) => { blockedRequests++; return route.abort(); });
  await context.addInitScript(blockInitScript);
  const page = await context.newPage();
  try {
    const run = task.mode === "audit" ? runAudit(page, task, fps) : runPreview(page, task);
    const { facts, extra } = await withTimeout(run, TASK_TIMEOUT_MS, `task ${task.id}`);
    const file = join(outDir, `${task.id}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 80, fullPage: false, timeout: 15_000 });
    return { id: task.id, ok: true, file, facts, extra: { ...extra, blockedRequests }, ms: Date.now() - t0 };
  } catch (err) {
    let file = null;
    try {
      file = join(outDir, `${task.id}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 80, timeout: 5_000 });
    } catch (e) { file = null; }
    return { id: task.id, ok: false, file, error: String(err && err.message ? err.message : err).slice(0, 500), extra: { blockedRequests }, ms: Date.now() - t0 };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (spec.storefrontPassword) {
    storefrontPassword = String(spec.storefrontPassword);
    delete spec.storefrontPassword;
    try { writeFileSync(process.argv[2], JSON.stringify(spec)); } catch (e) { /* read-only mount: the sandbox is torn down anyway */ }
  }
  const outDir = spec.outDir;
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--hide-scrollbars", "--mute-audio"],
  });
  const results = [];
  const queue = spec.tasks.slice();
  const workers = Array.from({ length: Math.max(1, Math.min(4, spec.concurrency || 2)) }, async () => {
    for (;;) {
      const task = queue.shift();
      if (!task) return;
      results.push(await runTask(browser, task, spec.fingerprints || [], outDir));
    }
  });
  await Promise.all(workers);
  await browser.close().catch(() => {});
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
