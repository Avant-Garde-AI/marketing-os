/**
 * The DTC design-craft vocabulary: earned, guided, and gated (spec 35 §3.1).
 *
 * A set of named AXES along which storefronts differ (`pdp-gallery-behavior`,
 * `offer-framing`, …), each with the VALUES observed for it. It is used at two
 * strengths, which is the whole "guided but emergent" idea:
 *
 *   HARD  `validateFacets()` coerces a labeler's classification against the
 *         admitted values in code. Unknown → null, never trusted.
 *   SOFT  `softPrior()` renders the same vocabulary into the prompt as a bias
 *         ("draw from: …"), which steers the open register without closing it.
 *
 * ADMISSION. Ported from the Arthaus portfolios harness, where it was proven on
 * artist sites. The SUBJECT here is a brand (a store domain), not an artist:
 *
 *   - `earned` observations (human-confirmed labels) are admitted on sight.
 *   - `proposed` observations (model labels) stay pending until the value recurs
 *     across `admissionThreshold` DISTINCT brands.
 *   - An AXIS is recognized once `axisThreshold` distinct brands reach for the
 *     same dimension, whatever value they express it with. Values are a long
 *     tail and axes recur hard; a value-only gate never fires.
 *
 * Support counts distinct brands, never mentions or pages. Otherwise one store
 * with forty labeled pages could promote its own quirk into the vocabulary.
 *
 * Everything here is a pure function over a `Vocabulary` object. Persistence is
 * the caller's (the CLI keeps it as tracked JSON, a compounding asset).
 */
import { z } from "zod";

export const DEFAULT_ADMISSION_THRESHOLD = 3;
export const DEFAULT_AXIS_THRESHOLD = 3;

// ── Store shape ──────────────────────────────────────────────────────────────

export const rewardSchema = z.object({
  /** Times a decision model offered this value as a stroke. */
  offered: z.number().int().nonnegative().default(0),
  /** Times the offered stroke was chosen (approved). */
  chosen: z.number().int().nonnegative().default(0),
});
export type Reward = z.infer<typeof rewardSchema>;

export const valueEntrySchema = z.object({
  label: z.string(),
  /** Contrastive description: what distinguishes this value from its siblings. */
  gloss: z.string().optional(),
  /** Distinct brands (store domains) observed using this value. */
  support: z.array(z.string()).default([]),
  admitted: z.boolean().default(false),
  origin: z.enum(["earned", "proposed"]),
  /** Near-duplicate keys folded into this value. Kept so a reviewer can undo the merge. */
  aliases: z.array(z.string()).optional(),
  reward: rewardSchema.optional(),
});
export type ValueEntry = z.infer<typeof valueEntrySchema>;

export const axisEntrySchema = z.object({
  /** `seeded` = from the ontology prompts, `emergent` = proposed by a labeler. */
  origin: z.enum(["seeded", "emergent"]).default("emergent"),
  description: z.string().optional(),
  /** Distinct brands that named this dimension, across all its values. */
  axisSupport: z.array(z.string()).default([]),
  recognized: z.boolean().default(false),
  values: z.record(z.string(), valueEntrySchema).default({}),
});
export type AxisEntry = z.infer<typeof axisEntrySchema>;

export const vocabularySchema = z.object({
  _note: z.string().optional(),
  version: z.literal(1).default(1),
  domain: z.string().default("dtc-storefront"),
  admissionThreshold: z.number().int().positive().default(DEFAULT_ADMISSION_THRESHOLD),
  axisThreshold: z.number().int().positive().default(DEFAULT_AXIS_THRESHOLD),
  axes: z.record(z.string(), axisEntrySchema).default({}),
});
export type Vocabulary = z.infer<typeof vocabularySchema>;

export function emptyVocabulary(opts: Partial<Pick<Vocabulary, "admissionThreshold" | "axisThreshold" | "domain">> = {}): Vocabulary {
  return vocabularySchema.parse({
    _note:
      "The DTC design-craft vocabulary (spec 35). Human-confirmed values are admitted on sight; " +
      "model-proposed values stay pending until they recur across `admissionThreshold` distinct brands. " +
      "Tracked in git: this is a compounding asset, not run output.",
    ...opts,
  });
}

// ── Normalization + specificity floor ────────────────────────────────────────

/** Normalize a value to its comparison key. */
export const normalizeValue = (s: unknown): string =>
  String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Normalize an AXIS name, splitting camelCase first, so `pdpGalleryBehavior`
 * and "PDP gallery behavior" land on the same bucket. In Arthaus, missing this
 * produced 45 "distinct" axes with zero recurrences across 10 artists.
 */
export const normalizeAxis = (s: unknown): string =>
  normalizeValue(String(s ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

/**
 * Degenerate single-word labels are the classic failure of an open extraction
 * layer: they cluster into mush and describe nothing. The prompt names this
 * failure. This list is the guardrail for when the prompt is ignored.
 */
const STOPLIST = new Set([
  "color", "colour", "texture", "layout", "grid", "motion", "animation", "style",
  "design", "aesthetic", "mood", "feel", "look", "vibe", "theme", "clean", "modern",
  "minimal", "simple", "elegant", "beautiful", "nice", "good", "light", "dark",
  "typography", "spacing", "shadow", "gradient", "image", "photo", "element", "component",
  "premium", "luxury", "bold", "standard", "default", "normal", "basic", "section",
  "page", "store", "shop", "product", "button",
]);

/** Why a proposed value is too degenerate to enter even the pending pool, or null. */
export function rejectReason(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return "empty";
  const key = normalizeValue(raw);
  if (!key) return "empty after normalization";
  if (STOPLIST.has(key)) return `generic single term ("${key}")`;
  const words = key.split("-").filter(Boolean);
  if (words.length < 2) return `single word ("${key}"): values must be compound, e.g. "sticky-thumb-rail"`;
  if (words.length > 6) return `too long (${words.length} words): values name a treatment, not a sentence`;
  if (words.every((w) => STOPLIST.has(w))) return `composed only of generic terms ("${key}")`;
  return null;
}

/**
 * Near-duplicate detection by token overlap (Jaccard over tokens longer than 2
 * chars). Without it the recurrence gate never fires: models name the same
 * treatment two ways (`hairline-pinned-flat` / `flat-artboard-hairline`).
 * Embed-and-match on value+gloss is the principled upgrade once the corpus
 * justifies the cost (spec 35, post-MVP).
 */
export function findNearDuplicate(axis: AxisEntry, key: string, threshold = 0.5): string | null {
  const toks = (k: string) => new Set(k.split("-").filter((t) => t.length > 2));
  const a = toks(key);
  if (a.size < 2) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const existing of Object.keys(axis.values)) {
    if (existing === key) return existing;
    const b = toks(existing);
    const inter = [...a].filter((t) => b.has(t)).length;
    const union = new Set([...a, ...b]).size;
    const score = union ? inter / union : 0;
    if (score > bestScore) {
      bestScore = score;
      best = existing;
    }
  }
  return bestScore >= threshold ? best : null;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export const admittedValues = (v: Vocabulary, axis: string): string[] =>
  Object.entries(v.axes[axis]?.values ?? {})
    .filter(([, e]) => e.admitted)
    .map(([k]) => k);

/** Axes with at least one admitted value: the HARD register. */
export const admittedAxes = (v: Vocabulary): string[] =>
  Object.keys(v.axes).filter((a) => admittedValues(v, a).length > 0).sort();

export function isRecognized(v: Vocabulary, axis: string): boolean {
  const ax = v.axes[axis];
  if (!ax) return false;
  return admittedValues(v, axis).length > 0 || ax.axisSupport.length >= v.axisThreshold;
}

/**
 * Dimensions enough brands reached for that have no admitted value yet, ranked
 * by brand support. This is the worklist for human confirmation.
 */
export function recognizedEmergentAxes(v: Vocabulary) {
  return Object.keys(v.axes)
    .filter((a) => isRecognized(v, a) && admittedValues(v, a).length === 0)
    .map((a) => ({
      axis: a,
      brands: v.axes[a]!.axisSupport.length,
      distinctValues: Object.keys(v.axes[a]!.values).length,
    }))
    .sort((x, y) => y.brands - x.brands || y.distinctValues - x.distinctValues);
}

// ── Observe: the admission gate ──────────────────────────────────────────────

export interface Observation {
  axis: string;
  value: string;
  /** The subject. A store domain, normalized by the caller (see `brandKey`). */
  brand: string;
  origin?: "earned" | "proposed";
  gloss?: string | null;
}

export type ObserveStatus = "admitted" | "promoted" | "pending" | "rejected";

export interface ObserveResult {
  status: ObserveStatus;
  axis: string;
  key: string;
  support: number;
  axisSupport: number;
  /** True on exactly the observation that crosses the axis threshold. */
  axisRecognized?: true;
  /** Set when the value was folded into a near-duplicate. */
  mergedFrom?: string;
  reason?: string;
}

/** Canonical brand key from a URL or domain: `https://www.Example.com/x` → `example.com`. */
export function brandKey(urlOrDomain: string): string {
  let host = urlOrDomain.trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname;
  } catch {
    /* fall through with the raw string */
  }
  return host.replace(/^www\./, "").replace(/\/.*$/, "");
}

/**
 * Record one observation. Mutates `v` in place and returns what happened.
 * Callers that run concurrently must serialize calls (see `debrand`).
 */
export function observe(v: Vocabulary, obs: Observation): ObserveResult {
  const origin = obs.origin ?? "proposed";
  const key = normalizeValue(obs.value);
  const axisKey = normalizeAxis(obs.axis);

  if (!axisKey) {
    return { status: "rejected", axis: axisKey, key, support: 0, axisSupport: 0, reason: "empty axis" };
  }
  if (origin === "proposed") {
    const reason = rejectReason(obs.value);
    if (reason) return { status: "rejected", axis: axisKey, key, support: 0, axisSupport: v.axes[axisKey]?.axisSupport.length ?? 0, reason };
  }

  const ax = (v.axes[axisKey] ??= axisEntrySchema.parse({}));
  if (obs.brand && !ax.axisSupport.includes(obs.brand)) ax.axisSupport.push(obs.brand);
  const axisWasRecognized = ax.recognized;

  let canonical = key;
  if (!ax.values[key]) {
    const dup = findNearDuplicate(ax, key);
    if (dup) {
      canonical = dup;
      const target = ax.values[dup]!;
      target.aliases ??= [];
      if (!target.aliases.includes(key)) target.aliases.push(key);
    }
  }
  const entry = (ax.values[canonical] ??= valueEntrySchema.parse({
    label: String(obs.value).trim(),
    origin,
  }));
  if (obs.gloss && !entry.gloss) entry.gloss = String(obs.gloss).trim();

  const wasAdmitted = entry.admitted;
  if (obs.brand && !entry.support.includes(obs.brand)) entry.support.push(obs.brand);

  if (origin === "earned") {
    entry.admitted = true;
    entry.origin = "earned";
  } else if (!entry.admitted && entry.support.length >= v.admissionThreshold) {
    entry.admitted = true;
  }

  ax.recognized = admittedValues(v, axisKey).length > 0 || ax.axisSupport.length >= v.axisThreshold;

  return {
    status: entry.admitted ? (wasAdmitted ? "admitted" : "promoted") : "pending",
    axis: axisKey,
    key: canonical,
    support: entry.support.length,
    axisSupport: ax.axisSupport.length,
    ...(ax.recognized && !axisWasRecognized ? { axisRecognized: true as const } : {}),
    ...(canonical !== key ? { mergedFrom: key } : {}),
  };
}

// ── HARD register ────────────────────────────────────────────────────────────

export interface FacetValidation {
  values: Record<string, string | null>;
  rejected: { axis: string; value: string }[];
}

/**
 * Coerce a labeler's facet classification against the admitted vocabulary.
 * Unknown values become null and are recorded, never trusted. Axes the labeler
 * answered on that have no admitted values yet are included, so a rejection is
 * recorded rather than silently dropped.
 */
export function validateFacets(raw: Record<string, unknown> | null | undefined, v: Vocabulary): FacetValidation {
  const values: Record<string, string | null> = {};
  const rejected: FacetValidation["rejected"] = [];
  const byNorm = new Map(Object.keys(raw ?? {}).map((k) => [normalizeAxis(k), k]));
  const axes = new Set([...admittedAxes(v), ...byNorm.keys()]);
  for (const axis of axes) {
    const proposed = raw?.[byNorm.get(axis) ?? axis];
    if (proposed == null || proposed === "") {
      values[axis] = null;
      continue;
    }
    const key = normalizeValue(proposed);
    // Accept an alias of an admitted value: the merge already decided they are one treatment.
    const admitted = admittedValues(v, axis);
    const resolved = admitted.includes(key)
      ? key
      : admitted.find((a) => v.axes[axis]!.values[a]!.aliases?.includes(key));
    if (resolved) values[axis] = resolved;
    else {
      values[axis] = null;
      rejected.push({ axis, value: String(proposed) });
    }
  }
  return { values, rejected };
}

// ── SOFT register ────────────────────────────────────────────────────────────

export interface AxisPrompt {
  axis: string;
  description: string;
}

/**
 * The vocabulary rendered as a prompt-time bias. Phrased as "draw from", not
 * "use only": this half must stay open, or the open register can never propose
 * the axis that becomes next season's enum.
 *
 * `seedAxes` are the ontology's dimension prompts (no values). They are shown
 * as open questions until the corpus earns values for them.
 */
export function softPrior(v: Vocabulary, opts: { maxValues?: number; seedAxes?: AxisPrompt[] } = {}): string {
  const maxValues = opts.maxValues ?? 12;
  const known: string[] = [];
  for (const a of admittedAxes(v)) {
    known.push(`  ${a}:`);
    for (const val of admittedValues(v, a).slice(0, maxValues)) {
      const e = v.axes[a]!.values[val]!;
      const r = e.reward;
      const won = r && r.offered >= 3 ? ` [chosen ${r.chosen}/${r.offered} times when offered]` : "";
      known.push(`    - "${val}"${e.gloss ? `: ${e.gloss}` : ""}${won}`);
    }
  }

  const emergent = recognizedEmergentAxes(v).slice(0, 12).map(({ axis, brands }) => {
    const ex = Object.keys(v.axes[axis]!.values).slice(0, 3);
    return `  ${axis}: ${brands} brands treat this; e.g. ${ex.map((e) => `"${e}"`).join(", ")}`;
  });

  const covered = new Set([...admittedAxes(v), ...recognizedEmergentAxes(v).map((e) => e.axis)]);
  const seeds = (opts.seedAxes ?? [])
    .filter((s) => !covered.has(normalizeAxis(s.axis)))
    .map((s) => `  ${normalizeAxis(s.axis)}: ${s.description}`);

  const out: string[] = [];
  if (known.length) {
    out.push(
      "KNOWN DESIGN AXES: values earned from storefronts already labeled and confirmed.",
      "Use one in `facets` ONLY when it genuinely describes the page.",
      "",
      ...known,
      "",
    );
  }
  out.push(
    "CHOOSING HONESTLY MATTERS MORE THAN FILLING THE FIELD:",
    "- If no listed value fits an axis, set it to null. A null is informative; a forced pick corrupts the corpus.",
    "- When you null an axis because the page does something else, name that something in `proposals`.",
  );
  if (emergent.length) {
    out.push("", "RECURRING DIMENSIONS other brands reached for (no fixed values yet; prompts, not menus):", ...emergent);
  }
  if (seeds.length) {
    out.push("", "DIMENSIONS WORTH CHECKING (describe what THIS page does via `proposals`, if it does anything notable):", ...seeds);
  }
  return out.join("\n");
}

// ── Reports ──────────────────────────────────────────────────────────────────

export interface VocabularyStats {
  axes: number;
  recognizedAxes: number;
  admittedAxes: number;
  admittedValues: number;
  pendingValues: number;
  brands: number;
}

export function vocabularyStats(v: Vocabulary): VocabularyStats {
  let admitted = 0;
  let pending = 0;
  const brands = new Set<string>();
  for (const [name, ax] of Object.entries(v.axes)) {
    ax.axisSupport.forEach((b) => brands.add(b));
    for (const e of Object.values(ax.values)) e.admitted ? admitted++ : pending++;
    void name;
  }
  return {
    axes: Object.keys(v.axes).length,
    recognizedAxes: Object.keys(v.axes).filter((a) => isRecognized(v, a)).length,
    admittedAxes: admittedAxes(v).length,
    admittedValues: admitted,
    pendingValues: pending,
    brands: brands.size,
  };
}
