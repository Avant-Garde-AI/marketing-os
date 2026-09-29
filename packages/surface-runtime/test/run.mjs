#!/usr/bin/env node
// Surface runtime harness (spec 34 OH1/OH3/OH6).
//
//   pnpm --filter @avant-garde/surface-runtime test   # build dist/, then everything
//   node test/run.mjs --only quiz                                    # cases whose name contains "quiz"
//   MOS_RUNTIME=<0.5.0 file> node test/run.mjs --update-v1-snapshot
//
// Runs against dist/ (MOS_RUNTIME overrides — point it at a host's shipped
// asset to test exactly those bytes).
//
// Renders every fixture at 390×844 (touch) and 1440×900, screenshots each
// step into __screenshots__/, and asserts the contract: v1 DOM unchanged,
// DiagReport populated, 44px targets, AA contrast, cell + answers on the
// wire, Klaviyo suppress/observe, previews silent, no console errors, no
// requests beyond the store origin + cdn.shopify.com.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { startServer, IMG_DIR, RUNTIME, REWARD_CODE } from "./server.mjs";
import { IMAGES } from "./art.mjs";
import { MATRIX, FLOWS, FIXTURES } from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "__screenshots__");
const V1_SNAPSHOT = join(HERE, "__snapshots__", "v1-dom.json");
const args = process.argv.slice(2);
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const UPDATE_V1 = args.includes("--update-v1-snapshot");

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const CONSENT_RE = /^By joining you agree/;

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  ✗ ${name}${detail !== undefined ? " — " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureImages(browser) {
  mkdirSync(IMG_DIR, { recursive: true });
  const page = await browser.newPage();
  for (const [name, { w, h, html }] of Object.entries(IMAGES)) {
    const file = join(IMG_DIR, name);
    if (existsSync(file)) continue;
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(html);
    await page.screenshot({ path: file, type: "jpeg", quality: 86 });
  }
  await page.close();
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  await ensureImages(browser);
  mkdirSync(join(SHOTS, "mobile"), { recursive: true });
  mkdirSync(join(SHOTS, "desktop"), { recursive: true });

  const reset = () => { server.log.length = 0; };
  const events = () => server.log.filter((l) => l.kind === "event").map((l) => l.body);
  const captures = () => server.log.filter((l) => l.kind === "capture").map((l) => l.body);

  // A fresh context per case: clean localStorage, its own error/request log.
  async function open(vp, path, opts = {}) {
    const ctx = await browser.newContext({ ...VIEWPORTS[vp], ...(opts.context || {}) });
    await ctx.route("https://cdn.shopify.com/**", (route) => {
      const f = join(IMG_DIR, route.request().url().split("/").pop().replace(/[^a-z0-9.-]/gi, ""));
      if (!existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: "image/jpeg", body: readFileSync(f) });
    });
    if (opts.storage) {
      await ctx.addInitScript((s) => {
        if (sessionStorage.getItem("__seeded")) return;
        sessionStorage.setItem("__seeded", "1");
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
      }, opts.storage);
    }
    const page = await ctx.newPage();
    const errors = [], foreign = [], diagLoads = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => {
      const u = r.url();
      if (!u.startsWith(server.base) && !u.startsWith("https://cdn.shopify.com/") && !u.startsWith("data:")) foreign.push(u);
      if (u.includes("surface-diag.js")) diagLoads.push(u);
    });
    await page.goto(server.base + path, opts.referer ? { referer: opts.referer } : {});
    return {
      page, ctx, errors, foreign,
      async done(name) {
        check(`${name}: no console errors`, errors.length === 0, errors);
        check(`${name}: no requests beyond store + cdn.shopify.com`, foreign.length === 0, foreign);
        // Diagnostics are a preview-only download.
        check(`${name}: surface-diag.js only for mos_diag`, path.includes("mos_diag=1") ? diagLoads.length === 1 : diagLoads.length === 0, diagLoads);
        await ctx.close();
      },
    };
  }
  const host = (page, id) => page.locator(`[data-mos-surface="${id}"]`);
  const inCard = (page, id, sel) => page.locator(`[data-mos-surface="${id}"] ${sel}`);
  const shot = (page, vp, name) => page.screenshot({ path: join(SHOTS, vp, name + ".png") });
  async function waitFor(fn, ms = 4000) {
    const t = Date.now();
    while (Date.now() - t < ms) { if (fn()) return true; await wait(50); }
    return fn();
  }
  const run = async (name, fn) => {
    if (ONLY && !name.includes(ONLY)) return;
    console.log(`• ${name}`);
    try { await fn(); } catch (e) { check(`${name}: threw`, false, String(e && e.stack || e)); }
  };

  /* ── A. preview + diag across the matrix and every step of every flow ── */
  async function previewDiag(vp, fx, step, extra = "") {
    const q = `/?fx=${fx}&mos_preview=tok&mos_arm=v1&mos_diag=1&mos_step=${step}${extra}`;
    const o = await open(vp, q);
    await o.page.waitForFunction(() => document.documentElement.dataset.mosReady === "1", null, { timeout: 12000 });
    const diag = await o.page.evaluate(() => window.__mosDiag);
    return { o, diag };
  }
  function assertDiag(name, diag, { vp, v2 = true, hasImage, emailStep }) {
    check(`${name}: diag populated`, diag && diag.surfaceId && diag.rects && diag.rects.card && diag.rects.card.w > 0 && diag.viewport.w > 0 && Array.isArray(diag.contrast), diag);
    if (!diag) return;
    check(`${name}: diag errors empty`, diag.errors.length === 0, diag.errors);
    if (hasImage !== undefined) check(`${name}: imageLoaded`, hasImage ? diag.imageLoaded === true : diag.imageLoaded === null, diag.imageLoaded);
    if (!v2) return;
    check(`${name}: no overflow`, diag.overflow === false, diag.rects);
    const r = diag.rects;
    const targets = { close: r.close, cta: r.cta, input: r.input, decline: r.decline };
    r.choices.forEach((c, i) => (targets["choice" + i] = c));
    for (const [k, t] of Object.entries(targets)) {
      if (t) check(`${name}: ${k} ≥44×44`, t.w >= 44 && t.h >= 44, t);
    }
    check(`${name}: close present at first paint`, !!r.close);
    for (const c of diag.contrast) {
      const min = c.role === "headline" ? 3 : 4.5;
      check(`${name}: contrast ${c.role} ≥${min}`, c.ratio >= min, c);
    }
    check(`${name}: contrast covers headline/cta`, diag.contrast.some((c) => c.role === "headline" || c.role === "cta"), diag.contrast);
    if (emailStep && r.cta) check(`${name}: CTA above the fold`, r.cta.y + r.cta.h <= diag.viewport.h, r.cta);
    if (vp === "mobile" && r.card && /corner/.test(name)) check(`${name}: corner card ≤85vw`, r.card.w <= 0.85 * diag.viewport.w + 1, r.card);
  }

  for (const vp of Object.keys(VIEWPORTS)) {
    for (const fx of MATRIX) {
      await run(`preview ${vp} ${fx}`, async () => {
        reset();
        const { o, diag } = await previewDiag(vp, fx, 0);
        await shot(o.page, vp, `${fx}`);
        assertDiag(`${vp} ${fx}`, diag, { vp, hasImage: !fx.includes("editorial"), emailStep: true });
        check(`${vp} ${fx}: composition in diag`, diag.composition === FIXTURES[fx].variants.v1.composition, diag.composition);
        await o.done(`${vp} ${fx}`);
        check(`${vp} ${fx}: preview sent nothing`, server.log.length === 0, server.log);
      });
    }
    for (const fx of FLOWS) {
      const steps = FIXTURES[fx].variants.v1.steps;
      for (let s = 0; s < steps.length; s++) {
        await run(`preview ${vp} ${fx} step ${s}`, async () => {
          reset();
          const { o, diag } = await previewDiag(vp, fx, s);
          await shot(o.page, vp, `${fx}-s${s}`);
          const comp = FIXTURES[fx].variants.v1.composition;
          assertDiag(`${vp} ${fx} s${s}`, diag, { vp, hasImage: comp !== "editorial-type", emailStep: steps[s].blocks.some((b) => b.kind === "email") });
          check(`${vp} ${fx} s${s}: step/steps`, diag.step === s && diag.steps === steps.length, diag);
          await o.done(`${vp} ${fx} s${s}`);
          check(`${vp} ${fx} s${s}: preview sent nothing`, server.log.length === 0, server.log);
        });
      }
    }
    await run(`preview ${vp} drop-mobile`, async () => {
      const { o, diag } = await previewDiag(vp, "drop-mobile", 0);
      await shot(o.page, vp, "drop-mobile");
      assertDiag(`${vp} drop-mobile`, diag, { vp, hasImage: vp === "desktop", emailStep: true });
      await o.done(`${vp} drop-mobile`);
    });
    await run(`preview ${vp} v1 diag`, async () => {
      reset();
      const { o, diag } = await previewDiag(vp, "v1", 0);
      await shot(o.page, vp, "v1-preview");
      assertDiag(`${vp} v1`, diag, { vp, v2: false, hasImage: true });
      check(`${vp} v1: composition v1`, diag.composition === "v1" && diag.steps === 1, diag);
      check(`${vp} v1: contrast measured`, diag.contrast.length >= 3, diag.contrast);
      await o.done(`${vp} v1 diag`);
      check(`${vp} v1 preview sent nothing`, server.log.length === 0, server.log);
    });
  }
  await run("preview mobile teaser (mos_teaser=1)", async () => {
    reset();
    const { o, diag } = await previewDiag("mobile", "search", 0, "&mos_teaser=1");
    await shot(o.page, "mobile", "search-teaser-preview");
    check("teaser preview: pill measured", diag.rects.card && diag.rects.card.h >= 44 && diag.rects.card.w >= 44, diag.rects);
    check("teaser preview: no card", (await host(o.page, "search").count()) === 0);
    check("teaser preview: label", (await inCard(o.page, "search-teaser", ".pill").textContent()) === "A letter from the studio");
    check("teaser preview: pill contrast", diag.contrast.every((c) => c.ratio >= 4.5), diag.contrast);
    await o.done("teaser preview");
    check("teaser preview sent nothing", server.log.length === 0, server.log);
  });

  /* ── B. v1 renders the same DOM as 0.5.0 ─────────────────────────── */
  const v1Sig = {};
  for (const vp of Object.keys(VIEWPORTS)) {
    await run(`v1 live ${vp}`, async () => {
      reset();
      const o = await open(vp, "/?fx=v1");
      await host(o.page, "v1-welcome").waitFor({ state: "attached" });
      await wait(900);
      await shot(o.page, vp, "v1-live");
      v1Sig[vp] = await o.page.evaluate(() => {
        const h = document.querySelector('[data-mos-surface="v1-welcome"]');
        const sig = (n) => {
          if (n.nodeType === 3) return n.textContent.trim() ? "#" + n.textContent.trim() : null;
          if (n.nodeType !== 1) return null;
          const a = [...n.attributes].map((x) => x.name + "=" + x.value).sort();
          return { t: n.tagName.toLowerCase(), a, c: [...n.childNodes].map(sig).filter(Boolean) };
        };
        return [...h.shadowRoot.childNodes].map(sig);
      });
      if (!UPDATE_V1) {
        const snap = JSON.parse(readFileSync(V1_SNAPSHOT, "utf8"));
        const same = JSON.stringify(snap[vp]) === JSON.stringify(v1Sig[vp]);
        check(`v1 ${vp}: DOM + CSS identical to 0.5.0`, same, same ? undefined : "shadow DOM signature differs from __snapshots__/v1-dom.json");
      }
      // v1 capture still works and now carries the cell.
      await inCard(o.page, "v1-welcome", "input[type=email]").fill("v1@example.com");
      await inCard(o.page, "v1-welcome", "button.cta").click();
      await inCard(o.page, "v1-welcome", ".ok").waitFor();
      await waitFor(() => events().some((e) => e.event === "capture"));
      const cap = captures()[0];
      check(`v1 ${vp}: capture carries cell`, cap && cap.cell === `${vp}.new.direct` && cap.email === "v1@example.com" && CONSENT_RE.test(cap.consentText), cap);
      check(`v1 ${vp}: every event carries cell`, events().length >= 3 && events().every((e) => e.cell === `${vp}.new.direct`), events());
      await o.done(`v1 live ${vp}`);
    });
  }
  if (UPDATE_V1 && Object.keys(v1Sig).length === 2) {
    mkdirSync(dirname(V1_SNAPSHOT), { recursive: true });
    writeFileSync(V1_SNAPSHOT, JSON.stringify(v1Sig, null, 1));
    console.log(`  wrote ${V1_SNAPSHOT} from ${RUNTIME}`);
  }

  /* ── C. the 3-step zero-party quiz, live ─────────────────────────── */
  for (const vp of Object.keys(VIEWPORTS)) {
    await run(`quiz live ${vp}`, async () => {
      reset();
      const o = await open(vp, "/?fx=quiz");
      const p = o.page;
      await inCard(p, "quiz", ".opt").first().waitFor();
      await wait(700);
      await shot(p, vp, "quiz-live-s0");
      await inCard(p, "quiz", ".opt").filter({ hasText: "Bedroom" }).click();
      await inCard(p, "quiz", "input[type=email]").waitFor();
      await wait(700);
      await shot(p, vp, "quiz-live-s1");
      await inCard(p, "quiz", "input[type=email]").fill("quiz@example.com");
      await inCard(p, "quiz", "button.cta").click();
      await inCard(p, "quiz", ".picks").waitFor();
      await wait(800);
      await shot(p, vp, "quiz-live-s2");
      const titles = await inCard(p, "quiz", ".pick span").allTextContents();
      check(`quiz ${vp}: picks for the chosen answer`, titles[0] && titles[0].startsWith("Nocturne II"), titles);
      await waitFor(() => events().filter((e) => e.event === "step").length >= 2);
      const ev = events(), cell = `${vp}.new.direct`;
      const ans = ev.find((e) => e.event === "answer");
      check(`quiz ${vp}: answer event`, ans && ans.answerKey === "room" && ans.answerValue === "bedroom" && ans.step === 0 && ans.cell === cell, ans);
      check(`quiz ${vp}: step events 1,2`, JSON.stringify(ev.filter((e) => e.event === "step").map((e) => e.step)) === "[1,2]", ev.filter((e) => e.event === "step"));
      check(`quiz ${vp}: all events carry cell`, ev.every((e) => e.cell === cell), ev.map((e) => e.cell));
      for (const k of ["exposure", "impression", "engage", "capture"]) check(`quiz ${vp}: ${k} event`, ev.some((e) => e.event === k));
      const cap = captures()[0];
      check(`quiz ${vp}: capture has answers + cell + consent`, cap && cap.answers && cap.answers.room === "bedroom" && cap.cell === cell && CONSENT_RE.test(cap.consentText) && cap.arm === "v1", cap);
      await o.done(`quiz ${vp}`);
    });
  }

  /* ── D. code reward, live ────────────────────────────────────────── */
  for (const vp of Object.keys(VIEWPORTS)) {
    await run(`code live ${vp}`, async () => {
      reset();
      const o = await open(vp, "/?fx=code", { context: { permissions: ["clipboard-read", "clipboard-write"] } });
      const p = o.page;
      await inCard(p, "code", "button.cta").waitFor();
      await inCard(p, "code", "button.cta").click();
      await inCard(p, "code", "input[type=email]").fill("code@example.com");
      await inCard(p, "code", "button.cta").click();
      await inCard(p, "code", ".code").waitFor();
      await wait(800);
      await shot(p, vp, "code-live-reward");
      const code = await inCard(p, "code", ".code b").textContent();
      check(`code ${vp}: shows server code`, code === REWARD_CODE, code);
      const href = await inCard(p, "code", "a.cta").getAttribute("href");
      check(`code ${vp}: auto-apply link`, href === `/discount/${REWARD_CODE}?redirect=%2F`, href);
      await inCard(p, "code", ".cp").click();
      await wait(200);
      check(`code ${vp}: copy button`, (await inCard(p, "code", ".cp").textContent()) === "Copied");
      const lnk = await inCard(p, "code", "a.lnk").getAttribute("href");
      check(`code ${vp}: secondary link`, lnk === "/collections/new", lnk);
      // Closing after capture is not a dismissal.
      await inCard(p, "code", ".x").click();
      await wait(300);
      check(`code ${vp}: closed`, (await host(p, "code").count()) === 0);
      check(`code ${vp}: no dismiss after capture`, !events().some((e) => e.event === "dismiss"), events().map((e) => e.event));
      await o.done(`code ${vp}`);
    });
  }

  /* ── E. mobile search arrival: teaser first ──────────────────────── */
  await run("search arrival mobile → teaser first", async () => {
    reset();
    const o = await open("mobile", "/?fx=search", { referer: "https://www.google.com/" });
    const p = o.page;
    await inCard(p, "search-teaser", ".pill").waitFor();
    await wait(600);
    await shot(p, "mobile", "search-teaser-live");
    check("search mobile: no card before tap", (await host(p, "search").count()) === 0);
    await waitFor(() => events().some((e) => e.event === "teaser"));
    const t = events().find((e) => e.event === "teaser");
    check("search mobile: teaser event with search cell", t && t.cell === "mobile.new.search", t);
    check("search mobile: no impression before tap", !events().some((e) => e.event === "impression"));
    await inCard(p, "search-teaser", ".pill").tap();
    await inCard(p, "search", ".card").waitFor();
    await wait(700);
    await shot(p, "mobile", "search-opened");
    await waitFor(() => events().some((e) => e.event === "impression"));
    check("search mobile: impression after tap", events().some((e) => e.event === "impression" && e.cell === "mobile.new.search"));
    await o.done("search mobile");
  });
  await run("search arrival desktop → card", async () => {
    reset();
    const o = await open("desktop", "/?fx=search", { referer: "https://www.bing.com/search?q=art" });
    await inCard(o.page, "search", ".card").waitFor();
    check("search desktop: no pill", (await host(o.page, "search-teaser").count()) === 0);
    await waitFor(() => events().some((e) => e.event === "impression"));
    check("search desktop: cell desktop.new.search", events().every((e) => e.cell === "desktop.new.search"), events());
    await o.done("search desktop");
  });
  await run("search arrival mobile, searchArrival as-desktop → card", async () => {
    const o = await open("mobile", "/?fx=search-as-desktop", { referer: "https://www.google.com/" });
    await inCard(o.page, "search-as-desktop", ".card").waitFor();
    check("as-desktop: no pill", (await host(o.page, "search-as-desktop-teaser").count()) === 0);
    await o.done("search as-desktop");
  });
  await run("cells: source classes", async () => {
    const cases = [
      ["/?fx=cells&utm_medium=email&utm_source=klaviyo", null, "email"],
      ["/?fx=cells&utm_medium=cpc", "https://www.google.com/", "paid"],
      ["/?fx=cells&gclid=abc", "https://www.google.com/", "paid"],
      ["/?fx=cells", "https://l.instagram.com/", "social"],
      ["/?fx=cells", "https://t.co/xyz", "social"],
      ["/?fx=cells", "https://duckduckgo.com/", "search"],
      ["/?fx=cells", "https://somewhere.example/", "other"],
    ];
    for (const [path, ref, want] of cases) {
      reset();
      const o = await open("desktop", path, { referer: ref || undefined });
      await host(o.page, "cells").waitFor({ state: "attached" });
      await waitFor(() => events().length > 0);
      check(`cell source ${want} (${path} ${ref || ""})`, events()[0] && events()[0].cell === `desktop.new.${want}`, events()[0] && events()[0].cell);
      await o.done(`cells ${want}`);
    }
  });

  /* ── F. incumbent arm: Klaviyo suppress / observe ─────────────────── */
  const KL = (type, formId, extra = {}) => ({ type, formId, metaData: { $source: extra.embed ? "Embed" : "POPUP" }, ...extra });
  const fireKl = (p, list) => p.evaluate((l) => l.forEach((d) => window.dispatchEvent(new CustomEvent("klaviyoForms", { detail: d }))), list);
  await run("incumbent: variant visitor suppresses Klaviyo", async () => {
    reset();
    const o = await open("desktop", "/?fx=incumbent&kl=1", { storage: { "mos-surfaces:arm:exp-incumbent": { arm: "v1", alloc: 1 } } });
    const p = o.page;
    await inCard(p, "incumbent", ".card").waitFor();
    check("variant: popup hidden by stylesheet", (await p.evaluate(() => getComputedStyle(document.getElementById("kl-popup")).display)) === "none");
    check("variant: embedded form untouched", (await p.evaluate(() => getComputedStyle(document.getElementById("kl-embed")).display)) !== "none");
    // A popup that forces itself visible with inline !important, then opens.
    await p.evaluate(() => {
      const d = document.createElement("div");
      d.id = "kl-flyout";
      d.setAttribute("data-testid", "FLYOUT");
      d.style.setProperty("display", "block", "important");
      d.style.cssText += ";position:fixed;right:0;bottom:0;width:300px;height:200px;background:#fff";
      document.body.appendChild(d);
    });
    await fireKl(p, [KL("open", "FLY1")]);
    await wait(150);
    check("variant: inline-!important flyout hidden on open", (await p.evaluate(() => getComputedStyle(document.getElementById("kl-flyout")).display)) === "none");
    await wait(900);
    await shot(p, "desktop", "incumbent-variant-arm");
    check("variant: no vendor events counted", !events().some((e) => e.vendor), events());
    const supk = await p.evaluate(() => JSON.parse(localStorage.getItem("mos-surfaces:supk")));
    check("variant: early-suppression flag persisted", supk > Date.now(), supk);
    await o.done("incumbent variant");
  });
  await run("incumbent: control visitor suppresses, renders nothing", async () => {
    reset();
    const o = await open("desktop", "/?fx=incumbent&kl=1", { storage: { "mos-surfaces:arm:exp-incumbent": { arm: "control", alloc: 1 } } });
    await waitFor(() => events().some((e) => e.event === "exposure"));
    await wait(400);
    check("control: nothing rendered", (await host(o.page, "incumbent").count()) === 0);
    check("control: popup hidden", (await o.page.evaluate(() => getComputedStyle(document.getElementById("kl-popup")).display)) === "none");
    check("control: exposure", events().some((e) => e.event === "exposure" && e.arm === "control"), events());
    await o.done("incumbent control");
  });
  await run("incumbent: incumbent visitor observes Klaviyo", async () => {
    reset();
    const o = await open("mobile", "/?fx=incumbent&kl=1", { storage: { "mos-surfaces:arm:exp-incumbent": { arm: "incumbent", alloc: 1 } } });
    const p = o.page;
    await waitFor(() => events().some((e) => e.event === "exposure"));
    await wait(400);
    check("incumbent: nothing of ours rendered", (await host(p, "incumbent").count()) === 0);
    check("incumbent: popup NOT suppressed", (await p.evaluate(() => getComputedStyle(document.getElementById("kl-popup")).display)) !== "none");
    check("incumbent: no suppression style", (await p.evaluate(() => !document.getElementById("mos-suppress-klaviyo"))));
    await shot(p, "mobile", "incumbent-incumbent-arm");
    await fireKl(p, [
      KL("embedOpen", "EMB1", { embed: true }), KL("submit", "EMB1", { embed: true }),
      KL("open", "POP1"), KL("open", "POP1"), KL("submit", "POP1"), KL("close", "POP1"),
    ]);
    await waitFor(() => events().filter((e) => e.vendor === "klaviyo").length >= 4, 2000);
    const ven = events().filter((e) => e.vendor === "klaviyo");
    const kinds = ven.filter((e) => e.event !== "exposure").map((e) => e.event);
    check("incumbent: impression/capture/dismiss once each, embedded ignored", JSON.stringify(kinds) === '["impression","capture","dismiss"]', kinds);
    check("incumbent: vendor events carry arm + cell", ven.every((e) => e.arm === "incumbent" && e.cell === "mobile.new.direct"), ven);
    check("incumbent: exposure", events().some((e) => e.event === "exposure" && e.arm === "incumbent"));
    await o.done("incumbent observe");
  });

  /* ── G. cell weights ─────────────────────────────────────────────── */
  for (const [vp, want] of [["desktop", "c-editorial"], ["mobile", "c-card"]]) {
    await run(`cells weights ${vp}`, async () => {
      reset();
      const o = await open(vp, "/?fx=cells");
      await inCard(o.page, "cells", ".card").waitFor();
      const cls = await inCard(o.page, "cells", ".wrap").getAttribute("class");
      check(`cells ${vp}: arm from cell weights (${want})`, cls.includes(want), cls);
      await wait(700);
      await shot(o.page, vp, `cells-${want}`);
      await o.done(`cells ${vp}`);
    });
  }

  /* ── G2. one offer per visitor ───────────────────────────────────── */
  await run("two live offers: one per visitor, sticky", async () => {
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      reset();
      const o = await open("desktop", "/?fx=pair");
      await waitFor(() => false, 1200);
      const a = await host(o.page, "pair-a").count();
      const b = await host(o.page, "pair-b").count();
      check(`pair visitor ${i}: exactly one offer rendered`, a + b === 1, { a, b });
      const shown = a ? "pair-a" : "pair-b";
      seen.add(shown);
      const exp = events().filter((e) => e.event === "exposure").map((e) => e.surfaceId);
      check(`pair visitor ${i}: exposure only for the offer shown`, exp.length === 1 && exp[0] === shown, exp);
      if (i === 0) {
        await o.page.reload();
        await waitFor(() => false, 1200);
        const other = shown === "pair-a" ? "pair-b" : "pair-a";
        check("pair: the other offer never appears on a later page view", (await host(o.page, other).count()) === 0);
        check("pair: pick is sticky", events().filter((e) => e.event === "exposure").every((e) => e.surfaceId === shown));
      }
      await o.done(`pair visitor ${i}`);
    }
    check("pair: both offers get traffic across visitors", seen.size === 2, [...seen]);
  });

  /* ── H. trigger arms ─────────────────────────────────────────────── */
  await run("trigger product-views", async () => {
    const o = await open("desktop", "/products/tidewater?fx=trig-product-views");
    await wait(900);
    check("product-views: not on first product", (await host(o.page, "trig-product-views").count()) === 0);
    await o.page.goto(server.base + "/products/tidewater?fx=trig-product-views");
    await wait(900);
    check("product-views: same product twice is still one", (await host(o.page, "trig-product-views").count()) === 0);
    await o.page.goto(server.base + "/products/low-field?fx=trig-product-views");
    await inCard(o.page, "trig-product-views", ".card").waitFor({ timeout: 3000 });
    check("product-views: fires on second distinct product", true);
    await o.done("product-views");
  });
  await run("trigger scroll-dwell", async () => {
    const o = await open("desktop", "/?fx=trig-scroll-dwell");
    await o.page.mouse.wheel(0, 900);
    await wait(500);
    check("scroll-dwell: waits for dwell", (await host(o.page, "trig-scroll-dwell").count()) === 0);
    await inCard(o.page, "trig-scroll-dwell", ".card").waitFor({ timeout: 3000 });
    check("scroll-dwell: fires after depth + dwell", true);
    await o.done("scroll-dwell");
  });

  await run("malformed v2 fails invisible", async () => {
    const o = await open("desktop", "/?fx=broken");
    await wait(800);
    check("broken: nothing rendered", (await host(o.page, "broken").count()) === 0);
    check("broken: page not scroll-locked", (await o.page.evaluate(() => document.body.style.overflow)) === "");
    await o.done("broken");
  });

  /* ── I. interactive preview writes nothing ───────────────────────── */
  await run("preview interactive quiz sends nothing", async () => {
    reset();
    const o = await open("desktop", "/?fx=quiz&mos_preview=tok&mos_arm=v1");
    const p = o.page;
    await inCard(p, "quiz", ".opt").first().waitFor();
    await wait(500);
    await shot(p, "desktop", "quiz-preview-badge");
    await inCard(p, "quiz", ".opt").first().click();
    await inCard(p, "quiz", "input[type=email]").fill("preview@example.com");
    await inCard(p, "quiz", "button.cta").click();
    await inCard(p, "quiz", ".picks").waitFor();
    await wait(400);
    check("preview interactive: zero events/captures", server.log.length === 0, server.log);
    await o.done("preview interactive");
  });

  await browser.close();
  await server.close();

  const src = readFileSync(RUNTIME);
  console.log(`\nruntime ${src.length} B, ${gzipSync(src, { level: 9 }).length} B gzip`);
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
