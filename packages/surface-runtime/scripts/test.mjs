#!/usr/bin/env node
/**
 * `pnpm test` entry: run the Playwright harness (test/run.mjs) against
 * dist/ — but only when a Chromium can actually launch. CI images without
 * Playwright browsers get a clear skip instead of a red build; set
 * MOS_REQUIRE_BROWSER=1 to turn the skip into a failure.
 *
 * Install a browser once with: pnpm --filter @avant-garde/surface-runtime exec playwright install chromium
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.MOS_RUNTIME && !existsSync(join(root, "dist", "surface-runtime.js"))) {
  console.error("✗ dist/surface-runtime.js is missing — run the build first");
  process.exit(1);
}

let reason = null;
try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  await browser.close();
} catch (e) {
  reason = String((e && e.message) || e).split("\n")[0];
}

if (reason) {
  const msg = `surface-runtime harness SKIPPED — Chromium could not launch (${reason}).\n` +
    "  Install it with: pnpm --filter @avant-garde/surface-runtime exec playwright install chromium";
  if (process.env.MOS_REQUIRE_BROWSER === "1") {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`⚠ ${msg}`);
  process.exit(0);
}

const r = spawnSync(process.execPath, [join(root, "test", "run.mjs"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
