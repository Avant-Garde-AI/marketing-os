import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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
    const sources = ["a", "b", "c"].map((letter) => ({ ...source, sourceRef: `ams://work/${letter}`,
      verificationRef: `catalog://work/${letter}`, sourceSha256: letter.repeat(64),
      sourcePath: `social/production/sources/${letter.repeat(64)}.jpeg.b64` }));
    const scenePlan = { ...plan, mechanic: "collection-scene", scene: "imagined-world", sources,
      transform: { ...plan.transform, height: 1350 } };
    expect(generationPlanSchema.parse(scenePlan).sources).toHaveLength(3);
    expect(() => generationPlanSchema.parse({ ...scenePlan, transform: plan.transform })).toThrow(/height must match/);
    expect(() => generationPlanSchema.parse({ ...plan, transform: scenePlan.transform })).toThrow(/height must match/);
    expect(() => generationPlanSchema.parse({ ...scenePlan, sources: [sources[0], sources[0], sources[2]] })).toThrow(/distinct/);
    expect(() => generationPlanSchema.parse({ ...scenePlan, sources: [sources[0], { ...sources[1], sourceSha256: sources[0].sourceSha256,
      sourcePath: sources[0].sourcePath }, sources[2]] })).toThrow(/source hashes must be distinct/);
    expect(() => generationPlanSchema.parse({ ...scenePlan, sources: [sources[0], { ...sources[1], verificationRef: sources[0].verificationRef }, sources[2]] })).toThrow(/verification receipts must be distinct/);
  });

  it("requires an explicit single-artwork scene and preserves legacy creative hashes", () => {
    const legacy = { ...plan, mechanic: "collection-scene" as const, scene: "real-home" as const,
      sources: ["a", "b", "c"].map((letter) => ({ ...source, sourceRef: `ams://work/${letter}`,
        verificationRef: `catalog://work/${letter}`, sourceSha256: letter.repeat(64),
        sourcePath: `social/production/sources/${letter.repeat(64)}.jpeg.b64` })),
      transform: { ...plan.transform, height: 1350 as const } };
    const oldHash = createHash("sha256").update(JSON.stringify({ mechanic: legacy.mechanic, scene: legacy.scene,
      prompt: legacy.prompt, caption: legacy.caption, transform: legacy.transform })).digest("hex");
    expect(generationPlanCreativeHash(legacy)).toBe(oldHash);
    const single = { ...legacy, sceneComposition: "single-artwork" as const, sources: [legacy.sources[0]!] };
    expect(generationPlanSchema.parse(single)).toEqual(single);
    expect(generationPlanCreativeHash(single)).not.toBe(oldHash);
    expect(() => generationPlanSchema.parse({ ...legacy, sources: [legacy.sources[0]!] })).toThrow(/three sources/);
    expect(() => generationPlanSchema.parse({ ...single, sources: legacy.sources })).toThrow(/one source/);
    expect(() => generationPlanSchema.parse({ ...plan, sceneComposition: "single-artwork" })).toThrow(/no scene/);
    expect(() => generationPlanSchema.parse({ ...single, sceneComposition: "three-artworks" })).toThrow();
  });
});
