import { describe, expect, it } from "vitest";

import { assessSnapshot, corpusSnapshotSchema, metricFromRaw, summarizeRecovery } from "../src/acquire/manifest";

const checksum = "a".repeat(64);
const child = (ordinal: number, modality: "image" | "video" = "image") => ({
  childId: `child-${ordinal}`,
  ordinal,
  modality,
  sourceRef: `instagram:${ordinal}`,
  objectRef: `gs://recovered/child-${ordinal}`,
  checksum,
  ...(modality === "video" ? { sampleTimeSeconds: ordinal * 2 } : {}),
});
const base = (expected = [child(0)], actual = expected) => ({
  snapshotVersion: "corpus-snapshot-v2" as const,
  source: { platform: "instagram", postId: "abc", url: "https://www.instagram.com/p/abc/", account: "artist" },
  capture: { metadataCapturedAt: "2026-09-22T12:00:00.000Z", collector: "recovery-v1" },
  media: { expected, actual },
  coverage: {
    expectedCount: expected.length,
    acquiredCount: actual.length,
    orderingVerified: true,
    modalitiesObserved: [...new Set(actual.map((item) => item.modality))],
    visualSamplesCovered: true,
    fullVisualStreamCovered: true,
    audioCovered: false,
    transcriptCovered: false,
  },
  metrics: { likes: metricFromRaw(12), comments: metricFromRaw(3) },
  scope: { paidOrganic: "organic" as const },
  identity: { canonicalPostId: "instagram:abc", occurrenceAliases: ["artist:abc"] },
  disposition: "ready" as const,
});

describe("acquisition manifest v2", () => {
  it("accepts complete singles and ordered mixed-media carousels", () => {
    expect(assessSnapshot(base())).toMatchObject({ status: "ready", complete: true });
    const carousel = base([child(0), child(1, "video")]);
    expect(assessSnapshot(carousel)).toMatchObject({ status: "ready", complete: true });
  });

  it("retains incomplete carousel evidence instead of presenting its cover as ready", () => {
    const snapshot = base([child(0), child(1)], [child(0)]);
    expect(assessSnapshot(snapshot)).toMatchObject({ status: "incomplete", reasons: expect.arrayContaining(["media-incomplete"]) });
  });

  it("requires source order and child identity to match", () => {
    const reordered = base([child(0), child(1)], [child(1), child(0)]);
    expect(assessSnapshot(reordered).reasons).toEqual(expect.arrayContaining(["order-unverified", "child-mismatch:0"]));
  });

  it("keeps occurrence aliases while canonical identity stays singular", () => {
    const snapshot = base();
    snapshot.identity.occurrenceAliases.push("repost-account:abc");
    expect(assessSnapshot(snapshot).canonicalPostId).toBe("instagram:abc");
  });

  it("maps negative engagement sentinels to unknown rather than zero", () => {
    expect(metricFromRaw(-1)).toEqual({ status: "unknown", reason: "sentinel" });
    expect(metricFromRaw(0)).toEqual({ status: "measured", value: 0 });
  });

  it("separates video samples from complete visual, audio, and transcript coverage", () => {
    const video = base([child(0, "video"), child(1, "video")]);
    video.coverage.fullVisualStreamCovered = false;
    const assessment = assessSnapshot(video);
    expect(assessment).toMatchObject({ status: "ready", complete: true });
    expect(assessment.modalityGaps).toEqual(["audio", "transcript"]);
  });

  it("keeps failed and expired rows in deterministic recovery reporting", () => {
    const incomplete = base([child(0), child(1)], [child(0)]);
    const expired = { ...base(), disposition: "expired" as const, reason: "removed" };
    const summary = summarizeRecovery([base(), incomplete, expired]);
    expect(summary).toMatchObject({ planned: 3, ready: 1, incomplete: 1, expired: 1, failed: 0 });
  });

  it("rejects coverage counts that do not match retained media", () => {
    const invalid = { ...base(), coverage: { ...base().coverage, acquiredCount: 2 } };
    expect(corpusSnapshotSchema.safeParse(invalid).success).toBe(true);
    expect(assessSnapshot(invalid)).toMatchObject({ status: "incomplete", reasons: ["acquired-count-mismatch"] });
  });
});
