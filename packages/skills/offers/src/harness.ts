/**
 * The design harness's pure helpers (spec 34 §3, contract §8). The harness
 * itself — concepts, renders, critics, repair — runs as the platform's
 * `offer_harness` job; what lives here is the part every runtime must agree
 * on: the archetype catalog, the diversity rule, how critic scores combine,
 * and which concepts become arms.
 */

import type { ArchetypeId } from "./types";

export interface ArchetypeInfo {
  id: ArchetypeId;
  label: string;
  /** The structural hook — what makes this archetype different in shape,
   * not in adjective (spec 34 §3.2). */
  description: string;
  fitsWhen: string;
}

export const ARCHETYPES: Record<ArchetypeId, ArchetypeInfo> = {
  "quiet-editorial": {
    id: "quiet-editorial",
    label: "Quiet editorial",
    description: "One step: an image and a single claim, then the email. No incentive — the brand is the reason.",
    fitsWhen: "Premium brands and high AOV, where a discount would cheapen the product.",
  },
  "zero-party-quiz": {
    id: "zero-party-quiz",
    label: "Zero-party quiz",
    description: "A choice (what are you shopping for?), then the email, then a reward personalised to the answer.",
    fitsWhen: "Broad catalogs where one question sorts visitors into meaningfully different product sets.",
  },
  "learn-and-earn": {
    id: "learn-and-earn",
    label: "Learn and earn",
    description: "One factual choice about the product or craft, then the email and a reward for engaging.",
    fitsWhen: "Education-heavy catalogs where knowing the material is part of the purchase.",
  },
  "early-access": {
    id: "early-access",
    label: "Early access",
    description: "Membership framing: first look at drops, launches, or editions in exchange for the email.",
    fitsWhen: "Limited editions, drops, and launches — scarcity that is real because the catalog is.",
  },
  threshold: {
    id: "threshold",
    label: "Threshold",
    description: "Free shipping or a gift over a spend threshold — an incentive that protects margin.",
    fitsWhen: "Margin-sensitive stores and ones whose AOV sits just under a natural threshold.",
  },
  story: {
    id: "story",
    label: "Story",
    description: "The founder or mission in one line, then the email. The relationship is the offer.",
    fitsWhen: "New brands whose story is more distinctive than their catalog yet.",
  },
};

export interface ConceptDiversityResult {
  ok: boolean;
  distinct: number;
  required: number;
  /** Archetypes proposed more than once — the ones to swap out on repair. */
  duplicates: ArchetypeId[];
  message: string;
}

/**
 * Spec 34 §3.2 / contract §8: any concept set of ≥ 4 must span ≥ 3 distinct
 * archetypes, so the harness compares structures, not re-skins. Smaller
 * sets carry no requirement.
 */
export function checkConceptDiversity(concepts: { archetype: ArchetypeId }[]): ConceptDiversityResult {
  const counts = new Map<ArchetypeId, number>();
  for (const c of concepts) counts.set(c.archetype, (counts.get(c.archetype) ?? 0) + 1);
  const distinct = counts.size;
  const required = concepts.length >= 4 ? 3 : 0;
  const duplicates = [...counts].filter(([, n]) => n > 1).map(([a]) => a);
  const ok = distinct >= required;
  return {
    ok,
    distinct,
    required,
    duplicates,
    message: ok
      ? `${concepts.length} concepts across ${distinct} archetypes.`
      : `${concepts.length} concepts span only ${distinct} archetypes; a set of 4 or more needs at least ${required}. ` +
        `Replace a duplicate (${duplicates.join(", ")}) with a different structure.`,
  };
}

export type CriticId = "conformance" | "dark-pattern" | "brand" | "persona" | "incumbent" | "novelty";

export interface CriticScore {
  critic: CriticId;
  /** 0–1. */
  score: number;
  pass: boolean;
  notes?: string;
  /** Not applicable — only meaningful for `incumbent` (no incumbent found). */
  na?: boolean;
}

/** Hard gates: a fail on either means not passing, whatever the score. */
export const HARD_GATE_CRITICS: readonly CriticId[] = ["conformance", "dark-pattern"];
/** Weighted critics (contract §8). An n/a incumbent's weight is
 * redistributed proportionally over the other three. */
export const CRITIC_WEIGHTS: Readonly<Record<"brand" | "persona" | "incumbent" | "novelty", number>> = {
  brand: 0.35,
  persona: 0.25,
  incumbent: 0.25,
  novelty: 0.15,
};

export interface AggregateCriticResult {
  /** Weighted 0–1. */
  score: number;
  passing: boolean;
  /** The weights actually applied (after any n/a redistribution). */
  weights: Partial<Record<CriticId, number>>;
  failedGates: CriticId[];
  /** Required critics with no score — a concept is never passing unjudged. */
  missing: CriticId[];
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function aggregateCriticScores(critics: CriticScore[]): AggregateCriticResult {
  const byId = new Map<CriticId, CriticScore>();
  for (const c of critics) byId.set(c.critic, c);

  const failedGates = HARD_GATE_CRITICS.filter((id) => byId.get(id)?.pass === false);
  const missing: CriticId[] = HARD_GATE_CRITICS.filter((id) => !byId.has(id));

  const incumbent = byId.get("incumbent");
  const incumbentNa = !incumbent || incumbent.na === true;
  const active = (Object.keys(CRITIC_WEIGHTS) as (keyof typeof CRITIC_WEIGHTS)[]).filter(
    (id) => !(id === "incumbent" && incumbentNa),
  );
  const totalWeight = active.reduce((t, id) => t + CRITIC_WEIGHTS[id], 0);

  const weights: AggregateCriticResult["weights"] = {};
  let score = 0;
  for (const id of active) {
    const w = CRITIC_WEIGHTS[id] / totalWeight;
    weights[id] = w;
    const c = byId.get(id);
    if (!c) missing.push(id);
    score += w * clamp01(c?.score ?? 0);
  }

  return {
    score: Math.round(score * 1000) / 1000,
    passing: failedGates.length === 0 && missing.length === 0,
    weights,
    failedGates,
    missing,
  };
}

export interface ScoredConcept {
  archetype: ArchetypeId;
  score: number;
  passing: boolean;
}

/**
 * The top `n` passing concepts become arms v1..vn (spec 34 §3.5). On an exact
 * score tie the candidate whose archetype is not yet selected wins, so two
 * equally-good concepts of the same structure do not crowd out a different
 * one. Input order breaks any remaining tie (stable).
 */
export function selectArms<T extends ScoredConcept>(scored: T[], n = 2, opts: { tieEpsilon?: number } = {}): T[] {
  const eps = opts.tieEpsilon ?? 1e-9;
  const pool = scored.filter((c) => c.passing);
  const picked: T[] = [];
  while (picked.length < n && pool.length > 0) {
    const best = Math.max(...pool.map((c) => c.score));
    const tied = pool.filter((c) => best - c.score <= eps);
    const used = new Set(picked.map((c) => c.archetype));
    const choice = tied.find((c) => !used.has(c.archetype)) ?? tied[0]!;
    picked.push(choice);
    pool.splice(pool.indexOf(choice), 1);
  }
  return picked;
}
