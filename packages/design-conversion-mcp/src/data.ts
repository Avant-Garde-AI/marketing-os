/**
 * The bundled open dataset: the vocabulary, its category benchmarks, and the
 * labels behind them, read from the installed `@avant-garde/design-craft` package.
 * A deployment can pass its own files (a newer wave, a private vocabulary).
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseJsonl, vocabularySchema, type Benchmarks, type LabelRecord, type Taxonomy, type Vocabulary } from "@avant-garde/design-craft";

export const DEFAULT_DATASET = "dtc-v1";

export interface DatasetPaths {
  vocabulary: string;
  benchmarks: string;
  taxonomy?: string;
  labels?: string;
}

export function bundledDatasetPaths(name = DEFAULT_DATASET): DatasetPaths {
  const require = createRequire(import.meta.url);
  const at = (f: string) => require.resolve(`@avant-garde/design-craft/corpus/${name}/${f}`);
  return { vocabulary: at("vocabulary.json"), benchmarks: at("benchmarks.json"), taxonomy: at("taxonomy.json"), labels: at("labels.jsonl") };
}

export async function loadDataset(paths: DatasetPaths = bundledDatasetPaths()): Promise<{ vocabulary: Vocabulary; benchmarks: Benchmarks; taxonomy?: Taxonomy; labels?: LabelRecord[] }> {
  const vocabulary = vocabularySchema.parse(JSON.parse(await readFile(paths.vocabulary, "utf8")));
  const benchmarks = JSON.parse(await readFile(paths.benchmarks, "utf8")) as Benchmarks;
  if (benchmarks.schema !== "design-craft/benchmarks@1") throw new Error(`${paths.benchmarks} is not a design-craft benchmarks file`);
  const labels = paths.labels ? parseJsonl(await readFile(paths.labels, "utf8")) : undefined;
  const taxonomy = paths.taxonomy ? (JSON.parse(await readFile(paths.taxonomy, "utf8")) as Taxonomy) : undefined;
  return { vocabulary, benchmarks, ...(taxonomy ? { taxonomy } : {}), ...(labels ? { labels } : {}) };
}
