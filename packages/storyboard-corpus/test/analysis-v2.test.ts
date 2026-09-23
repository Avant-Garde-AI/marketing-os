import { describe, expect, it } from "vitest";

import {
  analyzePostV2,
  AnalysisContractError,
  type AnalysisInput,
  type V2Stages,
} from "../src/analysis/v2";

const input: AnalysisInput = {
  snapshotRef: "snapshot:1",
  coverage: {
    visualSamplesCovered: true,
    fullVisualStreamCovered: true,
    audioCovered: false,
    transcriptCovered: false,
  },
  post: {
    inputHash: "hash:1",
    input: {
      postId: "instagram:abc",
      format: "carousel",
      caption: "The caption is context only",
      engagement: { likes: 123 },
      media: [
        { ref: "m0", kind: "image", ordinal: 0 },
        { ref: "m1", kind: "image", ordinal: 1 },
      ],
    },
    media: [
      { ref: "m0", kind: "image", ordinal: 0, bytes: Buffer.from("image 0"), checksum: "a" },
      { ref: "m1", kind: "image", ordinal: 1, bytes: Buffer.from("image 1"), checksum: "b" },
    ],
  },
};
const observed = {
  observations: [
    {
      id: "o0",
      mediaRef: "m0",
      ordinal: 0,
      visible: "A covered shape",
      treatmentTags: ["close crop"],
      textSpans: [],
    },
    {
      id: "o1",
      mediaRef: "m1",
      ordinal: 1,
      visible: "The full painting",
      treatmentTags: ["full frame"],
      textSpans: [],
    },
  ],
  transitions: [
    {
      id: "t0",
      fromObservationId: "o0",
      toObservationId: "o1",
      observableChange: "crop to whole",
      operation: "reveal" as const,
    },
  ],
  limitations: [],
};
const annotated = {
  beats: [
    {
      id: "b0",
      supportingObservationIds: ["o0"],
      function: "question",
      informationAdded: "A detail is withheld",
      claimRefs: [],
    },
    {
      id: "b1",
      supportingObservationIds: ["o1"],
      function: "answer",
      informationAdded: "The full work is shown",
      claimRefs: [],
    },
  ],
  transitionInterpretations: [
    {
      transitionId: "t0",
      interpretation: "The second image resolves the first",
      alternativeReading: "It may simply broaden the view",
    },
  ],
  narrative: {
    mechanism: "detail to whole",
    hook: "What is this?",
    payoff: "Whole work",
    continuity: ["same painting"],
    limitations: [],
  },
};
function stages(): V2Stages {
  return {
    model: "fake",
    observationPromptHash: "obs-hash",
    annotationPromptHash: "anno-hash",
    observe: async () => ({ value: observed }),
    annotate: async () => ({ value: annotated }),
  };
}

describe("grounded v2 analysis contract", () => {
  it("keeps visible transition, interpretation, and beat support distinct", async () => {
    const result = await analyzePostV2(input, stages());
    expect(result.transitions[0]).toMatchObject({
      observableChange: "crop to whole",
      interpretation: "The second image resolves the first",
    });
    expect(result.beats[1]?.supportingObservationIds).toEqual(["o1"]);
    expect(result.review.state).toBe("unreviewed");
  });

  it("keeps caption and engagement out of the pixel pass, and engagement out of interpretation", async () => {
    const guarded = stages();
    guarded.observe = async (received) => {
      expect(received).not.toHaveProperty("caption");
      expect(received).not.toHaveProperty("engagement");
      return { value: observed };
    };
    guarded.annotate = async (received) => {
      expect(received.caption).toBe("The caption is context only");
      expect(received).not.toHaveProperty("engagement");
      return { value: annotated };
    };
    await analyzePostV2(input, guarded);
  });

  it("rejects a transition that cites the wrong source order", async () => {
    const bad = stages();
    bad.observe = async () => ({
      value: {
        ...observed,
        transitions: [{ ...observed.transitions[0]!, fromObservationId: "o1" }],
      },
    });
    await expect(analyzePostV2(input, bad)).rejects.toThrow(AnalysisContractError);
  });

  it("rejects a narrative beat with invented observation support", async () => {
    const bad = stages();
    bad.annotate = async () => ({
      value: {
        ...annotated,
        beats: [{ ...annotated.beats[0]!, supportingObservationIds: ["unseen"] }],
      },
    });
    await expect(analyzePostV2(input, bad)).rejects.toThrow(/beat support/);
  });

  it("rejects invented claim references until a claim source is connected", async () => {
    const bad = stages();
    bad.annotate = async () => ({
      value: {
        ...annotated,
        beats: [{ ...annotated.beats[0]!, claimRefs: ["claim:unseen"] }],
      },
    });
    await expect(analyzePostV2(input, bad)).rejects.toThrow(/claim references/);
  });

  it("labels sampled video limits without pretending to see audio or intervening motion", async () => {
    const video: AnalysisInput = {
      ...input,
      post: {
        ...input.post,
        input: {
          ...input.post.input,
          format: "video",
          media: [
            { ref: "m0", kind: "video-sample", ordinal: 0, sampleTimeSeconds: 0 },
            { ref: "m1", kind: "video-sample", ordinal: 1, sampleTimeSeconds: 2 },
          ],
        },
        media: input.post.media.map((item, index) => ({
          ...item,
          kind: "video-sample" as const,
          sampleTimeSeconds: index * 2,
        })),
      },
      coverage: {
        visualSamplesCovered: true,
        fullVisualStreamCovered: false,
        audioCovered: false,
        transcriptCovered: false,
      },
    };
    const result = await analyzePostV2(video, stages());
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "sampled-video-coverage",
        "audio-not-covered",
        "transcript-not-covered",
      ])
    );
  });
});
