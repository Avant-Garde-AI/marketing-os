import { describe, expect, it } from "vitest";
import { planProductionMonth, type ProductionMonthInput, type ProductionSubject } from "../src/production-recipes";

const recipes: ProductionMonthInput["recipes"] = [
  { id: "loop", mechanic: "artwork-loop", weight: 2, conceptId: "artwork-motion", requiredDistinctSubjects: 1, outputKind: "video" },
  { id: "home", mechanic: "collection-scene", scene: "real-home", weight: 1, conceptId: "lived-with-art", requiredDistinctSubjects: 3, outputKind: "image" },
  { id: "world", mechanic: "collection-scene", scene: "imagined-world", weight: 1, conceptId: "imagined-room", requiredDistinctSubjects: 3, outputKind: "image" },
];
const subjects: ProductionSubject[] = ["a", "b", "c", "d"].map((handle) => ({
  handle, artist: `Artist ${handle}`, sourceRefs: [`catalog:${handle}`],
  asset: { kind: "full-master", ref: `asset:${handle}`, verificationRef: `check:${handle}` },
  facts: [{ text: `Artwork ${handle} is by Artist ${handle}`, sourceRefs: [`graph:${handle}`] }],
  groupingKeys: ["palette:blue"],
}));
const input: ProductionMonthInput = { month: "2026-10", count: 12, channel: "instagram", recipes, subjects };
const carousel: NonNullable<ProductionMonthInput["recipes"][number]["carousel"]> = {
  composition: "one-hero-per-slide" as const,
  continuity: ["Keep the complete art and a coherent warm palette."],
  slides: [
    { role: "setup" as const, environment: "Courtyard", placement: "Inside an arch", visualConnection: "Leaf shadows echo the art." },
    { role: "turn" as const, environment: "Rooftop", placement: "On a freestanding screen", visualConnection: "The shapes echo the skyline." },
    { role: "payoff" as const, environment: "Desert oasis", placement: "Suspended from a stone pavilion", visualConnection: "The palette meets the landscape." },
  ],
};

describe("planProductionMonth", () => {
  it("balances 6/3/3 and supplies exact, stable dates and source-bound briefs", () => {
    const plan = planProductionMonth(input);
    expect(plan.summary).toEqual({ planned: 12, blocked: 0, recipeCounts: { loop: 6, home: 3, world: 3 } });
    expect(new Set(plan.slots.map((slot) => slot.date)).size).toBe(12);
    expect(plan.slots.every((slot) => slot.date.startsWith("2026-10-") && !Object.hasOwn(slot, "scheduledAt"))).toBe(true);
    expect(plan.slots[0]?.id).toBe(`2026-10-instagram-${plan.slots[0]?.date.slice(-2)}`);
    expect(plan.slots[0]?.brief?.subjects[0]).toMatchObject({ masterRef: expect.any(String), masterVerificationRef: expect.any(String), sourceRefs: [expect.any(String)] });
    expect(plan.slots[0]?.brief?.copyFacts[0]?.sourceRefs).toEqual([expect.any(String)]);
    expect(plan.slots.some((slot) => slot.reuseWarnings.length > 0)).toBe(true);
  });

  it("repeats exactly for identical input, including anchored dates", () => {
    const anchored = { ...input, existingSlots: [{ date: "2026-10-31", recipeId: "home" }] };
    expect(planProductionMonth(anchored)).toEqual(planProductionMonth(anchored));
    expect(planProductionMonth(anchored).slots.at(-1)).toMatchObject({ date: "2026-10-31", recipeId: "home" });
  });

  it("blocks imagery when masters are missing while preserving copy evidence", () => {
    const noMaster = { ...subjects[0]!, asset: undefined };
    const plan = planProductionMonth({ ...input, count: 1, recipes: [recipes[0]!], subjects: [noMaster] });
    expect(plan.slots[0]).toMatchObject({ status: "blocked", subjectHandles: ["a"] });
    expect(plan.slots[0]?.blockedReasons.join(" ")).toMatch(/full-master/);
    expect(plan.slots[0]?.brief?.copyFacts).toHaveLength(1);
  });

  it("does not treat an animation frame as a verified full master", () => {
    const frame = { ...subjects[0]!, asset: { kind: "frame" as const, ref: "frame:a", verificationRef: "check:a" } };
    expect(planProductionMonth({ ...input, count: 1, recipes: [recipes[0]!], subjects: [frame] }).slots[0]?.status).toBe("blocked");
  });

  it("needs three distinct works for collection scenes", () => {
    const plan = planProductionMonth({ ...input, count: 1, recipes: [recipes[1]!], subjects: subjects.slice(0, 2) });
    expect(plan.slots[0]?.status).toBe("blocked");
    expect(plan.slots[0]?.subjectHandles).toEqual(["a", "b"]);
    expect(plan.slots[0]?.blockedReasons.join(" ")).toMatch(/3 distinct subjects/);
  });

  it("selects a later coherent triple instead of the first unrelated masters", () => {
    const candidates = ["a", "b", "c", "d", "e", "f"].map((handle, i) => ({
      ...subjects[0]!, handle, groupingKeys: [i < 3 ? `palette:unrelated-${handle}` : "palette:green"],
    }));
    const plan = planProductionMonth({ ...input, count: 1, recipes: [recipes[1]!], subjects: candidates });
    expect(plan.slots[0]).toMatchObject({ status: "planned", subjectHandles: ["d", "e", "f"] });
  });

  it("rotates between coherent cohorts by reuse and remains deterministic", () => {
    const candidates = ["a", "b", "c", "d", "e", "f"].map((handle, i) => ({
      ...subjects[0]!, handle, groupingKeys: [i < 3 ? "palette:red" : "palette:blue"],
    }));
    const request = { ...input, count: 2, recipes: [recipes[1]!], subjects: candidates };
    const plan = planProductionMonth(request);
    expect(plan.slots.map(slot => slot.subjectHandles)).toEqual([["d", "e", "f"], ["a", "b", "c"]]);
    expect(planProductionMonth(request)).toEqual(plan);
  });

  it("blocks an incoherent collection while retaining subjects and copy facts", () => {
    const candidates = ["a", "b", "c"].map((handle) => ({
      ...subjects[0]!, handle, groupingKeys: [`palette:${handle}`],
    }));
    const slot = planProductionMonth({ ...input, count: 1, recipes: [recipes[1]!], subjects: candidates }).slots[0]!;
    expect(slot.status).toBe("blocked");
    expect(slot.blockedReasons.join(" ")).toMatch(/No shared evidence grouping key/);
    expect(slot.subjectHandles).toEqual(["a", "b", "c"]);
    expect(slot.brief?.copyFacts).toHaveLength(3);
  });

  it("validates the month, count, duplicate identities, and weights", () => {
    expect(() => planProductionMonth({ ...input, month: "2026-02", count: 30 })).toThrow(/count/);
    expect(() => planProductionMonth({ ...input, month: "2026-13" })).toThrow();
    expect(() => planProductionMonth({ ...input, recipes: [recipes[0]!, recipes[0]!] })).toThrow(/duplicate recipe/);
    expect(() => planProductionMonth({ ...input, subjects: [subjects[0]!, subjects[0]!] })).toThrow(/duplicate subject/);
    expect(() => planProductionMonth({ ...input, recipes: [{ ...recipes[0]!, weight: Infinity }] })).toThrow();
  });

  it("selects evidence-matched works before reuse ranking or a generic shared palette", () => {
    const recipe = { ...recipes[2]!, outputKind: "carousel", carousel,
      selection: { theme: "Tropical worlds", requirements: [{ anyOf: ["collection:tropical"] }] } };
    const candidates = ["a", "b", "c", "d", "e", "f"].map((handle, i) => ({
      ...subjects[0]!, handle,
      ...(i >= 3 ? { selectionEvidence: [{ key: "collection:tropical", sourceRefs: [`catalog:membership:${handle}`] }] } : {}),
    }));
    const slot = planProductionMonth({ ...input, count: 1, recipes: [recipe], subjects: candidates }).slots[0]!;
    expect(slot).toMatchObject({ status: "planned", subjectHandles: ["d", "e", "f"] });
    expect(slot.brief?.carousel?.slides.map(s => s.subjectHandles)).toEqual([["d"], ["e"], ["f"]]);
    expect(slot.brief?.subjects[0]?.selectionEvidence).toEqual([{ key: "collection:tropical", sourceRefs: ["catalog:membership:d"] }]);
  });

  it("blocks a themed shortfall without substituting the convenient existing trio", () => {
    const recipe = { ...recipes[2]!, outputKind: "carousel", carousel,
      selection: { theme: "Space collage", requirements: [{ anyOf: ["subject:space", "subject:cosmos"] }, { anyOf: ["medium:digital-collage"] }] } };
    const candidates = subjects.map((s, i) => ({ ...s, selectionEvidence: [
      { key: "subject:space", sourceRefs: ["inspection:space"] },
      ...(i === 0 ? [{ key: "medium:digital-collage", sourceRefs: ["catalog:medium"] }] : []),
    ] }));
    const slot = planProductionMonth({ ...input, count: 1, recipes: [recipe], subjects: candidates }).slots[0]!;
    expect(slot.status).toBe("blocked");
    expect(slot.subjectHandles).toEqual(["a"]);
    expect(slot.blockedReasons.join(" ")).toMatch(/Do not substitute unrelated/);
    expect(slot.brief?.carousel?.slides.map(s => s.subjectHandles)).toEqual([["a"], [], []]);
  });

  it("does not accept a bare grouping key as thematic evidence", () => {
    const slot = planProductionMonth({ ...input, count: 1, recipes: [{ ...recipes[2]!,
      selection: { theme: "Space", requirements: [{ anyOf: ["palette:blue"] }] },
    }] }).slots[0]!;
    expect(slot.status).toBe("blocked");
    expect(slot.subjectHandles).toEqual([]);
  });

  it("refuses missing carousel beats and duplicate environment or placement directions", () => {
    expect(planProductionMonth({ ...input, count: 1, recipes: [{ ...recipes[2]!, outputKind: "carousel" }] }).slots[0]?.blockedReasons.join(" ")).toMatch(/single scene is not a carousel/);
    for (const field of ["environment", "placement"] as const) {
      const repeated = { ...carousel, slides: carousel.slides.map(s => ({ ...s, [field]: "Same" })) as typeof carousel.slides };
      expect(() => planProductionMonth({ ...input, recipes: [{ ...recipes[2]!, outputKind: "carousel", carousel: repeated }] })).toThrow(/distinct/);
    }
  });

  it("supports collection-per-slide without silently changing ordered identities", () => {
    const slot = planProductionMonth({ ...input, count: 1, recipes: [{ ...recipes[2]!, outputKind: "carousel", carousel: { ...carousel, composition: "collection-per-slide" } }] }).slots[0]!;
    expect(slot.brief?.carousel?.slides.map(s => s.subjectHandles)).toEqual([["a", "b", "c"], ["a", "b", "c"], ["a", "b", "c"]]);
  });
});
