import { describe, expect, it } from "vitest";
import { generationPlanCreativeHash, generationPlanSchema } from "../src/generation-plan";

const sha = "a".repeat(64);
const source = {
  sourceRef: "ams://work/1/flat", verificationRef: "catalog://work/1",
  sourceSha256: sha, sourcePath: `social/production/sources/${sha}.jpeg.b64`,
  width: 1400, height: 1800,
};
const plan = {
  id: "pilot-loop-1", postId: "post-1", slotId: "2026-10-instagram-01", recipeId: "loop",
  mechanic: "artwork-loop" as const, sources: [source],
  prompt: "Animate visible paint movement and preserve the complete artwork.",
  caption: "A quiet study in blue.",
  transform: { kind: "contain-pad" as const, width: 1080 as const, height: 1920 as const, background: "#000000" },
};

describe("generation pilot plan", () => {
  it("requires content-addressed sources and explicit non-cropping fit", () => {
    expect(generationPlanSchema.parse(plan)).toEqual(plan);
    expect(() => generationPlanSchema.parse({ ...plan, sources: [{ ...source, sourcePath: "social/production/sources/work.jpeg.b64" }] })).toThrow(/content-addressed/);
    expect(() => generationPlanSchema.parse({ ...plan, transform: { ...plan.transform, kind: "crop" } })).toThrow();
    expect(() => generationPlanSchema.parse({ ...plan, sources: [{ ...source, width: 0 }] })).toThrow();
  });

  it("binds prompt, caption and fitting treatment to creative hash", () => {
    const original = generationPlanCreativeHash(plan);
    expect(generationPlanCreativeHash({ ...plan, caption: "A different caption." })).not.toBe(original);
    expect(generationPlanCreativeHash({ ...plan, prompt: "A different motion." })).not.toBe(original);
    expect(generationPlanCreativeHash({ ...plan, transform: { ...plan.transform, background: "#ffffff" } })).not.toBe(original);
  });

  it("requires three distinct sources and declared scene for collection recipe", () => {
    expect(() => generationPlanSchema.parse({ ...plan, mechanic: "collection-scene", scene: "real-home" })).toThrow(/three sources/);
    const sources = ["a", "b", "c"].map((letter) => ({ ...source, sourceRef: `ams://work/${letter}` }));
    expect(generationPlanSchema.parse({ ...plan, mechanic: "collection-scene", scene: "imagined-world", sources }).sources).toHaveLength(3);
    expect(() => generationPlanSchema.parse({ ...plan, mechanic: "collection-scene", scene: "real-home", sources: [source, source, source] })).toThrow(/distinct/);
  });
});
