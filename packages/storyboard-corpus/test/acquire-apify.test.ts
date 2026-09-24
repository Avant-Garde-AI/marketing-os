import { describe, expect, it, vi } from "vitest";

import { createApifyRecoveryProvider } from "../src/acquire/apify";
import type { RecoverySource } from "../src/acquire/recover";

const source: RecoverySource = {
  shortcode: "DTbusF1GO7X",
  accountHandle: "kevinruss",
  postUrl: "https://www.instagram.com/p/DTbusF1GO7X/",
  expectedChildren: 3,
  metadataCapturedAt: "2026-09-01T00:00:00.000Z",
};

function response(overrides: Record<string, unknown> = {}) {
  return [
    {
      shortCode: source.shortcode,
      ownerUsername: source.accountHandle,
      type: "Sidecar",
      childPosts: [
        { id: "media-1", type: "Image", displayUrl: "https://scontent.cdninstagram.com/1.jpg" },
        { id: "media-2", type: "Video", videoUrl: "https://scontent.fbcdn.net/2.mp4" },
        { id: "media-3", type: "Image", displayUrl: "https://scontent.cdninstagram.com/3.jpg" },
      ],
      ...overrides,
    },
  ];
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Apify recovery provider", () => {
  it("requests one exact post with explicit caps and normalizes ordered children", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const transport = vi.fn(async (url: string | URL, init?: RequestInit) => {
      requestUrl = String(url);
      requestInit = init;
      return jsonResponse(response());
    });
    const writeRawResponse = vi.fn(async () => "gs://private-evidence/apify/run-item.json");
    const provider = createApifyRecoveryProvider({
      token: "test-token",
      maxItems: 1,
      maxTotalChargeUsd: 0.25,
      fetch: transport,
      writeRawResponse,
      now: () => new Date("2026-09-24T12:00:00.000Z"),
    });

    const result = await provider.fetchPost(source);

    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items");
    expect(url.searchParams.get("maxItems")).toBe("1");
    expect(url.searchParams.get("maxTotalChargeUsd")).toBe("0.25");
    expect(url.searchParams.get("timeout")).toBe("120");
    expect(url.search).not.toContain("token");
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer test-token");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      directUrls: [source.postUrl],
      resultsType: "posts",
      resultsLimit: 1,
    });
    expect(result).toEqual({
      shortcode: source.shortcode,
      accountHandle: source.accountHandle,
      ownerHandle: source.accountHandle,
      sourceAttribution: "owner",
      children: [
        {
          childId: "media-1",
          ordinal: 0,
          modality: "image",
          sourceRef: "https://scontent.cdninstagram.com/1.jpg",
        },
        {
          childId: "media-2",
          ordinal: 1,
          modality: "video",
          sourceRef: "https://scontent.fbcdn.net/2.mp4",
        },
        {
          childId: "media-3",
          ordinal: 2,
          modality: "image",
          sourceRef: "https://scontent.cdninstagram.com/3.jpg",
        },
      ],
      orderEvidenceRef: "gs://private-evidence/apify/run-item.json",
    });
    expect(writeRawResponse).toHaveBeenCalledWith({
      source,
      response: response(),
      capturedAt: "2026-09-24T12:00:00.000Z",
    });
  });

  it("rejects identity mismatch and wrong or absent child count before evidence write", async () => {
    const writeRawResponse = vi.fn(async () => "gs://evidence/item.json");
    const provider = (payload: unknown) =>
      createApifyRecoveryProvider({
        token: "test-token",
        maxItems: 1,
        maxTotalChargeUsd: 0.25,
        fetch: async () => jsonResponse(payload),
        writeRawResponse,
      });

    await expect(provider(response({ shortCode: "different" })).fetchPost(source)).rejects.toThrow(
      "identity"
    );
    await expect(
      provider(
        response({
          ownerUsername: "someoneelse",
          taggedUsers: [{ username: source.accountHandle }],
        })
      ).fetchPost(source)
    ).rejects.toThrow("identity");
    await expect(
      provider(
        response({
          childPosts: (response()[0] as { childPosts: unknown[] }).childPosts.slice(0, 2),
        })
      ).fetchPost(source)
    ).rejects.toThrow("child count");
    await expect(provider([{}]).fetchPost(source)).rejects.toThrow("identity");
    expect(writeRawResponse).not.toHaveBeenCalled();
  });

  it("records a verified coauthor separately from the owning account", async () => {
    const provider = createApifyRecoveryProvider({
      token: "test-token",
      maxItems: 1,
      maxTotalChargeUsd: 0.25,
      fetch: async () =>
        jsonResponse(
          response({
            ownerUsername: "galleryowner",
            coauthorProducers: [{ username: source.accountHandle }],
          })
        ),
      writeRawResponse: async () => "gs://evidence/collaborative.json",
    });
    await expect(provider.fetchPost(source)).resolves.toMatchObject({
      accountHandle: source.accountHandle,
      ownerHandle: "galleryowner",
      sourceAttribution: "coauthor",
    });
  });

  it("keeps a public caption as labeled context for the later annotation stage", async () => {
    const provider = createApifyRecoveryProvider({
      token: "test-token",
      maxItems: 1,
      maxTotalChargeUsd: 0.25,
      fetch: async () => jsonResponse(response({ caption: "Original artist caption" })),
      writeRawResponse: async () => "gs://evidence/caption.json",
    });
    await expect(provider.fetchPost(source)).resolves.toMatchObject({
      caption: "Original artist caption",
    });
  });

  it("fails closed when durable evidence is unavailable or child media fields are incomplete", async () => {
    const base = {
      token: "test-token",
      maxItems: 1 as const,
      maxTotalChargeUsd: 0.25,
      fetch: async () => jsonResponse(response()),
    };
    expect(() =>
      createApifyRecoveryProvider({ ...base, writeRawResponse: undefined as never })
    ).toThrow("durable raw-response writer");
    const noEvidence = createApifyRecoveryProvider({
      ...base,
      writeRawResponse: async () => "",
    });
    await expect(noEvidence.fetchPost(source)).rejects.toThrow("durable evidence reference");

    const badChildren = response({
      childPosts: [
        { id: "same", type: "Image", displayUrl: "https://scontent.cdninstagram.com/1.jpg" },
        { id: "same", type: "Image", displayUrl: "https://scontent.cdninstagram.com/2.jpg" },
        { id: "third", type: "Image" },
      ],
    });
    const invalid = createApifyRecoveryProvider({
      ...base,
      fetch: async () => jsonResponse(badChildren),
      writeRawResponse: async () => "gs://evidence/item.json",
    });
    await expect(invalid.fetchPost(source)).rejects.toThrow("source media URL");
  });

  it("requires a one-item and positive per-run charge cap", () => {
    const common = { token: "test-token", writeRawResponse: async () => "gs://evidence/item.json" };
    expect(() =>
      createApifyRecoveryProvider({ ...common, maxItems: 2, maxTotalChargeUsd: 0.2 })
    ).toThrow("maxItems must be exactly 1");
    expect(() =>
      createApifyRecoveryProvider({ ...common, maxItems: 1, maxTotalChargeUsd: 0 })
    ).toThrow("maxTotalChargeUsd");
    expect(() =>
      createApifyRecoveryProvider({ ...common, maxItems: 1, maxTotalChargeUsd: 2 })
    ).toThrow("maxTotalChargeUsd");
  });

  it("rejects unsupported post types, source URLs and child media hosts", async () => {
    const provider = (payload: unknown) =>
      createApifyRecoveryProvider({
        token: "test-token",
        maxItems: 1,
        maxTotalChargeUsd: 0.25,
        fetch: async () => jsonResponse(payload),
        writeRawResponse: async () => "gs://evidence/item.json",
      });
    await expect(provider(response({ type: "Image" })).fetchPost(source)).rejects.toThrow(
      "not a carousel"
    );
    await expect(
      provider(response()).fetchPost({ ...source, postUrl: "https://www.instagram.com/p/other/" })
    ).rejects.toThrow("exact carousel post");
    const unsafe = response({
      childPosts: [
        { id: "one", type: "Image", displayUrl: "https://example.com/1.jpg" },
        { id: "two", type: "Image", displayUrl: "https://scontent.cdninstagram.com/2.jpg" },
        { id: "three", type: "Image", displayUrl: "https://scontent.cdninstagram.com/3.jpg" },
      ],
    });
    await expect(provider(unsafe).fetchPost(source)).rejects.toThrow("host is unsupported");
  });
});
