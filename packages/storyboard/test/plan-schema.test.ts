import { describe, expect, it } from "vitest";
import { z } from "zod";
import { planStoryboards } from "../src/plan";
import type { StoryModel } from "../src/critics";
import type { PlanningContext } from "../src/schemas";
import type { Storyboard } from "../src/types";

const context: PlanningContext = {
  brand: { source: "brand:current", content: "Real artworks, grounded claims." },
  facts: [
    { source: "graph:acquired-digest", content: "A branch appears in the work." },
    { source: "catalog:acquired-digest", content: "Current product, title and image." },
  ],
  patterns: [{ id: "detail-to-context", basis: "brand-derived", move: "Detail to full work", rationale: "A hypothesis", sources: ["brand:current"] }],
  assets: [{ ref: "https://cdn.shopify.com/current-artwork.jpg", kind: "framed-render" }],
  priorPosts: [],
  concept: {
    id: "detail-reveal", source: "concept:content-hash", premise: "Read a detail differently", payoff: "See the context",
    needs: [{ id: "legible-detail", required: true, description: "A legible real detail" }], formats: ["carousel"],
  },
  subjects: [{ handle: "current-work", assetRef: "https://cdn.shopify.com/current-artwork.jpg", sourceRefs: ["graph:acquired-digest", "catalog:acquired-digest"] }],
};
function story(): Storyboard {
  return {
    id: "one", conceptId: "detail-reveal", subjectHandles: ["current-work"], format: "carousel",
    premise: "A detail becomes readable in its context", payoff: "See its place in the work",
    needAssessments: [{ needId: "legible-detail", met: true, sourceRefs: ["catalog:acquired-digest"], reason: "The acquired image contains the real detail" }],
    continuity: [{ what: "the same artwork", binding: "fixed-asset", ref: context.assets[0]!.ref }],
    beats: [0, 1].map((i) => ({
      id: `beat-${i}`, role: i ? "turn" : "setup", assertion: "The real work contains a branch",
      evidence: [{ claim: "branch", origin: "data", source: "graph:acquired-digest" }],
      ...(i ? { transition: { change: "Detail to full-work context", why: "Reinterpret the detail", patternRefs: ["detail-to-context"] } } : {}),
      brief: { shows: i ? "The full framed work" : "The branch detail", feels: "Quiet", avoid: ["Invented art"], sourcing: "store-asset", aspect: "4:5", asset: { ref: context.assets[0]!.ref, use: i ? "as-is" : "detail-crop" } },
    })),
  };
}
function plans(first = story()) { return { storyboards: [first, { ...story(), id: "two" }, { ...story(), id: "three" }] }; }
function model(output: unknown, capture?: (schema: z.ZodTypeAny) => void): StoryModel {
  return { generate: async (request) => {
    if (request.task === "plan-storyboards") capture?.(request.schema);
    return request.schema.parse(request.task === "plan-storyboards" ? output : {
      wholeStory: { kill: false, score: 0.7, reason: "The context changes the reading of the detail" },
    });
  } };
}

describe("context-scoped planner output schema", () => {
  it("exposes exact acquired identifier constraints to the provider while retaining three independent critiques", async () => {
    let responseSchema: z.ZodTypeAny | undefined;
    const review = await planStoryboards("Read a real detail", context, model(plans(), (schema) => { responseSchema = schema; }));
    expect(review.modelCalls).toBe(4);
    expect(review.options.every((option) => option.status === "reviewable")).toBe(true);
    const shape = (responseSchema as z.AnyZodObject).shape.storyboards.element.shape;
    expect(shape.conceptId.value).toBe(context.concept!.id);
    expect(shape.conceptId.isOptional()).toBe(false);
    expect(shape.subjectHandles.element.options).toEqual(["current-work"]);
    expect(shape.needAssessments.element.shape.needId.options).toEqual(["legible-detail"]);
    expect(shape.needAssessments.element.shape.sourceRefs.element.options).toEqual(["brand:current", "graph:acquired-digest", "catalog:acquired-digest"]);
    expect(shape.beats.element.shape.evidence.element.shape.source.options).toEqual(["brand:current", "graph:acquired-digest", "catalog:acquired-digest"]);
    const storeBrief = shape.beats.element.shape.brief.optionsMap.get("store-asset");
    expect(storeBrief.shape.asset.isOptional()).toBe(false);
    expect(storeBrief.shape.asset.shape.ref.options).toEqual([context.assets[0]!.ref]);
    expect(storeBrief.shape).not.toHaveProperty("seconds");
    expect(shape.beats.element.shape.transition.unwrap().shape.patternRefs.element.options).toEqual(["detail-to-context"]);
    expect(shape.continuity.element.shape.ref.options).toEqual([context.assets[0]!.ref]);
  });

  const foreignValues: Array<[string, (board: Storyboard) => void]> = [
    ["concept source hash used as conceptId", (board) => { board.conceptId = context.concept!.source; }],
    ["missing selected conceptId", (board) => { delete board.conceptId; }],
    ["friendly catalog alias used as evidence", (board) => { board.beats[0]!.evidence[0]!.source = "catalog:current-work"; }],
    ["source acquired for another context", (board) => { board.beats[0]!.evidence[0]!.source = "catalog:foreign-digest"; }],
    ["missing evidence source", (board) => { delete board.beats[0]!.evidence[0]!.source; }],
    ["invented need ID", (board) => { board.needAssessments![0]!.needId = "room-photo"; }],
    ["unacquired need evidence alias", (board) => { board.needAssessments![0]!.sourceRefs = ["catalog:current-work"]; }],
    ["format blocked by the concept", (board) => { board.format = "video"; }],
    ["graph alias used as selected catalog subject", (board) => { board.subjectHandles = ["current-work-old"]; }],
    ["missing store-asset binding", (board) => { delete board.beats[0]!.brief.asset; }],
    ["still carousel requests motion", (board) => { board.beats[0]!.brief.seconds = 3; }],
    ["unacquired asset URL", (board) => { board.beats[0]!.brief.asset!.ref = "https://cdn.shopify.com/other-artwork.jpg"; }],
    ["unavailable continuity reference", (board) => { board.continuity[0]!.ref = "asset:invented"; }],
    ["unknown pattern ID", (board) => { board.beats[1]!.transition!.patternRefs = ["detail-reveal-alias"]; }],
  ];
  it.each(foreignValues)("rejects %s through the actual provider response schema, without repairing it", async (_label, mutate) => {
    const board = story();
    mutate(board);
    let calls = 0;
    const generated = model(plans(board), () => { calls++; });
    await expect(planStoryboards("Read a real detail", context, generated)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("requires an empty patternRefs array when no patterns were supplied", async () => {
    const noPatterns = { ...context, patterns: [] };
    let schema: z.ZodTypeAny | undefined;
    const boards = plans();
    boards.storyboards.forEach((board) => { board.beats[1]!.transition!.patternRefs = []; });
    await planStoryboards("An unsupported hypothesis", noPatterns, model(boards, (value) => { schema = value; }));
    boards.storyboards[0]!.beats[1]!.transition!.patternRefs = ["detail-to-context"];
    expect(() => schema!.parse(boards)).toThrow();
  });

  it("preserves generated single-image planning with no acquired assets or patterns", async () => {
    const noAssets: PlanningContext = { brand: context.brand, facts: [], assets: [], patterns: [], priorPosts: [] };
    const board: Storyboard = {
      id: "one", format: "single", premise: "Quiet editorial art", payoff: "One restrained image", continuity: [],
      beats: [{ id: "one-frame", role: "payoff", assertion: "An editorial image follows the current brand",
        evidence: [{ claim: "Current brand direction", origin: "brand", source: context.brand.source }],
        brief: { shows: "An original editorial composition", feels: "Quiet", avoid: ["Invented existing artwork"], sourcing: "generated" } }],
    };
    let schema: z.ZodTypeAny | undefined;
    const output = { storyboards: [board, { ...board, id: "two" }, { ...board, id: "three" }] };
    const review = await planStoryboards("A new editorial image", noAssets, model(output, (value) => { schema = value; }));
    expect(review.modelCalls).toBe(4);
    expect(review.options.every((option) => option.status === "reviewable")).toBe(true);
    const withInventedAsset = structuredClone(output);
    withInventedAsset.storyboards[0]!.beats[0]!.brief.asset = { ref: "asset:fiction", use: "as-is" };
    expect(() => schema!.parse(withInventedAsset)).toThrow();
  });

  it("retains valid video durations for a separately quoted motion adapter", async () => {
    const videoContext = { ...context, concept: { ...context.concept!, formats: ["video" as const] } };
    const video = story();
    video.format = "video";
    video.beats.forEach((beat) => { beat.brief.seconds = 4; });
    const output = { storyboards: [video, { ...structuredClone(video), id: "two" }, { ...structuredClone(video), id: "three" }] };
    const review = await planStoryboards("A future video arc", videoContext, model(output));
    expect(review.modelCalls).toBe(4);
    expect(review.options.every((option) => option.storyboard.beats.every((beat) => beat.brief.seconds === 4))).toBe(true);
  });

  it("rejects rather than strips duration from a generated single", async () => {
    const noAssets: PlanningContext = { brand: context.brand, facts: [], assets: [], patterns: [], priorPosts: [] };
    const board: Storyboard = { id: "one", format: "single", premise: "An original editorial image", payoff: "One image", continuity: [],
      beats: [{ id: "one-frame", role: "payoff", assertion: "Current brand direction",
        evidence: [{ claim: "Current direction", origin: "brand", source: context.brand.source }],
        brief: { shows: "An original composition", feels: "Quiet", avoid: ["Invented existing artwork"], sourcing: "generated", seconds: 3 } }],
    };
    await expect(planStoryboards("A still", noAssets, model({ storyboards: [board, { ...board, id: "two" }, { ...board, id: "three" }] }))).rejects.toThrow();
    expect(board.beats[0]!.brief.seconds).toBe(3);
  });

  it("retains deterministic unmet-hard-need rejection when all identifiers are valid", async () => {
    const board = story();
    board.needAssessments![0]!.met = false;
    board.needAssessments![0]!.sourceRefs = [];
    const review = await planStoryboards("Unavailable hard need", context, model(plans(board)));
    expect(review.options[0]?.status).toBe("eliminated");
    expect(review.options[0]?.verdicts.some((verdict) => verdict.reason.includes("unmet"))).toBe(true);
  });
});
