import { describe, it, expect } from "vitest";
import { proposeTransitionPattern, patternProposalHash, compileTransitionLibrary, retrieveTransitionPatterns, type PatternReviewDecision } from "../src/library";
import type { PostAnalysisV2 } from "../src/analysis/v2";
const scope = { kind: "tenant" as const, id: "store-a" };
function source(postRef = "post-a", accountRef = "account-a") {
  const observations = [0, 1, 2].map((ordinal) => ({ id: `o${ordinal}`, ordinal, mediaRef: `${postRef}:m${ordinal}`, visible: `Visible ${ordinal}`, treatmentTags: [], textSpans: [] }));
  const analysis: PostAnalysisV2 = { version: "post-analysis-v2", postId: postRef, snapshotRef: `${postRef}:snapshot`, inputHash: "a".repeat(64),
    mediaCoverage: { visualSamplesCovered: true, fullVisualStreamCovered: true, audioCovered: false, transcriptCovered: false }, observations,
    transitions: [0, 1].map((n) => ({ id: `t${n}`, transitionId: `t${n}`, fromObservationId: `o${n}`, toObservationId: `o${n + 1}`, observableChange: `View ${n} to ${n + 1}`, operation: "reframe", interpretation: "Context expands" })),
    beats: observations.map((o) => ({ id: `b${o.ordinal}`, supportingObservationIds: [o.id], function: "context", informationAdded: o.visible, claimRefs: [] })),
    narrative: { mechanism: "expansion", continuity: [], limitations: [] }, limitations: ["Uncertain spatial arrangement"], review: { state: "unreviewed", reviewRefs: [] },
    provenance: { model: "fixture", observationPromptHash: "observe", annotationPromptHash: "annotate" } };
  return { accountRef, analysis, transitionIds: ["t0", "t1"], input: { postId: postRef, format: "carousel" as const, media: observations.map((o) => ({ ref: o.mediaRef, ordinal: o.ordinal, kind: "image" as const })) } };
}
function proposal() { return proposeTransitionPattern({ scope, id: "context", revision: 1, move: "Widen context", rationale: "Hypothesis" }, [source()]); }
function decision(p = proposal()): PatternReviewDecision {
  return { version: "pattern-review-v1", proposalHash: patternProposalHash(p), decision: "admit", reviewerRef: "reviewer:1", reviewRef: "approved-record:1", reviewedAt: "2026-09-26T12:00:00.000Z", reason: "Reviewed exact media and interpretation", exemplars: p.exemplars.map((e) => ({ id: e.id, visibleChangeConfirmed: true, interpretationConfirmed: true, domainFitConfirmed: true, reason: "Inspected" })) };
}
const verified = { verifyReview: async () => true };

describe("reviewed transition library", () => {
  it("keeps proposals uncounted and unserved, retaining exact observed/inferred source lineage", async () => {
    const p = proposal();
    expect(p.exemplars[0]).toMatchObject({ from: { ordinal: 0, mediaRef: "post-a:m0" }, to: { ordinal: 1 }, observableChange: "View 0 to 1", interpretation: "Context expands", limitations: ["Uncertain spatial arrangement"] });
    expect(p).not.toHaveProperty("n");
    const library = await compileTransitionLibrary(scope, [p], [], verified);
    expect(library.entries).toEqual([]);
    expect(library.held[0]?.reason).toBe("unreviewed");
    expect(() => retrieveTransitionPatterns(library, scope, ["context"])).toThrow("admitted");
  });
  it("requires authenticated authority and binds review to the exact proposal contents", async () => {
    const p = proposal();
    await expect(compileTransitionLibrary(scope, [p], [decision(p)], { verifyReview: async () => false })).rejects.toThrow("authority");
    await expect(compileTransitionLibrary(scope, [{ ...p, move: "Changed" }], [decision(p)], verified)).rejects.toThrow("stale");
    const altered = { ...p, exemplars: p.exemplars.map((e) => ({ ...e, interpretation: "Changed reading" })) };
    expect(patternProposalHash(altered)).not.toBe(patternProposalHash(p));
  });
  it("counts unique inspected posts and accounts, not transitions, and supports partial admission", async () => {
    const p = proposeTransitionPattern({ scope, id: "context", revision: 1, move: "Expand", rationale: "Hypothesis" }, [source(), source("post-b", "account-a"), source("post-c", "account-b")]);
    const d = decision(p); d.exemplars[4]!.domainFitConfirmed = false; d.exemplars[5]!.interpretationConfirmed = false;
    const library = await compileTransitionLibrary(scope, [p], [d], verified);
    expect(library.entries[0]).toMatchObject({ postCount: 2, accountCount: 1 });
    expect(library.entries[0]!.acceptedExemplarIds).toHaveLength(4);
    const patterns = retrieveTransitionPatterns(library, scope, ["context"]);
    expect(patterns[0]).toMatchObject({ id: "context@1", basis: "counted" });
    expect(patterns[0]!.exemplars[0]).toMatchObject({ fromBeat: 0, toBeat: 1, mediaRefs: ["post-a:m0", "post-a:m1"] });
  });
  it("holds rejected, uncertain or out-of-domain support and rejects foreign scope", async () => {
    const p = proposal(); const d = decision(p); d.exemplars.forEach((e) => e.visibleChangeConfirmed = false);
    expect((await compileTransitionLibrary(scope, [p], [d], verified)).held[0]?.reason).toBe("no-reviewed-support");
    expect((await compileTransitionLibrary(scope, [p], [{ ...d, decision: "reject" }], verified)).held[0]?.reason).toBe("review-rejected");
    await expect(compileTransitionLibrary({ kind: "domain", id: "store-a" }, [p], [], verified)).rejects.toThrow("scope");
    const library = await compileTransitionLibrary(scope, [p], [decision(p)], verified);
    expect(() => retrieveTransitionPatterns(library, { kind: "tenant", id: "store-b" }, ["context"])).toThrow("scope");
    expect(() => retrieveTransitionPatterns(JSON.parse(JSON.stringify(library)), scope, ["context"])).toThrow("Recompile");
  });
  it("rejects duplicates, fabricated locators and sampled or mismatched sources", async () => {
    const p = proposal();
    await expect(compileTransitionLibrary(scope, [p, p], [], verified)).rejects.toThrow("revision");
    const bad = { ...p, exemplars: p.exemplars.map((e) => ({ ...e, to: { ...e.to, ordinal: 9 } })) };
    await expect(compileTransitionLibrary(scope, [bad], [], verified)).rejects.toThrow("adjacent");
    const sampled = source(); sampled.analysis.mediaCoverage.fullVisualStreamCovered = false;
    expect(() => proposeTransitionPattern({ scope, id: "x", revision: 1, move: "Move", rationale: "Why" }, [sampled])).toThrow("complete");
    const changed = source(); changed.analysis.observations[1]!.mediaRef = "invented";
    expect(() => proposeTransitionPattern({ scope, id: "x", revision: 1, move: "Move", rationale: "Why" }, [changed])).toThrow("locator");
    const d = decision(p); d.exemplars[0]!.id = "b".repeat(64);
    await expect(compileTransitionLibrary(scope, [p], [d], verified)).rejects.toThrow("foreign");
  });
});
