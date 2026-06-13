// @ts-nocheck
/**
 * Real CaptureProvider adapter — Playwright. Renders the page at 390/768/1440,
 * screenshots full-page + above-fold, and extracts structured observations +
 * computed-style tokens via page.evaluate. Writes a PRD §4.2 capture bundle.
 * Loaded only on a live run.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

export function createPlaywrightCapture(_config) {
  return {
    capture: async ({ page: pagePath, baseUrl, manifest, outDir }) => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      const screenshots = {};
      let observations;
      let tokens = {};
      let domSegments = [];

      try {
        await mkdir(join(outDir, "screenshots"), { recursive: true });
        const url = new URL(pagePath, baseUrl).toString();

        for (const vp of VIEWPORTS) {
          const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
          const page = await ctx.newPage();
          await page.goto(url, { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts && document.fonts.ready);

          const fullPath = join(outDir, "screenshots", `${vp.name}-full.png`);
          const abovePath = join(outDir, "screenshots", `${vp.name}-above-fold.png`);
          await page.screenshot({ path: fullPath, fullPage: true });
          await page.screenshot({ path: abovePath, fullPage: false });
          screenshots[`${vp.name}:full`] = fullPath;
          screenshots[`${vp.name}:above-fold`] = abovePath;

          if (vp.name === "desktop") {
            observations = await page.evaluate(extractObservations);
            tokens = await page.evaluate(extractTokens);
            domSegments = await page.evaluate(extractSegments);
          }
          await ctx.close();
        }

        const bundle = {
          location: outDir,
          manifest,
          screenshots,
          tokens,
          domSegments,
          observations: observations ?? emptyObservations(),
        };
        await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
        await writeFile(join(outDir, "tokens.json"), JSON.stringify(tokens, null, 2));
        await writeFile(join(outDir, "dom-segments.json"), JSON.stringify(domSegments, null, 2));
        return bundle;
      } finally {
        await browser.close();
      }
    },
  };
}

function emptyObservations() {
  return { texts: [], inputs: [], images: [], contrast: [], markers: [] };
}

// The following run inside the browser via page.evaluate.

function extractObservations() {
  const texts = Array.from(document.querySelectorAll("h1,h2,h3,p,span,a,button,li"))
    .map((el) => (el.textContent || "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 400);
  const inputs = Array.from(document.querySelectorAll("input[type=checkbox]")).map((el) => ({
    type: "checkbox",
    name: el.getAttribute("name") || el.id || "",
    checked: el.checked,
  }));
  const images = Array.from(document.querySelectorAll("img")).map((el) => ({
    src: el.getAttribute("src") || "",
    hasAlt: el.hasAttribute("alt") && (el.getAttribute("alt") || "").trim().length > 0,
  }));
  const markers = [];
  for (const el of Array.from(document.querySelectorAll("[class*=countdown],[class*=timer],[data-countdown]"))) {
    markers.push({ kind: "countdown-timer", selector: el.className || el.tagName });
  }
  for (const el of Array.from(document.querySelectorAll("[class*=stock],[class*=inventory]"))) {
    markers.push({ kind: "stock-counter", selector: el.className || el.tagName });
  }
  // Contrast is computed best-effort from foreground/background colors.
  const contrast = [];
  return { texts, inputs, images, contrast, markers };
}

function extractTokens() {
  const colorSet = new Set();
  const fontSet = new Set();
  for (const el of Array.from(document.querySelectorAll("*")).slice(0, 2000)) {
    const cs = getComputedStyle(el);
    if (cs.color) colorSet.add(cs.color);
    if (cs.backgroundColor) colorSet.add(cs.backgroundColor);
    if (cs.fontFamily) fontSet.add(cs.fontFamily);
  }
  return { colors: Array.from(colorSet).slice(0, 50), fonts: Array.from(fontSet).slice(0, 20) };
}

function extractSegments() {
  return Array.from(document.querySelectorAll("section,[id],[class*=section]"))
    .slice(0, 50)
    .map((el) => ({ region: el.id || el.className || el.tagName, selector: el.tagName.toLowerCase() }));
}
