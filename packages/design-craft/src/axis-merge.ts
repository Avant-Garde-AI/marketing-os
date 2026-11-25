/**
 * Axis-level merge (spec 35 P2).
 *
 * The teacher names the same DIMENSION several ways (`sub-category-navigation`,
 * `subcategory-navigation`, `secondary-nav-treatment`), so emergent axes each stay
 * under the 3-brand recognition gate and the emergence rate reads as zero. This
 * pass folds them, with the same shape as the value merge:
 *
 *   embeddings only RETRIEVE → deterministic rules veto → a judge decides every merge
 *   → conservative clustering (no chains) → provenance recorded on the absorbing axis.
 *
 * Axis-specific rules:
 *   - Only emergent axes are absorbed. Seed axes are never merged into anything,
 *     including each other: they are the curated lens, distinct by construction.
 *   - The judged question is directional: would every value seen under FROM be a
 *     sensible, specific answer to INTO's question? A narrower dimension may fold
 *     into a broader one that already asks it, never the reverse.
 *   - Run before the value merge (debrand → merge-axes → merge), so values moved
 *     onto an axis are then deduplicated against its existing values.
 */
import type { Embedder, Verdict } from "./merge.js";
import { cosine, embedAll } from "./merge.js";
import { mergeAxes, type Vocabulary } from "./vocabulary.js";

export interface AxisPair {
  id: string;
  from: { key: string; text: string };
  into: { key: string; text: string };
  score: number;
}

export interface AxisJudge {
  readonly id: string;
  judge(pairs: AxisPair[]): Promise<Verdict[]>;
}

export interface AxisMergeOptions {
  embedder: Embedder;
  judge: AxisJudge;
  /** Minimum cosine for an axis pair to be judged at all (default 0.75). */
  candidateThreshold?: number;
  /** Nearest axes per emergent axis sent for judging (default 3). */
  maxCandidatesPerAxis?: number;
  cache?: Map<string, number[]>;
  /** Verdicts keyed by judge + direction + both texts. */
  verdictCache?: Map<string, { same: boolean; reason?: string }>;
  /** Reviewer-rejected axis pairs, either direction: never judged, never merged. */
  blocked?: { a: string; b: string }[];
  dryRun?: boolean;
}

export interface AxisMergeDecision {
  from: string;
  into: string;
  score: number;
  reason?: string;
}

export interface AxisMergeReport {
  axes: number;
  emergent: number;
  candidates: number;
  vetoed: { a: string; b: string; score: number; why: string }[];
  judged: number;
  cachedVerdicts: number;
  rejected: (AxisMergeDecision & { reason?: string })[];
  merged: AxisMergeDecision[];
  /** Accepted by the judge but skipped because it would chain through another merge. */
  deferred: AxisMergeDecision[];
  /** Axes that crossed the recognition gate because of a merge. */
  recognized: { axis: string; brands: number }[];
  errors: { pairs: number; error: string }[];
}

/** What an axis asks, plus what was seen under it: the text that is embedded and judged. */
export function axisText(v: Vocabulary, axis: string, maxValues = 8): string {
  const ax = v.axes[axis]!;
  const words = (s: string) => s.replace(/-/g, " ");
  const values = Object.entries(ax.values)
    .sort(([, a], [, b]) => b.support.length - a.support.length)
    .slice(0, maxValues)
    .map(([key, e]) => `${words(e.label || key)}${e.gloss ? ` (${e.gloss.slice(0, 140)})` : ""}`);
  return [`${words(axis)}${ax.description ? `: ${ax.description}` : ""}`, values.length ? `Values seen: ${values.join("; ")}` : ""]
    .filter(Boolean)
    .join(". ");
}

/** Absorbing direction: a seed always absorbs; otherwise more brands, then more values, then the shorter name. */
function direction(v: Vocabulary, a: string, b: string): [from: string, into: string] {
  const rank = (k: string) => {
    const ax = v.axes[k]!;
    return (ax.origin === "seeded" ? 1e9 : 0) + ax.axisSupport.length * 1e4 + Object.keys(ax.values).length * 10 - k.length / 100;
  };
  return rank(a) >= rank(b) ? [b, a] : [a, b];
}

export async function axisMerge(v: Vocabulary, opts: AxisMergeOptions): Promise<AxisMergeReport> {
  const threshold = opts.candidateThreshold ?? 0.75;
  const k = opts.maxCandidatesPerAxis ?? 3;
  const blocked = new Set((opts.blocked ?? []).flatMap(({ a, b }) => [`${a}|${b}`, `${b}|${a}`]));
  const axes = Object.keys(v.axes).sort();
  const emergent = axes.filter((a) => v.axes[a]!.origin !== "seeded");
  const report: AxisMergeReport = {
    axes: axes.length, emergent: emergent.length, candidates: 0, vetoed: [], judged: 0, cachedVerdicts: 0,
    rejected: [], merged: [], deferred: [], recognized: [], errors: [],
  };
  if (!emergent.length || axes.length < 2) return report;
  const recognizedBefore = new Set(axes.filter((a) => v.axes[a]!.recognized));

  const texts = new Map(axes.map((a) => [a, axisText(v, a)]));
  const vecs = await embedAll(opts.embedder, axes.map((a) => texts.get(a)!), opts.cache);
  const vec = new Map(axes.map((a, i) => [a, vecs[i]!]));

  // Retrieval: each emergent axis's top-k neighbours (any axis) above the threshold.
  const seen = new Set<string>();
  const pairs: AxisPair[] = [];
  for (const e of emergent) {
    const near = axes
      .filter((o) => o !== e)
      .map((o) => ({ o, s: cosine(vec.get(e)!, vec.get(o)!) }))
      .filter((x) => x.s >= threshold)
      .sort((x, y) => y.s - x.s)
      .slice(0, k);
    for (const { o, s } of near) {
      const id = [e, o].sort().join("|");
      if (seen.has(id)) continue;
      seen.add(id);
      report.candidates++;
      if (blocked.has(`${e}|${o}`)) {
        report.vetoed.push({ a: e, b: o, score: s, why: "reviewer block" });
        continue;
      }
      const [from, into] = direction(v, e, o);
      pairs.push({ id, from: { key: from, text: texts.get(from)! }, into: { key: into, text: texts.get(into)! }, score: s });
    }
  }

  // Judge (cached by direction, since the question is directional).
  const verdicts = new Map<string, Verdict>();
  const cacheKey = (p: AxisPair) => `${opts.judge.id}|axis|${p.from.text}=>${p.into.text}`;
  const toJudge: AxisPair[] = [];
  for (const p of pairs) {
    const hit = opts.verdictCache?.get(cacheKey(p));
    if (hit) verdicts.set(p.id, { id: p.id, ...hit });
    else toJudge.push(p);
  }
  report.cachedVerdicts = pairs.length - toJudge.length;
  for (let o = 0; o < toJudge.length; o += 20) {
    const batch = toJudge.slice(o, o + 20);
    try {
      for (const vd of await opts.judge.judge(batch)) {
        verdicts.set(vd.id, vd);
        const p = batch.find((x) => x.id === vd.id);
        if (p) opts.verdictCache?.set(cacheKey(p), { same: vd.same, ...(vd.reason ? { reason: vd.reason } : {}) });
      }
      report.judged += batch.length;
    } catch (e) {
      report.errors.push({ pairs: batch.length, error: (e as Error).message.slice(0, 200) });
    }
  }

  // Conservative clustering, strongest first: an axis is absorbed at most once, an
  // absorbed axis can't absorb, and an axis that absorbed others is not itself moved.
  const absorbedInto = new Map<string, string>();
  const absorbers = new Set<string>();
  for (const p of [...pairs].sort((x, y) => y.score - x.score)) {
    const vd = verdicts.get(p.id);
    const d: AxisMergeDecision = { from: p.from.key, into: p.into.key, score: p.score, reason: vd?.reason };
    if (!vd?.same) {
      report.rejected.push({ ...d, reason: vd?.reason ?? "no verdict" });
      continue;
    }
    if (absorbedInto.has(d.from) || absorbedInto.has(d.into) || absorbers.has(d.from)) {
      report.deferred.push(d);
      continue;
    }
    absorbedInto.set(d.from, d.into);
    absorbers.add(d.into);
    report.merged.push(d);
  }

  if (!opts.dryRun) {
    for (const m of report.merged) {
      mergeAxes(v, m.from, m.into, { method: "semantic", score: Number(m.score.toFixed(4)), judge: opts.judge.id, reason: m.reason });
    }
    for (const [a, ax] of Object.entries(v.axes)) {
      if (ax.recognized && !recognizedBefore.has(a)) report.recognized.push({ axis: a, brands: ax.axisSupport.length });
    }
  }
  return report;
}

export const AXIS_JUDGE_SYSTEM = [
  "You decide whether one design dimension of an online storefront should be folded into another.",
  "Each dimension is a question a designer answers when building a page, shown with the answers (values) seen for it.",
  "Answer SAME only if every value seen under FROM would be a sensible, specific answer to INTO's question, so FROM is INTO under another name or a part INTO already covers.",
  "DIFFERENT if FROM concerns a different element, a different page region, or a different property (layout vs color vs behavior vs content) than INTO asks about.",
  "DIFFERENT if INTO is the narrower one: a broad dimension never folds into a specific one.",
  "Judge the question, not the store or the wording: similar words about different elements are DIFFERENT.",
  "When unsure, answer DIFFERENT: a wrong merge mixes two vocabularies, a missed one is fixed later.",
  'Return STRICT JSON: {"verdicts": [{"id": "<pair id>", "same": true|false, "reason": "<short>"}]}',
].join("\n");

export function axisJudgePrompt(pairs: AxisPair[]): string {
  return [...pairs.map((p) => `PAIR ${p.id}\n  FROM: ${p.from.text}\n  INTO: ${p.into.text}`), "", "One verdict per pair. JSON only."].join("\n");
}
