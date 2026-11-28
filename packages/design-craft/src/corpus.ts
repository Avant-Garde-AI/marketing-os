/**
 * Corpus manifest (spec 35 §3.1, P2).
 *
 * A corpus is a list of storefronts to capture and label. "Top performing" is
 * not observable for outside brands, so selection is explicit: each store
 * carries the rationale it was chosen for (visual distinctiveness, reputation).
 * Performance signal comes only from our own network outcomes (P4).
 */
import { z } from "zod";
import { brandKey } from "./vocabulary.js";

export const pageTypeSchema = z.enum(["home", "collection", "product", "cart", "landing", "other"]);

export const corpusPageSchema = z.object({
  type: pageTypeSchema,
  /** Absolute URL, or a path resolved against the store URL. */
  url: z.string().min(1),
});
export type CorpusPage = z.infer<typeof corpusPageSchema>;

export const corpusStoreSchema = z.object({
  url: z.string().url(),
  /** Top-level category (spec 35 D4). */
  category: z.string().min(1),
  /** Why this store is in the corpus. Required: selection must be auditable. */
  rationale: z.string().min(1),
  /** Pages to capture. Defaults to the home page only. */
  pages: z.array(corpusPageSchema).default([{ type: "home", url: "/" }]),
  /** Optional tags (e.g. platform, region) for stratified review. */
  tags: z.array(z.string()).default([]),
});
export type CorpusStore = z.infer<typeof corpusStoreSchema>;

export const corpusSchema = z.object({
  name: z.string().min(1),
  version: z.string().default("1"),
  description: z.string().optional(),
  stores: z.array(corpusStoreSchema).min(1),
});
export type Corpus = z.infer<typeof corpusSchema>;

export interface ResolvedPage {
  brand: string;
  category: string;
  type: CorpusPage["type"];
  url: string;
}

/** Flatten a corpus to absolute page URLs, rejecting duplicate brands. */
export function resolveCorpus(input: unknown): { corpus: Corpus; pages: ResolvedPage[] } {
  const corpus = corpusSchema.parse(input);
  const seen = new Set<string>();
  const pages: ResolvedPage[] = [];
  for (const store of corpus.stores) {
    const brand = brandKey(store.url);
    if (seen.has(brand)) throw new Error(`Duplicate brand in corpus: ${brand}`);
    seen.add(brand);
    for (const p of store.pages) {
      pages.push({ brand, category: store.category, type: p.type, url: new URL(p.url, store.url).toString() });
    }
  }
  return { corpus, pages };
}
