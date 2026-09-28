import { describe, expect, it } from "vitest";
import { ARCHETYPES, aggregateCriticScores, checkConceptDiversity, selectArms, type CriticScore } from "../src/harness";
import { ARCHETYPE_IDS, OfferConceptSchema } from "../src/schema-v2";
import type { ArchetypeId } from "../src/types";
import { editorialConcept, quizConcept } from "./fixtures-v2";

describe("ARCHETYPES", () => {
  it("covers exactly the six archetypes with a description and a fit", () => {
    expect(Object.keys(ARCHETYPES).sort()).toEqual([...ARCHETYPE_IDS].sort());
    for (const [id, a] of Object.entries(ARCHETYPES)) {
      expect(a.id).toBe(id);
      expect(a.description.length).toBeGreaterThan(20);
      expect(a.fitsWhen.length).toBeGreaterThan(20);
    }
  });
});

describe("OfferConceptSchema", () => {
  it("parses the fixture concepts", () => {
    expect(OfferConceptSchema.safeParse(quizConcept()).success).toBe(true);
    expect(OfferConceptSchema.safeParse(editorialConcept()).success).toBe(true);
  });

  it("rejects unknown block kinds, bad answer keys, and style tokens smuggled in", () => {
    const html = quizConcept();
    (html.steps[0]!.blocks as unknown[]).push({ kind: "html", html: "<script>" });
    expect(OfferConceptSchema.safeParse(html).success).toBe(false);

    const key = quizConcept();
    const ch = key.steps[0]!.blocks.find((b) => b.kind === "choice");
    if (ch?.kind === "choice") ch.answerKey = "Room Type";
    expect(OfferConceptSchema.safeParse(key).success).toBe(false);

    const parsed = OfferConceptSchema.parse({ ...editorialConcept(), style: { bg: "#000" } });
    expect("style" in parsed).toBe(false);
  });
});

describe("checkConceptDiversity", () => {
  const set = (...ids: ArchetypeId[]) => ids.map((archetype) => ({ archetype }));

  it("requires ≥ 3 distinct archetypes in a set of ≥ 4", () => {
    expect(checkConceptDiversity(set("story", "threshold", "early-access", "story")).ok).toBe(true);
    const bad = checkConceptDiversity(set("story", "story", "threshold", "threshold"));
    expect(bad.ok).toBe(false);
    expect(bad.distinct).toBe(2);
    expect(bad.required).toBe(3);
    expect(bad.duplicates.sort()).toEqual(["story", "threshold"]);
    expect(bad.message).toMatch(/only 2 archetypes/);
  });

  it("places no requirement on sets smaller than four", () => {
    expect(checkConceptDiversity(set("story", "story", "story")).ok).toBe(true);
  });
});

describe("aggregateCriticScores", () => {
  const all = (overrides: Partial<Record<CriticScore["critic"], Partial<CriticScore>>> = {}): CriticScore[] =>
    (["conformance", "dark-pattern", "brand", "persona", "incumbent", "novelty"] as const).map((critic) => ({
      critic,
      score: 1,
      pass: true,
      ...overrides[critic],
    }));

  it("weights brand .35, persona .25, incumbent .25, novelty .15", () => {
    const r = aggregateCriticScores(
      all({ brand: { score: 1 }, persona: { score: 0 }, incumbent: { score: 0 }, novelty: { score: 0 } }),
    );
    expect(r.score).toBeCloseTo(0.35, 6);
    expect(r.passing).toBe(true);
    expect(r.weights).toEqual({ brand: 0.35, persona: 0.25, incumbent: 0.25, novelty: 0.15 });
  });

  it("redistributes an n/a incumbent proportionally", () => {
    const r = aggregateCriticScores(all({ incumbent: { na: true, score: 0 }, brand: { score: 1 }, persona: { score: 0 }, novelty: { score: 0 } }));
    expect(r.weights.incumbent).toBeUndefined();
    expect(r.weights.brand).toBeCloseTo(0.35 / 0.75, 6);
    expect(r.score).toBeCloseTo(0.467, 3);
    const missing = aggregateCriticScores(all().filter((c) => c.critic !== "incumbent"));
    expect(missing.score).toBe(1);
    expect(missing.passing).toBe(true);
  });

  it("treats conformance and dark-pattern as hard gates", () => {
    const r = aggregateCriticScores(all({ "dark-pattern": { pass: false, score: 0 } }));
    expect(r.passing).toBe(false);
    expect(r.failedGates).toEqual(["dark-pattern"]);
    expect(r.score).toBe(1); // the score is still reported; it just cannot ship
    expect(aggregateCriticScores(all({ conformance: { pass: false } })).passing).toBe(false);
  });

  it("is never passing when a gate or a weighted critic is missing", () => {
    const noGate = aggregateCriticScores(all().filter((c) => c.critic !== "conformance"));
    expect(noGate.passing).toBe(false);
    expect(noGate.missing).toEqual(["conformance"]);
    const noBrand = aggregateCriticScores(all().filter((c) => c.critic !== "brand"));
    expect(noBrand.passing).toBe(false);
    expect(noBrand.missing).toEqual(["brand"]);
  });

  it("clamps out-of-range scores", () => {
    const r = aggregateCriticScores(all({ brand: { score: 7 }, persona: { score: -2 } }));
    expect(r.score).toBeCloseTo(0.75, 6);
  });
});

describe("selectArms", () => {
  const c = (id: string, archetype: ArchetypeId, score: number, passing = true) => ({ id, archetype, score, passing });

  it("takes the top n passing concepts", () => {
    const picked = selectArms([c("a", "story", 0.9, false), c("b", "threshold", 0.8), c("c", "story", 0.7), c("d", "early-access", 0.6)]);
    expect(picked.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("breaks exact ties toward archetype diversity", () => {
    const picked = selectArms([c("a", "story", 0.8), c("b", "story", 0.7), c("c", "threshold", 0.7)]);
    expect(picked.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("does not trade score for diversity outside a tie", () => {
    const picked = selectArms([c("a", "story", 0.8), c("b", "story", 0.75), c("c", "threshold", 0.7)]);
    expect(picked.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("returns fewer than n when fewer pass, and respects n", () => {
    expect(selectArms([c("a", "story", 0.8), c("b", "story", 0.1, false)])).toHaveLength(1);
    expect(selectArms([c("a", "story", 0.8), c("b", "threshold", 0.7)], 1).map((p) => p.id)).toEqual(["a"]);
  });
});
