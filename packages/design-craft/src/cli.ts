#!/usr/bin/env node
/**
 * design-craft CLI (spec 35 P1): capture → label → debrand → vocab / dataset.
 *
 *   design-craft capture --corpus corpus/smoke.json --out .captures
 *   design-craft label   --captures .captures/manifest.jsonl --vocab vocab.json --out labels.jsonl \
 *                        --base-url https://… --model <id>      # key: DESIGN_CRAFT_API_KEY
 *   design-craft debrand --labels labels.jsonl --vocab vocab.json
 *   design-craft merge   --vocab vocab.json --base-url https://… [--embed-model …] [--judge-model …] [--dry-run]
 *   design-craft vocab   --vocab vocab.json [--json]
 *   design-craft dataset --labels labels.jsonl --vocab vocab.json --out release/ --name dtc-craft --version 0.1
 *
 * Every step is resumable: `label` skips captures already labeled (by sha256),
 * and `debrand` is idempotent because support is a set of brands.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { resolveCorpus } from "./corpus.js";
import { datasheet, parseJsonl, toJsonl } from "./dataset.js";
import { debrand } from "./debrand.js";
import { labelCapture, LabelParseError, type Capture } from "./labeler.js";
import { emptyVocabulary, recognizedEmergentAxes, vocabularySchema, vocabularyStats, admittedAxes, admittedValues, type Vocabulary } from "./vocabulary.js";

const USAGE = `design-craft <capture|label|debrand|merge|vocab|dataset> [options]  (see spec/35-DESIGN-CRAFT-MODELS.md)`;

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
    },
  });

  switch (cmd) {
    case "capture": {
      const { capturePages } = await import("./adapters/playwright-capture.js");
      const { pages } = resolveCorpus(JSON.parse(await readFile(need(a.corpus, "corpus"), "utf8")));
      const outDir = need(a.out, "out");
      const { captures, failures } = await capturePages(pages, {
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

    case "merge": {
      const { createOpenAIEmbedder, createOpenAIMergeJudge } = await import("./adapters/openai-text.js");
      const { semanticMerge } = await import("./merge.js");
      const baseUrl = need(a["base-url"] ?? process.env.DESIGN_CRAFT_BASE_URL, "base-url");
      const apiKey = process.env.DESIGN_CRAFT_API_KEY;
      const v = await loadVocab(a.vocab!);
      // Vector cache lives beside the vocabulary by default (gitignored, regenerable).
      const cachePath = a.cache ?? path.join(path.dirname(path.resolve(a.vocab!)), ".embeddings-cache.json");
      const cache = new Map<string, number[]>(existsSync(cachePath) ? Object.entries(JSON.parse(await readFile(cachePath, "utf8"))) : []);
      const r = await semanticMerge(v, {
        embedder: createOpenAIEmbedder({ baseUrl, apiKey, model: a["embed-model"]! }),
        judge: createOpenAIMergeJudge({ baseUrl, apiKey, model: a["judge-model"]! }),
        candidateThreshold: Number(a.threshold),
        cache,
        dryRun: a["dry-run"],
        blocked: a.block && existsSync(a.block) ? JSON.parse(await readFile(a.block, "utf8")) : [],
      });
      await writeFile(cachePath, JSON.stringify(Object.fromEntries(cache)));
      if (!a["dry-run"]) await saveVocab(a.vocab!, v);
      if (a.report) await writeFile(a.report, JSON.stringify(r, null, 2) + "\n");
      console.log(`${r.values} values · ${r.candidates} candidates · ${r.vetoed.length} vetoed · ${r.judged} judged`);
      console.log(`merged ${r.merged.length} · rejected ${r.rejected.length} · deferred ${r.deferred.length}${a["dry-run"] ? " (dry run)" : ""}`);
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

    case "dataset": {
      const v = await loadVocab(a.vocab!);
      const records = parseJsonl(await readFile(need(a.labels, "labels"), "utf8"));
      const out = need(a.out, "out");
      await mkdir(out, { recursive: true });
      await writeFile(path.join(out, "labels.jsonl"), toJsonl(records));
      await writeFile(path.join(out, "vocabulary.json"), JSON.stringify(v, null, 2) + "\n");
      await writeFile(path.join(out, "DATASHEET.md"), datasheet(records, v, { name: a.name!, version: a.version! }));
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
