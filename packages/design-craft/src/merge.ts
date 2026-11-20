/**
 * Semantic value merge (spec 35 P2, first task).
 *
 * Models name the same treatment many ways, so values rarely recur verbatim
 * and the admission gate can't see recurrence. This pass folds synonyms.
 *
 * CALIBRATION FINDING (gemini-embedding-2 on the P1 smoke vocabulary,
 * 2026-11-19): embedding similarity CANNOT decide a merge. `two-column-uniform`
 * vs `four-column-uniform` scored 0.946, higher than the true synonyms
 * `strikethrough-price-with-highlight-tag` vs `strikethrough-and-pill-tag`
 * (0.939). No threshold separates them. So embeddings only RETRIEVE candidates.
 * Every merge is decided by:
 *
 *   1. the deterministic guards (`mergeVeto`: opposition groups, role swap),
 *      which run first and cannot be overruled; then
 *   2. a judge model, asked whether a shopper would see the same thing.
 *
 * Clustering is conservative: a value joins a cluster only through a judged
 * pair with that cluster's canonical value, and two multi-member clusters are
 * never merged in one pass. Chained "A≈B, B≈C" never silently makes A≈C.
 */
import { isRecognized, mergeValues, mergeVeto, type Vocabulary } from "./vocabulary.js";

export interface Embedder {
  readonly id: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface CandidatePair {
  id: string;
  axis: string;
  a: { key: string; text: string };
  b: { key: string; text: string };
  score: number;
}

export interface Verdict {
  id: string;
  same: boolean;
  reason?: string;
}

export interface MergeJudge {
  readonly id: string;
  judge(axis: string, pairs: CandidatePair[]): Promise<Verdict[]>;
}

export interface SemanticMergeOptions {
  embedder: Embedder;
  judge: MergeJudge;
  /** Minimum cosine similarity for a pair to be judged at all (default 0.85). */
  candidateThreshold?: number;
  /** Nearest neighbours per value sent for judging (default 3). */
  maxCandidatesPerValue?: number;
  /** Optional vector cache keyed by `${embedder.id}|${text}`. */
  cache?: Map<string, number[]>;
  /** Restrict to these axes. */
  axes?: string[];
  /** Judge and report, but don't change the vocabulary. */
  dryRun?: boolean;
  /**
   * Reviewer-rejected pairs: never merged, never sent to the judge. The undo
   * for a bad merge is to block the pair and replay debrand + merge from labels,
   * which are the source of truth. The vocabulary is derived.
   */
  blocked?: { axis: string; a: string; b: string }[];
  /**
   * Only merge on recognized axes (default true). Recognition depends on brand
   * support per axis, not on its values, so skipping unrecognized axes loses nothing.
   */
  recognizedOnly?: boolean;
  /**
   * Judge verdicts keyed by judge + axis + both texts. A dry run fills it, so the
   * real run (and any replay from labels) only pays for pairs never judged before.
   */
  verdictCache?: Map<string, { same: boolean; reason?: string }>;
  /** Called after each axis, so callers can persist caches as they go. */
  onAxisDone?: (axis: string) => void | Promise<void>;
}

export interface MergeDecision {
  axis: string;
  from: string;
  into: string;
  score: number;
  reason?: string;
}

export interface SemanticMergeReport {
  values: number;
  candidates: number;
  vetoed: { axis: string; a: string; b: string; score: number }[];
  judged: number;
  rejected: { axis: string; a: string; b: string; score: number; reason?: string }[];
  merged: MergeDecision[];
  /** Accepted by the judge but skipped by the conservative clustering rule. */
  deferred: MergeDecision[];
  promoted: { axis: string; key: string; support: number }[];
  /** Judge batches (or a whole axis's embedding call, `pairs: 0`) that failed after retries. Nothing there was merged (the safe default). */
  errors: { axis: string; pairs: number; error: string }[];
  /** Pairs answered from the verdict cache instead of the judge. */
  cachedVerdicts: number;
}

/** The text that represents a value for embedding and judging. */
export function valueText(axis: string, label: string, gloss?: string): string {
  const words = (s: string) => s.replace(/-/g, " ");
  return `${words(axis)}: ${words(label)}${gloss ? `. ${gloss}` : ""}`;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function embedAll(embedder: Embedder, texts: string[], cache?: Map<string, number[]>): Promise<number[][]> {
  const keyOf = (t: string) => `${embedder.id}|${t}`;
  const missing = [...new Set(texts.filter((t) => !cache?.has(keyOf(t))))];
  const fresh = new Map<string, number[]>();
  if (missing.length) {
    const vecs = await embedder.embed(missing);
    if (vecs.length !== missing.length) throw new Error(`embedder returned ${vecs.length} vectors for ${missing.length} texts`);
    missing.forEach((t, i) => {
      fresh.set(t, vecs[i]!);
      cache?.set(keyOf(t), vecs[i]!);
    });
  }
  return texts.map((t) => fresh.get(t) ?? cache!.get(keyOf(t))!);
}

export async function semanticMerge(v: Vocabulary, opts: SemanticMergeOptions): Promise<SemanticMergeReport> {
  const threshold = opts.candidateThreshold ?? 0.85;
  const blocked = new Set((opts.blocked ?? []).flatMap(({ axis, a, b }) => [`${axis}|${a}|${b}`, `${axis}|${b}|${a}`]));
  const k = opts.maxCandidatesPerValue ?? 3;
  const report: SemanticMergeReport = { values: 0, candidates: 0, vetoed: [], judged: 0, rejected: [], merged: [], deferred: [], promoted: [], errors: [], cachedVerdicts: 0 };
  const admittedBefore = new Set(
    Object.entries(v.axes).flatMap(([a, ax]) => Object.entries(ax.values).filter(([, e]) => e.admitted).map(([key]) => `${a}|${key}`)),
  );

  for (const axis of Object.keys(v.axes).sort()) {
    if (opts.axes && !opts.axes.includes(axis)) continue;
    if ((opts.recognizedOnly ?? true) && !isRecognized(v, axis)) continue;
    const entries = Object.entries(v.axes[axis]!.values);
    report.values += entries.length;
    if (entries.length < 2) continue;

    const texts = entries.map(([key, e]) => valueText(axis, e.label || key, e.gloss));
    // An embedding failure (quota, outage) skips this axis untouched instead of
    // aborting the pass, so axes already merged are still saved.
    let vecs: number[][];
    try {
      vecs = await embedAll(opts.embedder, texts, opts.cache);
    } catch (e) {
      report.errors.push({ axis, pairs: 0, error: `embed: ${(e as Error).message.slice(0, 200)}` });
      continue;
    }

    // Retrieval: each value's top-k neighbours above the threshold, unordered pairs deduped.
    const seen = new Set<string>();
    const pairs: CandidatePair[] = [];
    for (let i = 0; i < entries.length; i++) {
      const sims = entries
        .map((_, j) => ({ j, s: j === i ? -1 : cosine(vecs[i]!, vecs[j]!) }))
        .filter((x) => x.s >= threshold)
        .sort((x, y) => y.s - x.s)
        .slice(0, k);
      for (const { j, s } of sims) {
        const [lo, hi] = i < j ? [i, j] : [j, i];
        const id = `${lo}:${hi}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const a = entries[lo]![0];
        const b = entries[hi]![0];
        report.candidates++;
        if (mergeVeto(a, b) || blocked.has(`${axis}|${a}|${b}`)) {
          report.vetoed.push({ axis, a, b, score: s });
          continue;
        }
        pairs.push({ id, axis, a: { key: a, text: texts[lo]! }, b: { key: b, text: texts[hi]! }, score: s });
      }
    }
    if (!pairs.length) continue;

    // Judge in batches so one axis with many values stays within a sane prompt size.
    const verdicts = new Map<string, Verdict>();
    const cacheKey = (p: CandidatePair) => `${opts.judge.id}|${axis}|${[p.a.text, p.b.text].sort().join("||")}`;
    const toJudge: CandidatePair[] = [];
    for (const p of pairs) {
      const hit = opts.verdictCache?.get(cacheKey(p));
      if (hit) verdicts.set(p.id, { id: p.id, ...hit });
      else toJudge.push(p);
    }
    for (let o = 0; o < toJudge.length; o += 30) {
      const batch = toJudge.slice(o, o + 30);
      try {
        for (const vd of await opts.judge.judge(axis, batch)) {
          verdicts.set(vd.id, vd);
          const p = batch.find((x) => x.id === vd.id);
          if (p) opts.verdictCache?.set(cacheKey(p), { same: vd.same, ...(vd.reason ? { reason: vd.reason } : {}) });
        }
        report.judged += batch.length;
      } catch (e) {
        // One failed batch must not discard the whole pass. Unjudged pairs stay unmerged.
        report.errors.push({ axis, pairs: batch.length, error: (e as Error).message.slice(0, 200) });
      }
    }

    // Conservative clustering over accepted pairs, strongest first.
    const root = new Map<string, string>(entries.map(([key]) => [key, key]));
    const size = new Map<string, number>(entries.map(([key]) => [key, 1]));
    const find = (x: string): string => (root.get(x) === x ? x : find(root.get(x)!));
    const support = (key: string) => v.axes[axis]!.values[key]?.support.length ?? 0;

    for (const p of [...pairs].sort((x, y) => y.score - x.score)) {
      const vd = verdicts.get(p.id);
      if (!vd?.same) {
        report.rejected.push({ axis, a: p.a.key, b: p.b.key, score: p.score, reason: vd?.reason ?? "no verdict" });
        continue;
      }
      const ra = find(p.a.key);
      const rb = find(p.b.key);
      if (ra === rb) continue;
      const sa = size.get(ra)!;
      const sb = size.get(rb)!;
      // Only a canonical value may absorb, and only a singleton may be absorbed.
      const aIsRoot = p.a.key === ra;
      const bIsRoot = p.b.key === rb;
      let into: string | null = null;
      let from: string | null = null;
      if (sa > 1 && sb > 1) into = null;
      else if (sa > 1) [into, from] = aIsRoot ? [ra, rb] : [null, null];
      else if (sb > 1) [into, from] = bIsRoot ? [rb, ra] : [null, null];
      else {
        // Two singletons: the better-supported (then glossed, then shorter) name is canonical.
        const score = (key: string) => support(key) * 1000 + (v.axes[axis]!.values[key]?.gloss ? 100 : 0) - key.length;
        [into, from] = score(ra) >= score(rb) ? [ra, rb] : [rb, ra];
      }
      const decision: MergeDecision = { axis, from: from ?? rb, into: into ?? ra, score: p.score, reason: vd.reason };
      if (!into || !from) {
        report.deferred.push(decision);
        continue;
      }
      root.set(from, into);
      size.set(into, sa + sb);
      report.merged.push(decision);
    }

    report.cachedVerdicts += pairs.length - toJudge.length;
    if (!opts.dryRun) {
      // Apply in dependency order: every `from` is a singleton absorbed into a canonical.
      for (const m of report.merged.filter((d) => d.axis === axis)) {
        mergeValues(v, axis, m.from, m.into, { method: "semantic", score: Number(m.score.toFixed(4)), judge: opts.judge.id, reason: m.reason });
      }
    }
    await opts.onAxisDone?.(axis);
  }

  if (!opts.dryRun) {
    for (const [a, ax] of Object.entries(v.axes)) {
      for (const [key, e] of Object.entries(ax.values)) {
        if (e.admitted && !admittedBefore.has(`${a}|${key}`)) report.promoted.push({ axis: a, key, support: e.support.length });
      }
    }
  }
  return report;
}

/** The judge prompt. Exported so tests can pin the rules it states. */
export const MERGE_JUDGE_SYSTEM = [
  "You decide whether two names on the same storefront design axis describe the SAME treatment.",
  "SAME means a shopper looking at either page would see the same thing, so one name could replace the other in a design vocabulary.",
  "DIFFERENT if they differ in count, position, direction, alignment, size, which element carries the color, the mechanism (manual vs automatic), or what is shown.",
  "A broader name and a narrower one are DIFFERENT: if one name adds a qualifier the other lacks (an alignment, a position, an extra element, \"only\", a device), they are DIFFERENT.",
  "If either name or description covers alternatives (\"either … or\", \"and/or\", \"mixed\") that the other does not, they are DIFFERENT.",
  "Judge the treatment, not the store: two descriptions of one brand's page are not evidence of sameness.",
  "When unsure, answer DIFFERENT: a wrong merge corrupts the vocabulary, a missed one is fixed later.",
  'Return STRICT JSON: {"verdicts": [{"id": "<pair id>", "same": true|false, "reason": "<short>"}]}',
].join("\n");

export function mergeJudgePrompt(axis: string, pairs: CandidatePair[]): string {
  return [
    `AXIS: ${axis.replace(/-/g, " ")}`,
    "",
    ...pairs.map((p) => `PAIR ${p.id}\n  A: ${p.a.text}\n  B: ${p.b.text}`),
    "",
    "One verdict per pair. JSON only.",
  ].join("\n");
}
