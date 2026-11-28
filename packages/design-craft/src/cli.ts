#!/usr/bin/env node
/**
 * design-craft CLI (spec 35 P1): capture → label → debrand → vocab / dataset.
 *
 *   design-craft corpus  --corpus corpus/dtc-v1.candidates.json --out corpus/dtc-v1.json
 *   design-craft capture --corpus corpus/smoke.json --out .captures
 *   design-craft label   --captures .captures/manifest.jsonl --vocab vocab.json --out labels.jsonl \
 *                        --base-url https://… --model <id>      # key: DESIGN_CRAFT_API_KEY
 *   design-craft debrand --labels labels.jsonl --vocab vocab.json
 *   design-craft merge-axes --vocab vocab.json --base-url https://… [--axis-threshold 0.75] [--block axis-block.json] [--dry-run] [--cached-only]
 *   design-craft merge   --vocab vocab.json --base-url https://… [--embed-model …] [--judge-model …] [--dry-run] [--cached-only]
 *   design-craft vocab   --vocab vocab.json [--json]
 *   design-craft report  --vocab vocab.json --labels labels.jsonl [--json]          # M1 + conversion-lens coverage
 *   design-craft taxonomy --vocab vocab.json --out taxonomy.json --base-url https://… [--judge-model …] [--block overrides.json] [--cached-only]
 *   design-craft benchmarks --vocab vocab.json --labels labels.jsonl --out benchmarks.json [--taxonomy taxonomy.json] [--season black-friday-2026] [--min-brands 5]
 *   design-craft dataset --labels labels.jsonl --vocab vocab.json --out release/ --name dtc-craft --version 0.1
 *
 * Every step is resumable: `label` skips captures already labeled (by sha256),
 * and `debrand` is idempotent because support is a set of brands.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { resolveCorpus, type CorpusPage } from "./corpus.js";
import { datasheet, parseJsonl, toJsonl } from "./dataset.js";
import { debrand } from "./debrand.js";
import { labelCapture, LabelParseError, type Capture } from "./labeler.js";
import { emptyVocabulary, recognizedEmergentAxes, vocabularySchema, vocabularyStats, admittedAxes, admittedValues, type Vocabulary } from "./vocabulary.js";

const USAGE = `design-craft <corpus|capture|label|debrand|merge-axes|merge|vocab|report|benchmarks|dataset> [options]  (see spec/35-DESIGN-CRAFT-MODELS.md)`;

async function loadVocab(p: string): Promise<Vocabulary> {
  if (!existsSync(p)) return emptyVocabulary();
  return vocabularySchema.parse(JSON.parse(await readFile(p, "utf8")));
}
async function saveVocab(p: string, v: Vocabulary) {
  await mkdir(path.dirname(path.resolve(p)), { recursive: true });
  await writeFile(p, JSON.stringify(v, null, 2) + "\n");
}
async function readJsonl<T>(p: string): Promise<T[]> {
  if (!existsSync(p)) return [];
  return (await readFile(p, "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}
function need(v: string | undefined, flag: string): string {
  if (!v) throw new Error(`missing --${flag}\n${USAGE}`);
  return v;
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const { values: a } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      corpus: { type: "string" },
      out: { type: "string" },
      captures: { type: "string" },
      vocab: { type: "string", default: "vocabulary.json" },
      labels: { type: "string" },
      "base-url": { type: "string" },
      model: { type: "string" },
      viewports: { type: "string", default: "desktop,mobile" },
      "first-screen": { type: "boolean", default: false },
      concurrency: { type: "string", default: "3" },
      name: { type: "string", default: "dtc-craft-labels" },
      version: { type: "string", default: "0.1.0" },
      json: { type: "boolean", default: false },
      "embed-model": { type: "string", default: "gemini-embedding-2" },
      "judge-model": { type: "string", default: "gemini-3.1-pro-preview" },
      threshold: { type: "string", default: "0.85" },
      cache: { type: "string" },
      report: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      block: { type: "string" },
      retries: { type: "string", default: "8" },
      "all-axes": { type: "boolean", default: false },
      "cached-only": { type: "boolean", default: false },
      "axis-threshold": { type: "string", default: "0.75" },
      passes: { type: "string", default: "3" },
      "min-brands": { type: "string", default: "5" },
      taxonomy: { type: "string" },
      season: { type: "string" },
    },
  });

  switch (cmd) {
    case "corpus": {
      // Resolve page sets for a candidate list. Unreachable stores are dropped and
      // reported; non-Shopify stores keep their home page and get a `needs-pages` tag.
      const { corpusSchema } = await import("./corpus.js");
      const { resolveStorePages } = await import("./adapters/shopify-pages.js");
      const input = corpusSchema.parse(JSON.parse(await readFile(need(a.corpus, "corpus"), "utf8")));
      const kept = [];
      const dropped: { url: string; notes: string[] }[] = [];
      // Browser pass first: it sees stores exactly as capture will. Fetch fills gaps from /products.json.
      const { resolvePagesInBrowser } = await import("./adapters/playwright-capture.js");
      const viaBrowser = new Map((await resolvePagesInBrowser(input.stores, { onProgress: (m) => console.error(`  [browser] ${m}`) })).map((r) => [r.url, r]));
      for (const store of input.stores) {
        const b = viaBrowser.get(store.url)!;
        const missing = !b.pages.some((p) => p.type === "product") || !b.pages.some((p) => p.type === "collection");
        const fr = missing ? await resolveStorePages(store) : null;
        const pages: CorpusPage[] = [...b.pages];
        for (const p of fr?.pages ?? []) if (!pages.some((q) => q.type === p.type)) pages.push(p);
        const r = { reachable: b.reachable || !!fr?.reachable, shopify: !!fr?.shopify, pages, notes: [...b.notes, ...(fr?.notes ?? [])] };
        const flag = r.reachable ? (r.pages.length >= 3 ? "✓" : "~") : "✗";
        console.error(`  ${flag} ${store.url} ${r.pages.map((p) => p.type).join(",")} ${r.notes.join("; ")}`);
        if (!r.reachable) dropped.push({ url: store.url, notes: r.notes });
        else {
          const complete = ["home", "collection", "product"].every((t) => r.pages.some((p) => p.type === t));
          kept.push({ ...store, pages: r.pages, tags: [...new Set([...store.tags, ...(r.shopify ? ["shopify"] : []), ...(complete ? [] : ["needs-pages"])])] });
        }
        await new Promise((res) => setTimeout(res, 500));
      }
      const out = need(a.out, "out");
      await writeFile(out, JSON.stringify({ ...input, stores: kept }, null, 2) + "\n");
      const cats = new Map<string, number>();
      for (const st of kept) cats.set(st.category, (cats.get(st.category) ?? 0) + 1);
      console.log(`kept ${kept.length}, dropped ${dropped.length} · ${[...cats].map(([c, n]) => `${c} ${n}`).join(" · ")}`);
      for (const d of dropped) console.log(`  dropped ${d.url}: ${d.notes.join("; ")}`);
      return;
    }

    case "capture": {
      const { capturePages } = await import("./adapters/playwright-capture.js");
      const { pages } = resolveCorpus(JSON.parse(await readFile(need(a.corpus, "corpus"), "utf8")));
      const outDir = need(a.out, "out");
      // Resumable: anything already in the manifest is skipped, so a re-run after a
      // network drop only fills the gaps.
      const already = await readJsonl<Capture>(path.join(outDir, "manifest.jsonl"));
      const skip = new Set(already.map((c) => `${c.viewport} ${c.url}`));
      if (skip.size) console.error(`${skip.size} captures already in manifest; skipping them`);
      const { captures, failures } = await capturePages(pages, {
        skip,
        outDir,
        viewports: a.viewports!.split(",") as ("desktop" | "mobile")[],
        fullPage: !a["first-screen"],
        onProgress: (m) => console.error(m),
      });
      await mkdir(outDir, { recursive: true });
      await appendFile(path.join(outDir, "manifest.jsonl"), captures.map((c) => JSON.stringify(c)).join("\n") + (captures.length ? "\n" : ""));
      console.log(`captured ${captures.length}, failed ${failures.length}`);
      for (const f of failures) console.log(`  ✗ ${f.url}: ${f.error}`);
      return;
    }

    case "label": {
      const { createOpenAIVisionModel } = await import("./adapters/openai-vision.js");
      const model = createOpenAIVisionModel({
        baseUrl: need(a["base-url"] ?? process.env.DESIGN_CRAFT_BASE_URL, "base-url"),
        model: need(a.model ?? process.env.DESIGN_CRAFT_MODEL, "model"),
        apiKey: process.env.DESIGN_CRAFT_API_KEY,
      });
      const vocabulary = await loadVocab(a.vocab!);
      const out = need(a.out, "out");
      const captures = await readJsonl<Capture>(need(a.captures, "captures"));
      const done = new Set((await readJsonl<{ captureSha256: string }>(out)).map((r) => r.captureSha256));
      const todo = captures.filter((c) => !done.has(c.sha256));
      console.error(`${todo.length} to label (${captures.length - todo.length} already done)`);

      let ok = 0;
      let failed = 0;
      const queue = [...todo];
      const worker = async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          try {
            const rec = await labelCapture(c, { model, vocabulary });
            await appendFile(out, JSON.stringify(rec) + "\n");
            ok++;
            console.error(`  ✓ ${c.brand} ${c.pageType} ${c.viewport}: ${rec.proposals.length} proposals`);
          } catch (e) {
            failed++;
            const msg = e instanceof LabelParseError ? `${e.message} | ${e.raw.slice(0, 160)}` : (e as Error).message;
            console.error(`  ✗ ${c.brand} ${c.pageType} ${c.viewport}: ${msg}`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Number(a.concurrency)) }, worker));
      console.log(`labeled ${ok}, failed ${failed}`);
      if (failed) process.exitCode = 1;
      return;
    }

    case "debrand": {
      const v = await loadVocab(a.vocab!);
      const records = parseJsonl(await readFile(need(a.labels, "labels"), "utf8"));
      const s = debrand(v, records);
      await saveVocab(a.vocab!, v);
      console.log(`${s.records} records, ${s.observations} observations`);
      console.log(`promoted ${s.promoted.length}, merged ${s.merged.length}, rejected ${s.rejected.length}`);
      for (const ax of s.axesRecognized) console.log(`  ◆ axis recognized: ${ax}`);
      for (const p of s.promoted) console.log(`  ↑ ${p.axis} = ${p.key} (${p.support} brands)`);
      return;
    }

    case "merge-axes": {
      // Fold synonym AXES before the value merge (debrand → merge-axes → merge).
      const { createOpenAIEmbedder, createOpenAIAxisJudge } = await import("./adapters/openai-text.js");
      const { axisMerge } = await import("./axis-merge.js");
      const offline = a["cached-only"];
      const baseUrl = offline ? "" : need(a["base-url"] ?? process.env.DESIGN_CRAFT_BASE_URL, "base-url");
      const apiKey = process.env.DESIGN_CRAFT_API_KEY;
      const v = await loadVocab(a.vocab!);
      const dir = path.dirname(path.resolve(a.vocab!));
      const cachePath = a.cache ?? path.join(dir, ".embeddings-cache.json");
      const verdictPath = path.join(dir, ".axis-verdicts-cache.json");
      const load = async <T>(p: string) => new Map<string, T>(existsSync(p) ? Object.entries(JSON.parse(await readFile(p, "utf8"))) : []);
      const cache = await load<number[]>(cachePath);
      const verdictCache = await load<{ same: boolean; reason?: string }>(verdictPath);
      // Repeat until a pass merges nothing. A later pass judges the surviving canonical
      // axes directly (with their merged values in view), so it never infers through a chain.
      const reports = [];
      for (let pass = 1; pass <= Number(a.passes); pass++) {
        const r = await axisMerge(v, {
          embedder: offline
            ? { id: a["embed-model"]!, embed: async () => { throw new Error("not cached (--cached-only)"); } }
            : createOpenAIEmbedder({ baseUrl, apiKey, model: a["embed-model"]!, retry: { retries: Number(a.retries) } }),
          judge: offline
            ? { id: a["judge-model"]!, judge: async () => { throw new Error("not cached (--cached-only)"); } }
            : createOpenAIAxisJudge({ baseUrl, apiKey, model: a["judge-model"]!, retry: { retries: Number(a.retries) } }),
          candidateThreshold: Number(a["axis-threshold"]),
          cache,
          verdictCache,
          dryRun: a["dry-run"],
          blocked: a.block && existsSync(a.block) ? JSON.parse(await readFile(a.block, "utf8")) : [],
        });
        reports.push(r);
        console.log(`pass ${pass}: ${r.axes} axes (${r.emergent} emergent) · ${r.candidates} candidates · ${r.judged} judged · ${r.cachedVerdicts} from cache`);
        console.log(`  merged ${r.merged.length} · rejected ${r.rejected.length} · deferred ${r.deferred.length}${a["dry-run"] ? " (dry run)" : ""}`);
        if (r.errors.length) console.log(`  ! ${r.errors.length} judge batches failed (${r.errors.reduce((n, e) => n + e.pairs, 0)} pairs left unmerged)`);
        for (const m of r.merged) console.log(`  ⊂ ${m.from} → ${m.into} (${m.score.toFixed(3)}) ${m.reason ?? ""}`);
        for (const m of r.recognized) console.log(`  ◆ axis recognized: ${m.axis} (${m.brands} brands)`);
        if (!r.merged.length || a["dry-run"]) break;
      }
      await writeFile(cachePath, JSON.stringify(Object.fromEntries(cache)));
      await writeFile(verdictPath, JSON.stringify(Object.fromEntries(verdictCache)));
      if (!a["dry-run"]) await saveVocab(a.vocab!, v);
      if (a.report) await writeFile(a.report, JSON.stringify(reports, null, 2) + "\n");
      return;
    }

    case "merge": {
      const { createOpenAIEmbedder, createOpenAIMergeJudge } = await import("./adapters/openai-text.js");
      const { semanticMerge } = await import("./merge.js");
      // --cached-only replays from the embedding and verdict caches with no network:
      // anything uncached fails safe (axis skipped, pair left unmerged).
      const offline = a["cached-only"];
      const baseUrl = offline ? "" : need(a["base-url"] ?? process.env.DESIGN_CRAFT_BASE_URL, "base-url");
      const apiKey = process.env.DESIGN_CRAFT_API_KEY;
      const v = await loadVocab(a.vocab!);
      // Vector cache lives beside the vocabulary by default (gitignored, regenerable).
      const cachePath = a.cache ?? path.join(path.dirname(path.resolve(a.vocab!)), ".embeddings-cache.json");
      const cache = new Map<string, number[]>(existsSync(cachePath) ? Object.entries(JSON.parse(await readFile(cachePath, "utf8"))) : []);
      const verdictPath = path.join(path.dirname(path.resolve(a.vocab!)), ".verdicts-cache.json");
      const verdictCache = new Map<string, { same: boolean; reason?: string }>(
        existsSync(verdictPath) ? Object.entries(JSON.parse(await readFile(verdictPath, "utf8"))) : [],
      );
      const persist = async () => {
        await writeFile(cachePath, JSON.stringify(Object.fromEntries(cache)));
        await writeFile(verdictPath, JSON.stringify(Object.fromEntries(verdictCache)));
      };
      const r = await semanticMerge(v, {
        embedder: offline
          ? { id: a["embed-model"]!, embed: async () => { throw new Error("not cached (--cached-only)"); } }
          : createOpenAIEmbedder({ baseUrl, apiKey, model: a["embed-model"]!, retry: { retries: Number(a.retries) } }),
        judge: offline
          ? { id: a["judge-model"]!, judge: async () => { throw new Error("not cached (--cached-only)"); } }
          : createOpenAIMergeJudge({ baseUrl, apiKey, model: a["judge-model"]!, retry: { retries: Number(a.retries) } }),
        recognizedOnly: !a["all-axes"],
        verdictCache,
        onAxisDone: async (axis) => {
          await persist();
          console.error(`  · ${axis} done`);
        },
        candidateThreshold: Number(a.threshold),
        cache,
        dryRun: a["dry-run"],
        blocked: a.block && existsSync(a.block) ? JSON.parse(await readFile(a.block, "utf8")) : [],
      });
      await persist();
      if (!a["dry-run"]) await saveVocab(a.vocab!, v);
      if (a.report) await writeFile(a.report, JSON.stringify(r, null, 2) + "\n");
      console.log(`${r.values} values · ${r.candidates} candidates · ${r.vetoed.length} vetoed · ${r.judged} judged · ${r.cachedVerdicts} from cache`);
      console.log(`merged ${r.merged.length} · rejected ${r.rejected.length} · deferred ${r.deferred.length}${a["dry-run"] ? " (dry run)" : ""}`);
      const skipped = [...new Set(r.errors.filter((e) => e.pairs === 0).map((e) => e.axis))];
      const failedBatches = r.errors.filter((e) => e.pairs > 0);
      if (skipped.length) console.log(`  ! ${skipped.length} axes skipped, embeddings unavailable: ${skipped.join(", ")}`);
      if (failedBatches.length) console.log(`  ! ${failedBatches.length} judge batches failed (${failedBatches.reduce((n, e) => n + e.pairs, 0)} pairs left unmerged); re-run to retry them`);
      for (const m of r.merged) console.log(`  ⊂ ${m.axis}: ${m.from} → ${m.into} (${m.score.toFixed(3)}) ${m.reason ?? ""}`);
      for (const p of r.promoted) console.log(`  ↑ ${p.axis} = ${p.key} (${p.support} brands)`);
      return;
    }

    case "vocab": {
      const v = await loadVocab(a.vocab!);
      const stats = vocabularyStats(v);
      if (a.json) {
        console.log(JSON.stringify({ stats, emergent: recognizedEmergentAxes(v) }, null, 2));
        return;
      }
      console.log(`brands ${stats.brands} · axes ${stats.axes} (recognized ${stats.recognizedAxes}) · values admitted ${stats.admittedValues}, pending ${stats.pendingValues}`);
      for (const ax of admittedAxes(v)) console.log(`  ${ax}: ${admittedValues(v, ax).join(", ")}`);
      const em = recognizedEmergentAxes(v);
      if (em.length) {
        console.log("recognized, awaiting values:");
        for (const e of em) console.log(`  ${e.axis} (${e.brands} brands, ${e.distinctValues} candidate values)`);
      }
      return;
    }

    case "report": {
      const { vocabularyReport, formatReport } = await import("./report.js");
      const v = await loadVocab(a.vocab!);
      const records = parseJsonl(await readFile(need(a.labels, "labels"), "utf8"));
      const r = vocabularyReport(v, records);
      console.log(a.json ? JSON.stringify(r, null, 2) : formatReport(r));
      return;
    }

    case "taxonomy": {
      // Families per axis (taxonomy.ts). Cached beside --out, so a replay costs nothing.
      const { buildTaxonomy } = await import("./taxonomy.js");
      const { createOpenAITaxonomyGrouper } = await import("./adapters/openai-text.js");
      const { vocabularyRef } = await import("./labeler.js");
      const v = await loadVocab(a.vocab!);
      const out = need(a.out, "out");
      const cachePath = path.join(path.dirname(path.resolve(out)), ".taxonomy-cache.json");
      const cache = new Map<string, string>(existsSync(cachePath) ? Object.entries(JSON.parse(await readFile(cachePath, "utf8"))) : []);
      const model = a["judge-model"]!;
      const grouper = a["cached-only"]
        ? { id: `${model}+families@1`, group: async () => { throw new Error("not cached (--cached-only)"); } }
        : createOpenAITaxonomyGrouper({ baseUrl: need(a["base-url"], "base-url"), model, apiKey: process.env.DESIGN_CRAFT_API_KEY, retry: { retries: Number(a.retries) } });
      const overrides = a.block && existsSync(a.block) ? JSON.parse(await readFile(a.block, "utf8")) : [];
      const { taxonomy, report } = await buildTaxonomy(v, { grouper, cache, vocabularyRef: vocabularyRef(v), overrides });
      await writeFile(cachePath, JSON.stringify(Object.fromEntries(cache)) + "\n");
      await writeFile(out, JSON.stringify(taxonomy, null, 2) + "\n");
      console.log(`taxonomy: ${report.axes} axes (${report.grouped} grouped now, ${report.cached} from cache), ${report.repaired.length} repairs, ${report.errors.length} errors → ${out}`);
      for (const [axis, t] of Object.entries(taxonomy.axes)) console.log(`  ${axis}: ${t.families.map((f) => `${f.key}(${f.values.length})`).join(" · ")}`);
      for (const r of report.repaired) console.log(`  repaired ${r.axis}/${r.value}: ${r.fix}`);
      for (const e of report.errors) console.log(`  ERROR ${e.axis}: ${e.error}`);
      return;
    }

    case "benchmarks": {
      const { buildBenchmarks } = await import("./conversion.js");
      const { vocabularyRef } = await import("./labeler.js");
      const v = await loadVocab(a.vocab!);
      const records = parseJsonl(await readFile(need(a.labels, "labels"), "utf8"));
      const taxonomy = a.taxonomy ? JSON.parse(await readFile(a.taxonomy, "utf8")) : undefined;
      const b = buildBenchmarks(v, records, { minBrands: Number(a["min-brands"]), vocabularyRef: vocabularyRef(v), ...(taxonomy ? { taxonomy } : {}), ...(a.season ? { season: a.season } : {}) });
      const out = need(a.out, "out");
      // Compact: a derived artifact, rebuilt from labels + vocabulary + taxonomy, never hand-edited.
      await writeFile(out, JSON.stringify(b) + "\n");
      const own = Object.entries(b.categories).filter(([, c]) => !c.fallback).map(([k, c]) => `${k} (${c.brands} brands, ${Object.keys(c.axes).length} axes)`);
      const fb = Object.entries(b.categories).filter(([, c]) => c.fallback).map(([k, c]) => `${k} (${c.brands})`);
      console.log(`wrote ${out}: ${own.join(", ")}${fb.length ? `; below ${b.minBrands} brands, falls back to all: ${fb.join(", ")}` : ""}`);
      return;
    }

    case "dataset": {
      const v = await loadVocab(a.vocab!);
      const records = parseJsonl(await readFile(need(a.labels, "labels"), "utf8"));
      const out = need(a.out, "out");
      await mkdir(out, { recursive: true });
      await writeFile(path.join(out, "labels.jsonl"), toJsonl(records));
      await writeFile(path.join(out, "vocabulary.json"), JSON.stringify(v, null, 2) + "\n");
      const taxonomy = a.taxonomy ? JSON.parse(await readFile(a.taxonomy, "utf8")) : undefined;
      await writeFile(path.join(out, "DATASHEET.md"), datasheet(records, v, { name: a.name!, version: a.version!, ...(taxonomy ? { taxonomy } : {}), ...(a.season ? { season: a.season } : {}) }));
      console.log(`wrote ${records.length} labels + vocabulary + datasheet to ${out}`);
      return;
    }

    default:
      console.error(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
