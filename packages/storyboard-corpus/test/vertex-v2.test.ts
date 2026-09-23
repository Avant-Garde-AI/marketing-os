import { describe, expect, it } from "vitest";

import { analyzePostV2, type AnalysisInput } from "../src/analysis/v2";
import { createVertexV2Stages, VertexV2Error } from "../src/analysis/vertex-v2";

const input: AnalysisInput = {
  snapshotRef: "snapshot:single",
  coverage: {
    visualSamplesCovered: true,
    fullVisualStreamCovered: true,
    audioCovered: false,
    transcriptCovered: false,
  },
  post: {
    inputHash: "source-hash",
    input: {
      postId: "instagram:abc",
      format: "single",
      caption: "A caption that should only reach interpretation",
      engagement: { likes: 999 },
      media: [{ ref: "frame-0", ordinal: 0, kind: "image" }],
    },
    media: [
      {
        ref: "frame-0",
        ordinal: 0,
        kind: "image",
        bytes: Buffer.from([255, 216, 255, 0]),
        checksum: "source-hash",
      },
    ],
  },
};

const observed = {
  observations: [
    {
      id: "o0",
      mediaRef: "frame-0",
      ordinal: 0,
      visible: "A painted figure on pale ground",
      treatmentTags: ["painting"],
      textSpans: [],
    },
  ],
  transitions: [],
  limitations: [],
};
const annotated = {
  beats: [
    {
      id: "b0",
      supportingObservationIds: ["o0"],
      function: "presentation",
      informationAdded: "The work is presented",
      claimRefs: [],
    },
  ],
  transitionInterpretations: [],
  narrative: { mechanism: "static presentation", continuity: [], limitations: [] },
};

function response(value: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
    }),
    { status: 200 }
  );
}

describe("Vertex v2 staged transport", () => {
  it("sends actual pixels without caption/metrics, then grounds interpretation in observations", async () => {
    const requests: Array<Record<string, any>> = [];
    const fetch = (async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return response(requests.length === 1 ? observed : annotated);
    }) as typeof globalThis.fetch;
    const stages = createVertexV2Stages({
      project: "arthaus-us",
      model: "gemini-test",
      accessToken: async () => "test-token",
      fetch,
    });
    const output = await analyzePostV2(input, stages);
    expect(output.provenance.observationUsage).toMatchObject({
      inputTokens: 100,
      outputTokens: 40,
    });
    expect(requests).toHaveLength(2);
    const pixelCall = JSON.stringify(requests[0]);
    const interpretationCall = JSON.stringify(requests[1]);
    expect(pixelCall).toContain(Buffer.from([255, 216, 255, 0]).toString("base64"));
    expect(pixelCall).not.toContain("A caption that should only reach interpretation");
    expect(pixelCall).not.toContain("999");
    expect(interpretationCall).toContain("A caption that should only reach interpretation");
    expect(interpretationCall).toContain("A painted figure on pale ground");
    expect(interpretationCall).not.toContain("999");
    expect(interpretationCall).not.toContain(Buffer.from([255, 216, 255, 0]).toString("base64"));
  });

  it("keeps a provider failure body out of the public error", async () => {
    const stages = createVertexV2Stages({
      project: "arthaus-us",
      model: "gemini-test",
      accessToken: async () => "test-token",
      fetch: (async () =>
        new Response(JSON.stringify({ secret: "private provider echo" }), {
          status: 403,
        })) as typeof globalThis.fetch,
    });
    try {
      await analyzePostV2(input, stages);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VertexV2Error);
      expect((error as Error).message).toBe("Vertex request failed with HTTP 403");
      expect(JSON.stringify(error)).not.toContain("private provider echo");
    }
  });
});
