import { describe, expect, it } from "vitest";
import { persistStoryboardReview, persistStoryboardSelection, readSelectedStoryboard, readStoryboardReview, selectedReviewOption, storyboardContentHash, storyboardReviewPath, storyboardSelectionPath } from "../templates/agents/lib/storyboard/reviews";
import type { Storyboard } from "../templates/agents/lib/storyboard/types";

const context = { brand: { source: "brand.md", content: "Editorial restraint" }, facts: [{source: "owner", content: "A paper print"}], patterns: [], priorPosts: [], assets: [] };
const storyboard: Storyboard = {id: "one", format: "single", premise: "Paper in focus", payoff: "Notice its surface", beats: [{ id: "payoff", role: "payoff", assertion: "Paper print", brief: {shows: "Paper", feels: "quiet", avoid: ["invented texture"], sourcing: "generated"}, evidence: [{claim: "Paper print", origin: "owner", source: "owner"}] }], continuity: []};
async function fixture() {
  const files = new Map<string,string>([["social/reference/storyboard-context.json", "source context"]]);
  const repo = {readFile: async (p: string) => files.get(p) ?? null, writeFile: async (p: string, v: string) => { files.set(p,v); }};
  const review = await persistStoryboardReview({repo, tenant: "one.myshopify.com", brief: "Study the paper", context, sources: [{path: "social/reference/storyboard-context.json", hash: storyboardContentHash("source context")}], review: { status: "awaiting-human-review", reviewHash: "a".repeat(64), options: [
    {storyboard, verdicts: [{kill:false, reason:"Grounded"}], evidenceStatus:"hypothesis",status:"reviewable"},
    {storyboard:{...storyboard,id:"two"},verdicts:[{kill:true,reason:"Repeats the previous post"}],evidenceStatus:"hypothesis",status:"eliminated"},
    {storyboard:{...storyboard,id:"three"},verdicts:[{kill:false,reason:"Grounded"}],evidenceStatus:"hypothesis",status:"reviewable"},
  ],modelCalls:4,imageryCalls:0,missing:[]} });
  const params = {reviewId: review.reviewId, reviewHash: review.reviewHash, storyboardId:"one",affirmSelectedCandidate:true as const,eliminatedStoryboardId:"two",eliminationReason:"Repeats the previous post"};
  const current = {tenant: review.tenant,brand:context.brand.content};
  return {files,repo,review,params,current};
}
describe("durable storyboard selection", () => {
  it("persists review without authorizing spend and only resumes an exact approved selection", async () => {
    const f = await fixture();
    await expect(readSelectedStoryboard(f.repo,f.review.reviewId,f.review.reviewHash,f.current)).rejects.toThrow("approved storyboard.select");
    const selected = await persistStoryboardSelection(f.repo,f.review,f.params);
    const retry = await persistStoryboardSelection(f.repo,f.review,f.params);
    expect(retry.selectionHash).toBe(selected.selectionHash);
    const loaded = await readSelectedStoryboard(f.repo,f.review.reviewId,f.review.reviewHash,f.current);
    expect(loaded.storyboard).toEqual(storyboard);
    expect(loaded.context).toEqual(context);
    expect(loaded.storyboardHash).toBe(storyboardContentHash(storyboard));
    expect(f.files.size).toBe(3);
  });
  it("requires explicit selection affirmation and an exact eliminated critic reason", async () => {
    const f = await fixture();
    expect(() => selectedReviewOption(f.review,{...f.params,eliminationReason:"Looks fine"})).toThrow("exact critic");
    expect(() => selectedReviewOption(f.review,{...f.params,eliminatedStoryboardId:"three"})).toThrow("exact critic");
    expect(() => selectedReviewOption(f.review,{...f.params,storyboardId:"two"})).toThrow("survive");
    await persistStoryboardSelection(f.repo,f.review,f.params);
    await expect(persistStoryboardSelection(f.repo,f.review,{...f.params,storyboardId:"three"})).rejects.toThrow("different approved selection");
  });
  it("fails closed on tenant, source or brand drift", async () => {
    const f = await fixture();
    await persistStoryboardSelection(f.repo,f.review,f.params);
    await expect(readStoryboardReview(f.repo,f.review.reviewId,f.review.reviewHash,{tenant:"other"})).rejects.toThrow("tenant");
    await expect(readSelectedStoryboard(f.repo,f.review.reviewId,f.review.reviewHash,{...f.current,brand:"New rules"})).rejects.toThrow("Brand context changed");
    f.files.set("social/reference/storyboard-context.json","edited sources");
    await expect(readSelectedStoryboard(f.repo,f.review.reviewId,f.review.reviewHash,f.current)).rejects.toThrow("Planning source changed");
  });
  it("rejects review context or selection tampering and unsafe IDs", async () => {
    const f = await fixture();
    await persistStoryboardSelection(f.repo,f.review,f.params);
    const path = storyboardSelectionPath(f.review.reviewId);
    const selection = JSON.parse(f.files.get(path)!);
    selection.storyboardId = "three";
    f.files.set(path,JSON.stringify(selection));
    await expect(readSelectedStoryboard(f.repo,f.review.reviewId,f.review.reviewHash,f.current)).rejects.toThrow("changed");
    const reviewPath = storyboardReviewPath(f.review.reviewId);
    const review = JSON.parse(f.files.get(reviewPath)!);
    review.context.brand.content = "Tampered";
    f.files.set(reviewPath,JSON.stringify(review));
    await expect(readStoryboardReview(f.repo,f.review.reviewId,f.review.reviewHash,f.current)).rejects.toThrow("changed");
    expect(() => storyboardReviewPath("../other")).toThrow();
  });
  it("hashes object content independent of key insertion order", () => {
    expect(storyboardContentHash({b:2,a:1})).toBe(storyboardContentHash({a:1,b:2}));
  });
});
