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
}));
const input: ProductionMonthInput = { month: "2026-10", count: 12, channel: "instagram", recipes, subjects };

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

  it("validates the month, count, duplicate identities, and weights", () => {
    expect(() => planProductionMonth({ ...input, month: "2026-02", count: 30 })).toThrow(/count/);
    expect(() => planProductionMonth({ ...input, month: "2026-13" })).toThrow();
    expect(() => planProductionMonth({ ...input, recipes: [recipes[0]!, recipes[0]!] })).toThrow(/duplicate recipe/);
    expect(() => planProductionMonth({ ...input, subjects: [subjects[0]!, subjects[0]!] })).toThrow(/duplicate subject/);
    expect(() => planProductionMonth({ ...input, recipes: [{ ...recipes[0]!, weight: Infinity }] })).toThrow();
  });
});
