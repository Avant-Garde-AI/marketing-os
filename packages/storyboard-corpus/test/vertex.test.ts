import { describe, expect, it, vi } from "vitest";
import { createVertexExtractor, VertexExtractionError } from "../src/vertex";
import type { AcquiredPost } from "../src/index";
const pixels = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const post: AcquiredPost = {
  input: {
    postId: "p",
    format: "carousel",
    caption: "untrusted caption",
    media: [
      { ref: "a", kind: "image", ordinal: 0 },
      { ref: "b", kind: "image", ordinal: 1 },
    ],
  },
  inputHash: "hash",
  media: [
    { ref: "a", kind: "image", ordinal: 0, bytes: pixels, checksum: "a" },
    { ref: "b", kind: "image", ordinal: 1, bytes: pixels, checksum: "b" },
  ],
};
async function rejected(promise: Promise<unknown>): Promise<VertexExtractionError> {
  try {
    await promise;
    throw new Error("expected rejection");
  } catch (error) {
    return error as VertexExtractionError;
  }
}
describe("Vertex pixel transport", () => {
  it("attaches ordered pixels, keeps captions separate and captures real usage", async () => {
    let body: any;
    const fetcher = vi.fn(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      observations: [
                        {
                          mediaRef: "a",
                          ordinal: 0,
                          role: "setup",
                          observation: "visible framed shape",
                          visibleTreatment: "frontal",
                        },
                        {
                          mediaRef: "b",
                          ordinal: 1,
                          role: "turn",
                          observation: "closer edge",
                          visibleTreatment: "crop",
                          transition: { change: "whole to detail", why: "focus attention" },
                        },
                      ],
                      narrativeMechanism: "test",
                      continuity: [],
                    }),
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 123,
            candidatesTokenCount: 50,
            thoughtsTokenCount: 12,
          },
        })
      );
    }) as unknown as typeof fetch;
    const result = await createVertexExtractor({
      project: "arthaus-us",
      model: "test-model",
      accessToken: async () => "test-token",
      fetch: fetcher,
    }).extract(post);
    expect(body.contents[0].parts.map((p: any) => p.inlineData?.data).filter(Boolean)).toEqual([
      pixels.toString("base64"),
      pixels.toString("base64"),
    ]);
    expect(JSON.parse(body.contents[0].parts[1].text).mediaRef).toBe("a");
    expect(JSON.parse(body.contents[0].parts[3].text).mediaRef).toBe("b");
    expect(result.usage).toEqual({ inputTokens: 123, outputTokens: 50, thinkingTokens: 12 });
  });
  it("refuses caption-only or non-image input before requesting credentials", async () => {
    const token = vi.fn(async () => "test-token");
    const extractor = createVertexExtractor({
      project: "arthaus-us",
      model: "test-model",
      accessToken: token,
    });
    await expect(extractor.extract({ ...post, media: [] })).rejects.toThrow(/actual image/);
    await expect(
      extractor.extract({
        ...post,
        media: [
          { ...post.media[0]!, bytes: Buffer.from("a caption is not pixels") },
          post.media[1]!,
        ],
      })
    ).rejects.toThrow(/pixels/);
    expect(token).not.toHaveBeenCalled();
  });
  it("does not retry a failed provider request or expose the credential in the error", async () => {
    const fetcher = vi.fn(
      async () => new Response("provider body", { status: 403 })
    ) as unknown as typeof fetch;
    const extractor = createVertexExtractor({
      project: "arthaus-us",
      model: "test-model",
      accessToken: async () => "test-secret",
      fetch: fetcher,
    });
    await expect(extractor.extract(post)).rejects.toThrow("Vertex extraction failed with HTTP 403");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects attached media whose order or refs do not match input before credentials", async () => {
    const token = vi.fn(async () => "secret-token");
    const extractor = createVertexExtractor({
      project: "arthaus-us",
      model: "test-model",
      accessToken: token,
    });
    await expect(
      extractor.extract({ ...post, media: [post.media[1]!, post.media[0]!] })
    ).rejects.toThrow(/match input refs and order/);
    expect(token).not.toHaveBeenCalled();
  });
  it("sanitizes credential-source failures", async () => {
    const extractor = createVertexExtractor({
      project: "arthaus-us",
      model: "test-model",
      accessToken: async () => {
        throw new Error("secret-token leaked");
      },
    });
    const err = await rejected(extractor.extract(post));
    expect(err).toBeInstanceOf(VertexExtractionError);
    expect(err.message).not.toContain("secret-token");
    expect(err.cause).toBeUndefined();
    expect(err.diagnostic).toEqual({ provider: "vertex", retryable: false });
  });
  it("retains safe usage on missing candidates and invalid JSON", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 8, thoughtsTokenCount: 2 },
          })
        )
    ) as unknown as typeof fetch;
    const extractor = createVertexExtractor({
      project: "arthaus-us",
      model: "test-model",
      accessToken: async () => "token",
      fetch: fetcher,
    });
    const missing = await rejected(extractor.extract(post));
    expect(missing.diagnostic).toEqual({
      provider: "vertex",
      usage: { inputTokens: 7, outputTokens: 8, thinkingTokens: 2 },
      retryable: false,
    });
    const invalidFetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{" }] } }],
            usageMetadata: { promptTokenCount: 3 },
          })
        )
    ) as unknown as typeof fetch;
    const invalid = await rejected(
      createVertexExtractor({
        project: "arthaus-us",
        model: "test-model",
        accessToken: async () => "token",
        fetch: invalidFetcher,
      }).extract(post)
    );
    expect(invalid.diagnostic).toEqual({
      provider: "vertex",
      finishReason: "STOP",
      usage: { inputTokens: 3 },
      retryable: false,
    });
  });
  it("classifies non-STOP usage and retryable HTTP failures without retrying", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ finishReason: "MAX_TOKENS" }],
            usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 5 },
          })
        )
    ) as unknown as typeof fetch;
    const err = await rejected(
      createVertexExtractor({
        project: "arthaus-us",
        model: "test-model",
        accessToken: async () => "token",
        fetch: fetcher,
      }).extract(post)
    );
    expect(err.diagnostic).toEqual({
      provider: "vertex",
      finishReason: "MAX_TOKENS",
      usage: { inputTokens: 4, outputTokens: 5 },
      retryable: false,
    });
    const retryable = vi.fn(
      async () => new Response("body", { status: 503 })
    ) as unknown as typeof fetch;
    const transient = await rejected(
      createVertexExtractor({
        project: "arthaus-us",
        model: "test-model",
        accessToken: async () => "token",
        fetch: retryable,
      }).extract(post)
    );
    expect(transient.diagnostic).toEqual({ provider: "vertex", httpStatus: 503, retryable: true });
    expect(retryable).toHaveBeenCalledTimes(1);
  });
});
