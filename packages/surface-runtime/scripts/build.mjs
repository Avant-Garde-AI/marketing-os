#!/usr/bin/env node
/**
 * Build the storefront surface runtime: src/*.js (readable, commented,
 * linted) → dist/*.js (minified). A host ships the dist files byte-for-byte
 * (a Shopify theme app extension serves its assets unchanged), so the build
 * is deterministic: same esbuild settings, same banner, no timestamps.
 *
 *   node scripts/build.mjs           # write dist/
 *   node scripts/build.mjs --check   # fail when dist/ is missing or stale
 *
 * Hosts that vendor src/ (the hosted app keeps a copy under
 * extensions/surfaces/src/) run the same transform with their own banner
 * path; the minified body is identical because legalComments are dropped.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["surface-runtime.js", "surface-diag.js"];
const check = process.argv.includes("--check");

async function buildOne(src, f) {
  const version = (src.match(/mos\.version = "([^"]+)"/) || [])[1];
  const { code } = await transform(src, {
    minify: true,
    target: "es2017",
    legalComments: "none",
    banner: `/* Marketing OS ${f}${version ? ` ${version}` : ""} — minified from packages/surface-runtime/src/${f} (MIT) */`,
  });
  return code;
}

const stale = [];
mkdirSync(join(root, "dist"), { recursive: true });
for (const f of FILES) {
  const src = readFileSync(join(root, "src", f), "utf8");
  const code = await buildOne(src, f);
  const out = join(root, "dist", f);
  if (check) {
    if (!existsSync(out) || readFileSync(out, "utf8") !== code) stale.push(f);
  } else {
    writeFileSync(out, code);
    console.log(`${f}: ${Buffer.byteLength(src)} B → ${Buffer.byteLength(code)} B`);
  }
}
if (stale.length) {
  console.error(`✗ surface-runtime build is stale: ${stale.join(", ")} — run \`pnpm --filter @avant-garde/surface-runtime build\``);
  process.exit(1);
}
if (check) console.log("✓ surface-runtime build is current");
