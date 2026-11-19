/**
 * Capture corpus pages with Playwright (optional dependency, lazy-loaded).
 *
 * Screenshots are written under `outDir/<brand>/` and stay there. They are
 * inputs to labeling, never dataset content (spec 35 §4). Capture is
 * polite: one page at a time per browser, a fixed delay between pages, and a
 * plain identifying user agent with no personal details.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ResolvedPage } from "../corpus.js";
import { sha256File, type Capture } from "../labeler.js";

export interface CaptureOptions {
  outDir: string;
  viewports?: ("desktop" | "mobile")[];
  /** Capture the full scrolled page (default) or only the first screen. */
  fullPage?: boolean;
  /** Pause between pages, ms (default 1500). */
  delayMs?: number;
  /** Max screenshot height in px when fullPage, to bound giant pages (default 6000). */
  maxHeight?: number;
  userAgent?: string;
  onProgress?: (msg: string) => void;
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

/**
 * Best-effort dismissal of consent banners and entry popups so they don't
 * cover the page being labeled. Clicks only a visible button whose whole label
 * is an accept/close phrase, then presses Escape. Never fills forms. A banner
 * that survives is recorded by the labeler as page content, which is honest.
 */
async function dismissOverlays(page: import("playwright").Page): Promise<void> {
  const accept = /^(accept( all)?( cookies)?|allow all|agree|i agree|got it|ok|okay|close|no thanks|dismiss)$/i;
  try {
    const buttons = page.getByRole("button", { name: accept });
    const n = Math.min(await buttons.count(), 4);
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      if (await b.isVisible().catch(() => false)) await b.click({ timeout: 1500 }).catch(() => {});
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  } catch {
    /* overlays are best-effort */
  }
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "page";

export async function capturePages(pages: ResolvedPage[], opts: CaptureOptions): Promise<{ captures: Capture[]; failures: { url: string; error: string }[] }> {
  let pw: typeof import("playwright");
  try {
    pw = await import("playwright");
  } catch {
    throw new Error("playwright is not installed. `pnpm add -D playwright && npx playwright install chromium` to capture.");
  }
  const viewports = opts.viewports ?? ["desktop", "mobile"];
  const delay = opts.delayMs ?? 1500;
  const maxHeight = opts.maxHeight ?? 6000;
  const captures: Capture[] = [];
  const failures: { url: string; error: string }[] = [];

  const browser = await pw.chromium.launch();
  try {
    for (const vp of viewports) {
      const ctx = await browser.newContext({
        viewport: VIEWPORTS[vp],
        deviceScaleFactor: 1,
        isMobile: vp === "mobile",
        userAgent: opts.userAgent ?? "design-craft-capture/0.1 (+https://github.com/Avant-Garde-AI/marketing-os)",
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      for (const p of pages) {
        const dir = path.join(opts.outDir, p.brand);
        await mkdir(dir, { recursive: true });
        const file = path.join(dir, `${p.type}-${slug(new URL(p.url).pathname)}-${vp}.png`);
        try {
          opts.onProgress?.(`capture ${vp} ${p.url}`);
          await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
          await dismissOverlays(page);
          // The first screen, shot before any scrolling: sticky headers are where the
          // shopper sees them and the hero is at full resolution for the labeler.
          const foldFile = file.replace(/\.png$/, ".fold.png");
          await page.screenshot({ path: foldFile });
          // Trigger lazy-loaded imagery before a full-page shot.
          if (opts.fullPage !== false) {
            await page.evaluate(async (limit) => {
              for (let y = 0; y < Math.min(document.body.scrollHeight, limit); y += 600) {
                window.scrollTo(0, y);
                await new Promise((r) => setTimeout(r, 120));
              }
              window.scrollTo(0, 0);
            }, maxHeight);
            // Let scroll-triggered sticky/condensed headers settle back before stitching.
            await page.waitForTimeout(600);
          }
          const height = await page.evaluate(() => document.body.scrollHeight);
          // A full-page shot clipped to maxHeight; the clip is relative to the whole page only when fullPage is set.
          await page.screenshot(
            opts.fullPage === false
              ? { path: file }
              : { path: file, fullPage: true, clip: { x: 0, y: 0, width: VIEWPORTS[vp].width, height: Math.min(height, maxHeight) } },
          );
          captures.push({
            brand: p.brand,
            category: p.category,
            pageType: p.type,
            url: p.url,
            viewport: vp,
            capturedAt: new Date().toISOString(),
            path: file,
            foldPath: foldFile,
            sha256: await sha256File(file),
          });
        } catch (e) {
          failures.push({ url: `${vp} ${p.url}`, error: (e as Error).message.split("\n")[0]! });
        }
        await new Promise((r) => setTimeout(r, delay));
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return { captures, failures };
}

/**
 * Resolve a store's page set from its own links, in a real browser (spec 35 P2).
 *
 * The fetch resolver can't see stores that block plain HTTP clients (403/429) or
 * disable `/products.json`, though a browser loads them fine. Here we read the
 * home page's same-origin links and pick a product page and a collection page,
 * which also works off Shopify. Picks are heuristic and recorded, never guessed.
 */
export async function resolvePagesInBrowser(
  stores: { url: string }[],
  opts: { onProgress?: (msg: string) => void; delayMs?: number } = {},
): Promise<{ url: string; reachable: boolean; pages: { type: "home" | "collection" | "product"; url: string }[]; notes: string[] }[]> {
  let pw: typeof import("playwright");
  try {
    pw = await import("playwright");
  } catch {
    throw new Error("playwright is not installed.");
  }
  const browser = await pw.chromium.launch();
  const out = [];
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop, userAgent: undefined });
    const page = await ctx.newPage();
    for (const s of stores) {
      const r = { url: s.url, reachable: false, pages: [] as { type: "home" | "collection" | "product"; url: string }[], notes: [] as string[] };
      try {
        const res = await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        if (!res || res.status() >= 400) {
          r.notes.push(`home ${res?.status() ?? "no response"}`);
        } else {
          r.reachable = true;
          r.pages.push({ type: "home", url: "/" });
          const origin = new URL(page.url()).origin;
          const hrefs: string[] = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
          const paths = [...new Set(hrefs.filter((h) => h.startsWith(origin)).map((h) => new URL(h).pathname.replace(/\/$/, "")))];
          const bad = /gift|card|sample|account|login|cart|search|blog|journal|pages\/|policies|help|faq/i;
          const product = paths.find((p) => /\/products?\/[^/]+$/.test(p) && !bad.test(p)) ?? paths.find((p) => /\/p\/[^/]+$/.test(p) && !bad.test(p));
          const collection =
            paths.find((p) => /\/collections\/[^/]+$/.test(p) && /best|new|shop|all|women|men/i.test(p) && !bad.test(p)) ??
            paths.find((p) => /\/(collections|category|categories|shop)\/[^/]+$/.test(p) && !bad.test(p));
          if (collection) r.pages.push({ type: "collection", url: collection });
          else r.notes.push("no collection link on home");
          if (product) r.pages.push({ type: "product", url: product });
          else r.notes.push("no product link on home");
        }
      } catch (e) {
        r.notes.push((e as Error).message.split("\n")[0]!);
      }
      opts.onProgress?.(`${r.reachable ? (r.pages.length === 3 ? "✓" : "~") : "✗"} ${s.url} ${r.pages.map((p) => `${p.type}=${p.url}`).join(" ")} ${r.notes.join("; ")}`);
      out.push(r);
      await new Promise((res) => setTimeout(res, opts.delayMs ?? 800));
    }
  } finally {
    await browser.close();
  }
  return out;
}
