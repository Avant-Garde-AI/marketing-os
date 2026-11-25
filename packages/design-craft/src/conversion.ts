/**
 * Conversion orientation (spec 35 §3.3, the pre-model decision layer).
 *
 * The vocabulary says WHAT a storefront does. This module says what each axis is
 * FOR in the purchase path, how the category's best-known DTC brands answer it,
 * and which move a page could make next. It is the decision model's action space
 * and its first, transparent baseline. Network outcomes later retrain the
 * ranking; the shape of a stroke stays the same.
 *
 * Honesty rules, which the output carries verbatim:
 *   - Category prevalence is a CONVENTION signal, not a conversion measurement.
 *     The corpus was chosen for distinctiveness and reputation; nobody outside a
 *     store can see its conversion rate (spec 35 §6). `evidence: "corpus-prevalence"`.
 *   - The stage/lever lens and the page-type weights are design hypotheses, written
 *     down so they can be argued with, overridden, and eventually replaced by learned
 *     weights. They are not findings.
 *   - A value a page uses that its category rarely uses is reported as DISTINCTIVE,
 *     never as wrong. Brand distinctiveness is often the point.
 *   - Measured outcomes enter only through `ValueEntry.reward` (offered/chosen from
 *     the action gate), and a stroke says when it used them.
 */
import type { LabelRecord } from "./labels.js";
import type { Taxonomy } from "./taxonomy.js";
import { DTC_SEED_AXES, type PageType } from "./ontology.js";
import { admittedValues, findNearDuplicate, normalizeAxis, normalizeValue, resolveAxis, type Vocabulary } from "./vocabulary.js";

// ── The lens ─────────────────────────────────────────────────────────────────

/** Where in the purchase path an axis does its work. */
export type ConversionStage = "attention" | "orientation" | "evaluation" | "confidence" | "commitment" | "basket";
/** What the axis changes for the shopper. */
export type ConversionLever = "clarity" | "motivation" | "trust" | "friction" | "value" | "identity";

export interface ConversionRole {
  stage: ConversionStage;
  lever: ConversionLever;
  /** The conversion question this axis answers, in a designer's words. */
  job: string;
}

export const CONVERSION_STAGES: { stage: ConversionStage; question: string }[] = [
  { stage: "attention", question: "Does the shopper understand what this is and want to keep going?" },
  { stage: "orientation", question: "Can the shopper find the right products quickly?" },
  { stage: "evaluation", question: "Can the shopper understand and compare the product?" },
  { stage: "confidence", question: "Does the shopper believe the product and the store?" },
  { stage: "commitment", question: "Is choosing and buying effortless?" },
  { stage: "basket", question: "Does the order grow, and does checkout stay frictionless?" },
];

/**
 * Hypothesized conversion role per recognized axis. Seeds are covered by a test;
 * an emergent axis gets a role when it is recognized (see `conversionRole`).
 */
export const CONVERSION_LENS: Record<string, ConversionRole> = {
  "announcement-bar-treatment": { stage: "attention", lever: "motivation", job: "Does the first line a shopper reads give them a reason to stay: an offer, a shipping threshold, news?" },
  "nav-architecture": { stage: "orientation", lever: "clarity", job: "Can a shopper reach their category in one move from any page?" },
  "ground-tone": { stage: "attention", lever: "identity", job: "Does the canvas carry the brand without competing with the product?" },
  "type-voice": { stage: "attention", lever: "identity", job: "Does the type read as this brand, and does it keep body copy and prices legible?" },
  "accent-economy": { stage: "commitment", lever: "clarity", job: "Is accent color spent on what the shopper should act on (calls to action, prices, offers), so action stands out?" },
  "section-seam": { stage: "orientation", lever: "clarity", job: "Can a scrolling shopper tell where one idea ends and the next begins?" },
  "motion-language": { stage: "attention", lever: "identity", job: "Does motion direct attention to what matters, or compete with it?" },
  "hero-composition": { stage: "attention", lever: "clarity", job: "Does the first screen show what is sold and where to go next?" },
  "hero-message-mode": { stage: "attention", lever: "motivation", job: "Does the first message give a reason to buy (benefit, offer, newness) or only set a mood?" },
  "merchandising-entry": { stage: "orientation", lever: "friction", job: "How many steps separate the home page from a product the shopper wants?" },
  "brand-story-placement": { stage: "confidence", lever: "identity", job: "Does the brand story support the purchase without standing between the shopper and product?" },
  "collection-grid-density": { stage: "evaluation", lever: "clarity", job: "Can a shopper scan and compare enough products per screen?" },
  "product-card-anatomy": { stage: "evaluation", lever: "clarity", job: "Can a shopper decide to click (or add) from the card alone?" },
  "filter-presentation": { stage: "orientation", lever: "friction", job: "Can a shopper narrow a large collection without losing their place?" },
  "pdp-gallery-behavior": { stage: "evaluation", lever: "clarity", job: "Can a shopper see the product the way they would in a store?" },
  "buy-box-structure": { stage: "commitment", lever: "friction", job: "Is everything needed to buy (price, options, call to action) together and in decision order?" },
  "variant-selection-style": { stage: "commitment", lever: "friction", job: "Can a shopper pick size, color or flavor with confidence and without errors?" },
  "offer-framing": { stage: "commitment", lever: "motivation", job: "Is the price and any saving understood at a glance?" },
  "social-proof-density": { stage: "confidence", lever: "trust", job: "Does other shoppers' evidence appear where doubt arises?" },
  "trust-signal-placement": { stage: "confidence", lever: "trust", job: "Do guarantees, shipping and returns sit next to the decision they reassure?" },
  "product-detail-disclosure": { stage: "evaluation", lever: "clarity", job: "Can a shopper find the detail they need without wading through all of it?" },
  "cross-sell-pattern": { stage: "basket", lever: "value", job: "Does the page offer a relevant next item at the moment it is easy to add?" },
  "cart-surface": { stage: "basket", lever: "friction", job: "Does adding to cart keep the shopper moving, and does the cart help the order grow?" },
  "photography-register": { stage: "evaluation", lever: "identity", job: "Does the imagery show the product truthfully and in the life it promises?" },
  // Emergent axes recognized on wave 1 (2026-11-25).
  "sticky-buy-behavior": { stage: "commitment", lever: "friction", job: "Is the way to buy still within reach after the shopper scrolls into the detail?" },
  "sub-category-navigation": { stage: "orientation", lever: "friction", job: "Can a shopper move between neighbouring categories without going back to the menu?" },
  "promotional-overlay": { stage: "attention", lever: "motivation", job: "Does an interrupting offer earn its interruption, and is it easy to dismiss?" },
};

export function conversionRole(axis: string): ConversionRole | null {
  return CONVERSION_LENS[normalizeAxis(axis)] ?? null;
}

/**
 * How much each stage matters on each page type. HYPOTHESES (2026-11-25), used to
 * rank strokes until outcome data can learn them. Override per call.
 */
export type StageWeights = Record<PageType, Record<ConversionStage, number>>;
export const DEFAULT_STAGE_WEIGHTS: StageWeights = {
  home: { attention: 1, orientation: 0.9, confidence: 0.6, evaluation: 0.5, commitment: 0.3, basket: 0.2 },
  landing: { attention: 1, orientation: 0.6, confidence: 0.8, evaluation: 0.6, commitment: 0.7, basket: 0.2 },
  collection: { attention: 0.4, orientation: 1, evaluation: 0.9, confidence: 0.5, commitment: 0.6, basket: 0.2 },
  product: { attention: 0.3, orientation: 0.4, evaluation: 0.9, confidence: 0.9, commitment: 1, basket: 0.6 },
  cart: { attention: 0.2, orientation: 0.2, evaluation: 0.3, confidence: 0.8, commitment: 1, basket: 1 },
  other: { attention: 0.6, orientation: 0.6, evaluation: 0.6, confidence: 0.6, commitment: 0.6, basket: 0.6 },
};

// ── Resolution: a raw (axis, value) to the vocabulary's canonical admitted value ──

/**
 * Map a labeler's raw (axis, value) to the admitted value it denotes: through axis
 * aliases (axis merge), value aliases (judged merge), and exact rewordings. Pending
 * values return null. They are not in the action space yet.
 */
export function resolveAdmitted(v: Vocabulary, axis: string, value: string): { axis: string; value: string } | null {
  const a = resolveAxis(v, normalizeAxis(axis));
  const ax = v.axes[a];
  if (!ax) return null;
  const key = normalizeValue(value);
  const admitted = admittedValues(v, a);
  if (admitted.includes(key)) return { axis: a, value: key };
  const owner = admitted.find((k) => ax.values[k]!.aliases?.includes(key));
  if (owner) return { axis: a, value: owner };
  const dup = findNearDuplicate({ ...ax, values: Object.fromEntries(admitted.map((k) => [k, ax.values[k]!])) }, key);
  return dup ? { axis: a, value: dup } : null;
}

/** Every admitted (axis, value) a label record shows, from its facets and its proposals. */
export function resolvedObservations(v: Vocabulary, rec: Pick<LabelRecord, "facets" | "proposals">): { axis: string; value: string }[] {
  const out = new Map<string, { axis: string; value: string }>();
  const add = (axis: string, value: string) => {
    const r = resolveAdmitted(v, axis, value);
    if (r) out.set(`${r.axis}|${r.value}`, r);
  };
  for (const [axis, value] of Object.entries(rec.facets ?? {})) if (typeof value === "string") add(axis, value);
  for (const p of rec.proposals ?? []) add(p.axis, p.value);
  return [...out.values()];
}

/**
 * Unresolved proposals: treatments the page shows that are not (yet) admitted.
 * In an audit these are the page's distinctive moves.
 */
export function unresolvedProposals(v: Vocabulary, rec: Pick<LabelRecord, "proposals">): { axis: string; value: string; gloss?: string }[] {
  return (rec.proposals ?? [])
    .filter((p) => !resolveAdmitted(v, p.axis, p.value))
    .map((p) => ({ axis: resolveAxis(v, normalizeAxis(p.axis)), value: normalizeValue(p.value), ...(p.gloss ? { gloss: p.gloss } : {}) }));
}

// ── Category benchmarks ──────────────────────────────────────────────────────

export interface ValueBenchmark {
  value: string;
  /** Brands in this category observed using the value. */
  brands: number;
  /** brands / the axis's answering brands in this category. */
  share: number;
  /** Up to 5 brand domains, for a human to go and look. */
  examples: string[];
}

/** A family's footprint in a category: brands using any of its values. */
export interface FamilyBenchmark {
  family: string;
  label: string;
  brands: number;
  share: number;
  examples: string[];
  /** The family's values this category uses, most brands first: the concrete targets for a stroke. */
  values: { value: string; brands: number }[];
}

export interface AxisBenchmark {
  /** Brands in the category with an admitted value observed on this axis. */
  brands: number;
  /** answering brands / category brands. */
  coverage: number;
  pageTypes: PageType[];
  values: ValueBenchmark[];
  /** Present when the taxonomy groups this axis: conventions measured on decisions, not wordings. */
  families?: FamilyBenchmark[];
}

export interface CategoryBenchmark {
  brands: number;
  /** Set when the category is below `minBrands`: lookups fall back to this key. */
  fallback?: string;
  /** Both viewports pooled. */
  axes: Record<string, AxisBenchmark>;
  /**
   * Per viewport. A desktop page is compared with desktop pages only: pooling them
   * told a desktop header to adopt the mobile hamburger (Everlane audit, 2026-11-25).
   */
  viewports?: Record<"desktop" | "mobile", Record<string, AxisBenchmark>>;
  /**
   * Per page type × viewport ("product:mobile"). Social proof on a product page is a review
   * section, on a collection page it is card ratings; pooled, a PDP was told to adopt card
   * ratings (2026-11-25). `suggestStrokes` uses the narrowest scope with enough brands, per axis.
   */
  pages?: Record<string, Record<string, AxisBenchmark>>;
}

export interface Benchmarks {
  schema: "design-craft/benchmarks@1";
  vocabularyRef: string;
  minBrands: number;
  source: {
    labels: number;
    brands: number;
    capturedFrom?: string;
    capturedTo?: string;
    /**
     * Set when every capture falls inside a sale season (e.g. "black-friday-2026").
     * Motivation-lever conventions (hero message, offers, overlays) then describe the
     * season, not the brand, and `suggestStrokes` reports them instead of suggesting them.
     */
    season?: string;
  };
  /** `all` is every brand; each category is computed from its own brands only. */
  categories: Record<string, CategoryBenchmark>;
  /** The taxonomy the family conventions were computed with. */
  taxonomyRef?: string;
}

export const ALL_CATEGORIES = "all";

/**
 * Build per-category benchmarks from label records. Support counts distinct brands,
 * like admission. A category with fewer than `minBrands` brands (spec 35 §3.3's
 * minimum-support rule, K=5) gets no conventions of its own and falls back to `all`.
 */
export function buildBenchmarks(v: Vocabulary, records: Iterable<LabelRecord>, opts: { minBrands?: number; vocabularyRef?: string; maxExamples?: number; taxonomy?: Taxonomy; season?: string } = {}): Benchmarks {
  const minBrands = opts.minBrands ?? 5;
  const maxExamples = opts.maxExamples ?? 5;
  const brandCategory = new Map<string, string>();
  // "category|scope" → "axis|value" → brands, where scope is "any" or a viewport.
  const uses = new Map<string, Map<string, Set<string>>>();
  const pages = new Map<string, Set<PageType>>(); // axis → page types
  let labels = 0;
  let from: string | undefined;
  let to: string | undefined;
  for (const rec of records) {
    labels++;
    brandCategory.set(rec.brand, rec.category);
    if (!from || rec.capturedAt < from) from = rec.capturedAt;
    if (!to || rec.capturedAt > to) to = rec.capturedAt;
    for (const { axis, value } of resolvedObservations(v, rec)) {
      for (const cat of [rec.category, ALL_CATEGORIES]) {
        for (const scope of ["any", rec.viewport, `${rec.pageType}:${rec.viewport}`]) {
          const m = uses.get(`${cat}|${scope}`) ?? uses.set(`${cat}|${scope}`, new Map()).get(`${cat}|${scope}`)!;
          const k = `${axis}|${value}`;
          (m.get(k) ?? m.set(k, new Set()).get(k)!).add(rec.brand);
        }
      }
      (pages.get(axis) ?? pages.set(axis, new Set()).get(axis)!).add(rec.pageType);
    }
  }
  const brandsIn = (cat: string) => (cat === ALL_CATEGORIES ? brandCategory.size : [...brandCategory.values()].filter((c) => c === cat).length);
  const scopesSeen = new Set<string>();
  for (const k of uses.keys()) scopesSeen.add(k.split("|")[1]!);
  const pageScopes = [...scopesSeen].filter((x) => x.includes(":")).sort();
  const axesFor = (key: string, n: number, maxValues = Infinity): Record<string, AxisBenchmark> => {
    const byAxis = new Map<string, Map<string, Set<string>>>();
    for (const [k, brands] of uses.get(key) ?? []) {
      const [axis, value] = k.split("|") as [string, string];
      (byAxis.get(axis) ?? byAxis.set(axis, new Map()).get(axis)!).set(value, brands);
    }
    const axes: Record<string, AxisBenchmark> = {};
    for (const [axis, values] of [...byAxis].sort(([a], [b]) => a.localeCompare(b))) {
      const answering = new Set([...values.values()].flatMap((s) => [...s]));
      const fams = opts.taxonomy?.axes[axis]?.families;
      axes[axis] = {
        brands: answering.size,
        coverage: round(answering.size / n),
        pageTypes: [...(pages.get(axis) ?? [])].sort(),
        values: [...values]
          .map(([value, brands]) => ({ value, brands: brands.size, share: round(brands.size / answering.size), examples: [...brands].sort().slice(0, maxExamples) }))
          .sort((x, y) => y.brands - x.brands || x.value.localeCompare(y.value))
          .slice(0, maxValues),
        ...(fams
          ? {
              families: fams
                .map((f) => {
                  const used = f.values.filter((x) => values.has(x));
                  const brands = new Set(used.flatMap((x) => [...values.get(x)!]));
                  return {
                    family: f.key,
                    label: f.label,
                    brands: brands.size,
                    share: round(brands.size / answering.size),
                    examples: [...brands].sort().slice(0, maxExamples),
                    values: used.map((x) => ({ value: x, brands: values.get(x)!.size })).sort((a, b) => b.brands - a.brands || a.value.localeCompare(b.value)),
                  };
                })
                .filter((f) => f.brands > 0)
                .sort((x, y) => y.brands - x.brands || x.family.localeCompare(y.family)),
            }
          : {}),
      };
    }
    return axes;
  };
  const categories: Record<string, CategoryBenchmark> = {};
  for (const cat of [ALL_CATEGORIES, ...[...new Set(brandCategory.values())].sort()]) {
    const n = brandsIn(cat);
    if (cat !== ALL_CATEGORIES && n < minBrands) {
      categories[cat] = { brands: n, fallback: ALL_CATEGORIES, axes: {} };
      continue;
    }
    categories[cat] = {
      brands: n,
      axes: axesFor(`${cat}|any`, n),
      viewports: { desktop: axesFor(`${cat}|desktop`, n), mobile: axesFor(`${cat}|mobile`, n) },
      // Narrow scopes keep their top values only; families stay complete (they carry the conventions).
      pages: Object.fromEntries(pageScopes.map((sc) => [sc, axesFor(`${cat}|${sc}`, n, 8)]).filter(([, axes]) => Object.keys(axes as object).length)),
    };
  }
  return {
    schema: "design-craft/benchmarks@1",
    vocabularyRef: opts.vocabularyRef ?? "",
    minBrands,
    source: { labels, brands: brandCategory.size, ...(from ? { capturedFrom: from.slice(0, 10) } : {}), ...(to ? { capturedTo: to.slice(0, 10) } : {}), ...(opts.season ? { season: opts.season } : {}) },
    categories,
    ...(opts.taxonomy ? { taxonomyRef: `${opts.taxonomy.grouper ?? "families"}:${Object.keys(opts.taxonomy.axes).length} axes` } : {}),
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The benchmark that applies to a category: its own, or its fallback when it is too
 * small. With a viewport, `axes` is that viewport's (when the file has it).
 */
export function benchmarkFor(
  b: Benchmarks,
  category: string | undefined,
  viewport?: "desktop" | "mobile",
): { key: string; benchmark: CategoryBenchmark; axes: Record<string, AxisBenchmark>; viewport?: "desktop" | "mobile" } {
  const cat = category ? normalizeValue(category) : ALL_CATEGORIES;
  const own = b.categories[cat];
  const key = own && !own.fallback ? cat : own?.fallback ?? ALL_CATEGORIES;
  const benchmark = b.categories[key]!;
  const vp = viewport && benchmark.viewports?.[viewport];
  return { key, benchmark, axes: vp ?? benchmark.axes, ...(vp ? { viewport } : {}) };
}

/** Content words of a value name, for telling a variant from a different treatment. */
const words = (k: string) => new Set(k.split("-").filter((t) => t && !["and", "with", "the", "of", "a", "an", "on", "in", "to", "for"].includes(t)));
/** Jaccard overlap of content words: ≥0.5 means a variant of the same treatment, not a different move. */
export function treatmentOverlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / (A.size + B.size - inter || 1);
}

// ── Strokes: the next design move ────────────────────────────────────────────

export interface Stroke {
  axis: string;
  stage: ConversionStage;
  lever: ConversionLever;
  job: string;
  /** The page's current admitted value on this axis, or null when it showed none. */
  from: string | null;
  to: string;
  toGloss?: string;
  /** The decision the stroke moves to (and from), when the taxonomy groups this axis. */
  toFamily?: { key: string; label: string };
  fromFamily?: { key: string; label: string };
  kind: "adopt" | "align";
  score: number;
  evidence: {
    basis: "corpus-prevalence" | "corpus-prevalence+outcomes";
    /** Whether shares were measured on families (decisions) or single values. */
    level: "family" | "value";
    benchmark: string;
    brands: number;
    answering: number;
    share: number;
    currentShare: number;
    examples: string[];
    outcomes?: { offered: number; chosen: number };
  };
  rationale: string;
}

export interface Distinctive {
  axis: string;
  value: string;
  family?: string;
  gloss?: string;
  /** Category share of the value, or 0 for a treatment the vocabulary hasn't admitted. */
  share: number;
  note: string;
}

export interface Strength {
  axis: string;
  value: string;
  family?: string;
  share: number;
  stage: ConversionStage;
}

export interface StrokePlan {
  benchmark: string;
  viewport?: "desktop" | "mobile";
  pageType: PageType;
  strokes: Stroke[];
  strengths: Strength[];
  distinctive: Distinctive[];
  /** Axes the page showed but the benchmark can't speak to (too few brands answered). */
  unbenchmarked: string[];
  /** Motivation-lever conventions held back because the benchmark was captured in a sale season. */
  seasonal: { axis: string; convention: string; brands: number; answering: number; share: number; note: string }[];
  caveats: string[];
}

export interface SuggestOptions {
  /** The page's admitted facets, axis → value | null (e.g. a label's `facets`, or `resolvedObservations`). */
  facets: Record<string, string | null>;
  /** Treatments the page shows that aren't admitted (from `unresolvedProposals`). */
  novel?: { axis: string; value: string; gloss?: string }[];
  category?: string;
  pageType: PageType;
  /** Compare against this viewport's pages only (recommended; pooled when omitted). */
  viewport?: "desktop" | "mobile";
  benchmarks: Benchmarks;
  vocabulary?: Vocabulary;
  /** Resolves a page's value to its family (falls back to the benchmark's family lists). */
  taxonomy?: Taxonomy;
  limit?: number;
  stageWeights?: StageWeights;
  /** Minimum brands answering an axis before its convention counts (default 4). */
  minAnswering?: number;
  /** Minimum share for a value to be a convention (default 0.3). */
  minShare?: number;
}

export const STROKE_CAVEATS = [
  "Ranking uses category prevalence among the corpus's DTC brands, a convention signal, not measured conversion lift. Treat each stroke as a hypothesis to test.",
  "Stage and lever assignments and page-type weights are stated design hypotheses (design-craft CONVERSION_LENS, DEFAULT_STAGE_WEIGHTS).",
  "Distinctive treatments are reported, not penalized: a rare move can be the brand's edge.",
  "Identity axes (type voice, ground tone, photography, motion, brand story) are never suggested as strokes: conforming them to the category would erase the brand.",
];

/** Axes a page type can show: the ontology's page hints plus any page type the corpus observed. */
function axisApplies(axis: string, page: PageType, bench: AxisBenchmark | undefined): boolean {
  const seed = DTC_SEED_AXES.find((s) => s.axis === axis);
  if (seed?.pages.includes(page)) return true;
  return !!bench?.pageTypes.includes(page);
}

/**
 * Rank the next design moves for one page. Deterministic and explainable:
 * score = (convention share − current share) × stage weight × confidence(answering brands),
 * scaled by measured outcomes when the vocabulary has any for the target value.
 */
export function suggestStrokes(o: SuggestOptions): StrokePlan {
  const { key, benchmark: catBench, axes: benchAxes, viewport } = benchmarkFor(o.benchmarks, o.category, o.viewport);
  const pageAxes = viewport ? catBench.pages?.[`${o.pageType}:${viewport}`] : undefined;
  const weights = (o.stageWeights ?? DEFAULT_STAGE_WEIGHTS)[o.pageType];
  const minAnswering = o.minAnswering ?? 4;
  const minShare = o.minShare ?? 0.3;
  const facets = Object.fromEntries(Object.entries(o.facets).map(([a, val]) => [normalizeAxis(a), val ? normalizeValue(val) : null]));
  const novelByAxis = new Map<string, { axis: string; value: string; gloss?: string }[]>();
  for (const n of o.novel ?? []) (novelByAxis.get(n.axis) ?? novelByAxis.set(n.axis, []).get(n.axis)!).push(n);

  const scope = viewport ? `${key} ${viewport}` : key;
  const plan: StrokePlan = { benchmark: key, ...(viewport ? { viewport } : {}), pageType: o.pageType, strokes: [], strengths: [], distinctive: [], unbenchmarked: [], seasonal: [], caveats: [...STROKE_CAVEATS] };
  const season = o.benchmarks.source.season;
  if (season) plan.caveats.push(`The benchmark was captured during ${season} (${o.benchmarks.source.capturedFrom} to ${o.benchmarks.source.capturedTo}), so promotional conventions (motivation lever) are reported under \`seasonal\`, not suggested.`);
  if (!viewport) plan.caveats.push("No viewport given (or the benchmarks lack per-viewport data), so desktop and mobile conventions are pooled.");
  if (key !== normalizeValue(o.category ?? ALL_CATEGORIES)) {
    plan.caveats.push(`"${o.category}" has fewer than ${o.benchmarks.minBrands} brands in the corpus, so the cross-category benchmark ("${key}") was used.`);
  }

  for (const [axis, wide] of Object.entries(benchAxes)) {
    // The narrowest scope with enough brands: this page type on this viewport, else the viewport.
    const narrow = pageAxes?.[axis];
    const bench = narrow && narrow.brands >= minAnswering ? narrow : wide;
    const axisScope = bench === narrow ? `${scope} ${o.pageType}` : scope;
    const role = conversionRole(axis);
    if (!role || !axisApplies(axis, o.pageType, bench)) continue;
    const current = facets[axis] ?? null;
    const shown = axis in facets || novelByAxis.has(axis);
    if (bench.brands < minAnswering) {
      if (shown) plan.unbenchmarked.push(axis);
      continue;
    }

    // Measure on families (decisions) when the taxonomy has them, else on values.
    const units = unitsFor(bench, axis, o.taxonomy);
    const cur = current ? units.of(current) : null;
    const currentShare = cur?.share ?? 0;
    const top = units.list.find((u) => u.key !== "other");
    if (!top) continue;

    if (current && cur && (cur.key === top.key || cur.share >= CONVENTION_SHARE)) {
      plan.strengths.push({ axis, value: current, ...(units.level === "family" ? { family: cur.key } : {}), share: cur.share, stage: role.stage });
      continue;
    }
    if (current && currentShare < 0.15) {
      plan.distinctive.push({ axis, value: current, ...(units.level === "family" && cur ? { family: cur.key } : {}), share: currentShare, note: `${pct(currentShare)} of ${axisScope} brands that answer this axis make this ${units.level === "family" ? "decision" : "choice"}.` });
    }
    for (const n of current ? [] : novelByAxis.get(axis) ?? []) {
      plan.distinctive.push({ axis, value: n.value, ...(n.gloss ? { gloss: n.gloss } : {}), share: 0, note: "Not in the admitted vocabulary yet: no other brands seen doing it often enough to compare." });
    }
    // A page with a novel treatment and no admitted value is doing something, just not a convention.
    if (!current && novelByAxis.has(axis)) continue;
    // Identity axes (type, ground, photography, motion, story) carry the brand. Conforming them
    // to the category is homogenization, not conversion work, so they never become strokes.
    if (role.lever === "identity") continue;

    const gap = top.share - currentShare;
    if (top.share < minShare || top.brands < 3 || gap < 0.2) continue;
    if (season && role.lever === "motivation") {
      plan.seasonal.push({
        axis, convention: units.level === "family" ? top.label : top.target, brands: top.brands, answering: bench.brands, share: top.share,
        note: `During ${season}, ${top.brands} of ${bench.brands} ${axisScope} brands did this. A sale-season convention, not a standing one.`,
      });
      continue;
    }
    // At value level, a variant of the page's own treatment (most content words shared) is not a move.
    if (units.level === "value" && current && treatmentOverlap(current, top.target) >= 0.5) continue;
    const confidence = bench.brands / (bench.brands + 5);
    const reward = o.vocabulary?.axes[axis]?.values[top.target]?.reward;
    const outcome = reward && reward.offered >= 3 ? (2 * (reward.chosen + 1)) / (reward.offered + 2) : 1;
    const score = round(gap * (weights[role.stage] ?? 0.5) * confidence * outcome);
    const gloss = o.vocabulary?.axes[axis]?.values[top.target]?.gloss;
    const what = units.level === "family" ? `the "${top.label}" decision` : `"${top.target}"`;
    plan.strokes.push({
      axis,
      stage: role.stage,
      lever: role.lever,
      job: role.job,
      from: current,
      to: top.target,
      ...(gloss ? { toGloss: gloss } : {}),
      ...(units.level === "family" ? { toFamily: { key: top.key, label: top.label }, ...(cur ? { fromFamily: { key: cur.key, label: cur.label } } : {}) } : {}),
      kind: current ? "align" : "adopt",
      score,
      evidence: {
        basis: outcome === 1 ? "corpus-prevalence" : "corpus-prevalence+outcomes",
        level: units.level,
        benchmark: axisScope,
        brands: top.brands,
        answering: bench.brands,
        share: top.share,
        currentShare,
        examples: top.examples,
        ...(outcome !== 1 && reward ? { outcomes: { offered: reward.offered, chosen: reward.chosen } } : {}),
      },
      rationale: current
        ? `${top.brands} of ${bench.brands} ${axisScope} brands answering "${axis}" make ${what}${units.level === "family" ? ` (most often "${top.target}")` : ""}; this page uses "${current}"${cur && units.level === "family" ? ` (${cur.label}, ${pct(currentShare)})` : ` (${pct(currentShare)})`}.`
        : `${top.brands} of ${bench.brands} ${axisScope} brands answering "${axis}" make ${what}${units.level === "family" ? ` (most often "${top.target}")` : ""}; this page showed no admitted treatment here.`,
    });
  }
  plan.strokes.sort((x, y) => y.score - x.score || x.axis.localeCompare(y.axis));
  plan.strokes = plan.strokes.slice(0, o.limit ?? 8);
  plan.strengths.sort((x, y) => y.share - x.share);
  return plan;
}

/** A share at which a choice counts as one of the category's conventions, even if not the most common. */
export const CONVENTION_SHARE = 0.25;

interface Unit {
  key: string;
  label: string;
  share: number;
  brands: number;
  examples: string[];
  /** The concrete value a stroke targets (a family's most-used value). */
  target: string;
}

function unitsFor(bench: AxisBenchmark, axis: string, taxonomy?: Taxonomy): { level: "family" | "value"; list: Unit[]; of: (value: string) => Unit | null } {
  if (bench.families?.length) {
    const list: Unit[] = bench.families.map((f) => ({ key: f.family, label: f.label, share: f.share, brands: f.brands, examples: f.examples, target: f.values[0]!.value }));
    const familyKey = (value: string) =>
      taxonomy?.axes[axis]?.families.find((f) => f.values.includes(value))?.key ?? bench.families!.find((f) => f.values.some((x) => x.value === value))?.family;
    return {
      level: "family",
      list,
      of: (value) => {
        const k = familyKey(value);
        if (!k) return null;
        const u = list.find((x) => x.key === k);
        // A family no brand in this category uses: known decision, zero share.
        const label = taxonomy?.axes[axis]?.families.find((f) => f.key === k)?.label ?? k;
        return u ?? { key: k, label, share: 0, brands: 0, examples: [], target: value };
      },
    };
  }
  const list: Unit[] = bench.values.map((x) => ({ key: x.value, label: x.value, share: x.share, brands: x.brands, examples: x.examples, target: x.value }));
  return { level: "value", list, of: (value) => list.find((x) => x.key === value) ?? null };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
