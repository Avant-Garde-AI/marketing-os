import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type CorpusSnapshot } from "../src/acquire/manifest";
import { runV2Extraction, type V2Candidate } from "../src/analysis/run-v2";
import { type V2Stages } from "../src/analysis/v2";
import { VertexV2Error } from "../src/analysis/vertex-v2";
import { JsonlLedger, sha256 } from "../src/index";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "storyboard-v2-"));
  directories.push(directory);
  const pixels = [Buffer.from("first image"), Buffer.from("second image")];
  const paths = [join(directory, "0.jpg"), join(directory, "1.jpg")];
  await Promise.all(paths.map((path, index) => writeFile(path, pixels[index]!)));
  const children = paths.map((path, index) => ({
    childId: `slide-${index}`,
    ordinal: index,
    modality: "image" as const,
    sourceRef: `source:${index}`,
    assetRole: "source" as const,
    objectRef: `gs://mirror/${index}`,
    localPath: path,
    checksum: sha256(pixels[index]!),
  }));
  const snapshot: CorpusSnapshot = {
    snapshotVersion: "corpus-snapshot-v2",
    source: {
      platform: "instagram",
      postId: "instagram:abc",
      url: "https://www.instagram.com/p/abc/",
    },
    capture: { metadataCapturedAt: "2026-09-01T00:00:00.000Z" },
    media: { expected: children, actual: children },
    coverage: {
      expectedCount: 2,
      acquiredCount: 2,
      orderingVerified: true,
      orderingEvidenceRef: "provider:ordered:abc",
      modalitiesObserved: ["image"],
      visualSamplesCovered: true,
      fullVisualStreamCovered: true,
      audioCovered: false,
      transcriptCovered: false,
    },
    metrics: { likes: { status: "measured", value: 10 } },
    scope: { paidOrganic: "organic" },
    identity: { canonicalPostId: "instagram:abc", occurrenceAliases: ["artist:abc"] },
    disposition: "ready",
  };
  return {
    candidate: {
      snapshotRef: "snapshot:abc:1",
      snapshot,
      caption: "a painting",
    } satisfies V2Candidate,
    ledger: new JsonlLedger(join(directory, "ledger.jsonl")),
    paths,
  };
}

function stages(counter: { observe: number; annotate: number }): V2Stages {
  return {
    model: "fake-model",
    observationPromptHash: "pixel-hash",
    annotationPromptHash: "story-hash",
    async observe(input) {
      counter.observe += 1;
      expect(input).not.toHaveProperty("caption");
      expect(input).not.toHaveProperty("engagement");
      return {
        value: {
          observations: input.media.map((item, index) => ({
            id: `o${index}`,
            mediaRef: item.ref,
            ordinal: index,
            visible: `visible ${index}`,
            treatmentTags: [],
            textSpans: [],
          })),
          transitions: [
            {
              id: "t0",
              fromObservationId: "o0",
              toObservationId: "o1",
              observableChange: "detail to whole",
              operation: "reveal" as const,
            },
          ],
          limitations: [],
        },
      };
    },
    async annotate(input) {
      counter.annotate += 1;
      expect(input.caption).toBeTruthy();
      expect(input).not.toHaveProperty("engagement");
      return {
        value: {
          beats: [
            {
              id: "b0",
              supportingObservationIds: ["o0"],
              function: "setup",
              informationAdded: "a detail",
              claimRefs: [],
            },
            {
              id: "b1",
              supportingObservationIds: ["o1"],
              function: "reveal",
              informationAdded: "the whole",
              claimRefs: [],
            },
          ],
          transitionInterpretations: [{ transitionId: "t0", interpretation: "resolves the setup" }],
          narrative: { mechanism: "detail to whole", continuity: [], limitations: [] },
        },
      };
    },
  };
}

describe("v2 local snapshot runner", () => {
  it("extracts complete mirrored media, resumes, and ignores metric-only updates", async () => {
    const { candidate, ledger } = await fixture();
    const counter = { observe: 0, annotate: 0 };
    const options = { runId: "test", ledger, stages: stages(counter), maxPosts: 1 };
    const first = await runV2Extraction([candidate], options);
    expect(first[0]).toMatchObject({ status: "extracted", validated: true });
    expect((first[0]?.output as { transitions: unknown[] }).transitions).toHaveLength(1);
    candidate.snapshot.metrics.likes = { status: "measured", value: 500 };
    const cached = await runV2Extraction([candidate], options);
    expect(cached[0]?.inputHash).toBe(first[0]?.inputHash);
    expect(counter).toEqual({ observe: 1, annotate: 1 });
    candidate.caption = "a newly edited caption";
    const changed = await runV2Extraction([candidate], options);
    expect(changed[0]?.inputHash).not.toBe(first[0]?.inputHash);
    expect(counter).toEqual({ observe: 2, annotate: 2 });
  });

  it("quarantines incomplete source snapshots before reading pixels", async () => {
    const { candidate, ledger } = await fixture();
    candidate.snapshot.media.actual.pop();
    candidate.snapshot.coverage.acquiredCount = 1;
    const counter = { observe: 0, annotate: 0 };
    const rows = await runV2Extraction([candidate], {
      runId: "test",
      ledger,
      stages: stages(counter),
      maxPosts: 1,
    });
    expect(rows[0]?.status).toBe("incomplete");
    expect(counter).toEqual({ observe: 0, annotate: 0 });
  });

  it("rejects checksum drift before model execution", async () => {
    const { candidate, ledger, paths } = await fixture();
    await writeFile(paths[1]!, "changed bytes");
    const counter = { observe: 0, annotate: 0 };
    const rows = await runV2Extraction([candidate], {
      runId: "test",
      ledger,
      stages: stages(counter),
      maxPosts: 1,
    });
    expect(rows[0]).toMatchObject({ status: "extraction-failed" });
    expect(rows[0]?.error).toMatch(/checksum mismatch/);
    expect(counter).toEqual({ observe: 0, annotate: 0 });
  });

  it("records a safe stage diagnostic when a model response fails validation", async () => {
    const { candidate, ledger } = await fixture();
    const counter = { observe: 0, annotate: 0 };
    const failing = stages(counter);
    failing.observe = async () => {
      throw new VertexV2Error("invalid analysis JSON", {
        provider: "vertex",
        stage: "observation",
        finishReason: "STOP",
        schemaPaths: ["observations.0.visible"],
        usage: { inputTokens: 100, outputTokens: 50 },
        retryable: false,
      });
    };
    const rows = await runV2Extraction([candidate], {
      runId: "test",
      ledger,
      stages: failing,
      maxPosts: 1,
    });
    expect(rows[0]).toMatchObject({
      status: "extraction-failed",
      diagnostics: {
        provider: "vertex",
        stage: "observation",
        schemaPaths: ["observations.0.visible"],
        retryable: false,
      },
    });
    expect(
      (await ledger.latest("test", candidate.snapshot.source.postId))?.diagnostics?.usage
    ).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(counter).toEqual({ observe: 0, annotate: 0 });
  });
});
