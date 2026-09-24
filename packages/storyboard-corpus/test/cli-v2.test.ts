import { describe, expect, it, vi } from "vitest";

import type { V2Candidate, V2RunOptions } from "../src/analysis/run-v2";
import { mainV2 } from "../src/cli-v2";
import type { LedgerRow } from "../src/index";

const candidate: V2Candidate = {
  snapshotRef: "snapshot:one",
  caption: "caption context",
  snapshot: {
    snapshotVersion: "corpus-snapshot-v2",
    source: { platform: "instagram", postId: "instagram:one" },
    capture: {},
    media: {
      expected: [{ childId: "slide-0", ordinal: 0, modality: "image", sourceRef: "source:0" }],
      actual: [
        {
          childId: "slide-0",
          ordinal: 0,
          modality: "image",
          sourceRef: "source:0",
          assetRole: "source",
          objectRef: "gs://mirror/one",
          localPath: "/tmp/one.jpg",
          checksum: "a".repeat(64),
        },
      ],
    },
    coverage: {
      expectedCount: 1,
      acquiredCount: 1,
      orderingVerified: true,
      orderingEvidenceRef: "provider:one",
      modalitiesObserved: ["image"],
      visualSamplesCovered: true,
      fullVisualStreamCovered: true,
      audioCovered: false,
      transcriptCovered: false,
    },
    metrics: {},
    scope: { paidOrganic: "organic" },
    identity: { canonicalPostId: "instagram:one", occurrenceAliases: [] },
    disposition: "ready",
  },
};
const args = [
  "--manifest",
  "snapshots.json",
  "--out",
  "ledger.jsonl",
  "--run-id",
  "pilot-v2",
  "--project",
  "arthaus-us",
  "--model",
  "gemini-test",
  "--max-posts",
  "1",
];

describe("v2 snapshot CLI", () => {
  it("dry-runs without acquiring auth or constructing a model", async () => {
    const accessToken = vi.fn(async () => "secret");
    const createStages = vi.fn(() => {
      throw new Error("model was constructed");
    });
    const messages: string[] = [];
    const result = await mainV2(args, {
      readManifest: async () => [candidate],
      mediaReady: async () => true,
      accessToken,
      createStages,
      print: (line) => messages.push(line),
    });
    expect(result).toMatchObject({
      mode: "dry-run",
      selectedPosts: 1,
      eligibleSnapshots: 1,
      locallyAvailablePosts: 1,
    });
    expect(accessToken).not.toHaveBeenCalled();
    expect(createStages).not.toHaveBeenCalled();
    expect(messages.join("\n")).not.toContain("caption context");
  });

  it("passes only the capped selection to its runner", async () => {
    const run = vi.fn(
      async (_selected: V2Candidate[], _options: V2RunOptions): Promise<LedgerRow[]> => []
    );
    const result = await mainV2([...args, "--execute"], {
      readManifest: async () => [candidate, { ...candidate, snapshotRef: "unselected" }],
      mediaReady: async () => true,
      createStages: () => ({
        model: "fake",
        observationPromptHash: "o",
        annotationPromptHash: "a",
        observe: async () => {
          throw new Error("unused");
        },
        annotate: async () => {
          throw new Error("unused");
        },
      }),
      run,
      print: () => {},
    });
    expect(result.mode).toBe("execute");
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toEqual([candidate]);
    expect(run.mock.calls[0]?.[1]).toMatchObject({ maxPosts: 1, runId: "pilot-v2" });
  });
});
