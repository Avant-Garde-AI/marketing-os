import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createInstagramMediaMirror } from "../src/acquire/media-mirror";
import type { ProviderChild } from "../src/acquire/recover";

const imageChild: ProviderChild = {
  childId: "image-1",
  ordinal: 0,
  modality: "image",
  sourceRef: "https://instagram.fbcdn.net/media.jpg?ephemeral=1",
};
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]);

function response(
  bytes: Uint8Array,
  options: { status?: number; headers?: Record<string, string> } = {}
) {
  return new Response(bytes, { status: options.status ?? 200, headers: options.headers });
}

describe("Instagram media mirror", () => {
  it("validates bytes, hashes them, and returns only the durable writer reference", async () => {
    const writeBytes = vi.fn(async () => ({
      objectRef: "gs://private-corpus/media/image-1.jpg",
      localPath: "/tmp/image-1.jpg",
    }));
    const fetch = vi.fn(async () => response(jpeg, { headers: { "content-type": "image/jpeg" } }));
    const mirror = createInstagramMediaMirror({ writeBytes, fetch, maxBytes: 100 });

    const result = await mirror.mirror(imageChild);

    expect(fetch).toHaveBeenCalledWith(
      new URL(imageChild.sourceRef),
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        signal: expect.any(AbortSignal),
      })
    );
    expect(writeBytes).toHaveBeenCalledWith({
      child: imageChild,
      bytes: jpeg,
      mimeType: "image/jpeg",
      checksum: createHash("sha256").update(jpeg).digest("hex"),
    });
    expect(result).toEqual({
      objectRef: "gs://private-corpus/media/image-1.jpg",
      checksum: createHash("sha256").update(jpeg).digest("hex"),
      localPath: "/tmp/image-1.jpg",
    });
    expect(result.objectRef).not.toBe(imageChild.sourceRef);
  });

  it("accepts allowlisted CDN redirects and blocks redirects off the allowlist", async () => {
    const redirectFetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(new Uint8Array(), {
          status: 302,
          headers: { location: "https://scontent.cdninstagram.com/media.jpg" },
        })
      )
      .mockResolvedValueOnce(response(jpeg));
    const mirror = createInstagramMediaMirror({
      writeBytes: async () => ({ objectRef: "gs://corpus/image.jpg" }),
      fetch: redirectFetch,
      maxBytes: 100,
    });
    await expect(mirror.mirror(imageChild)).resolves.toMatchObject({
      objectRef: "gs://corpus/image.jpg",
    });
    expect(redirectFetch).toHaveBeenCalledTimes(2);

    const blockedFetch = vi.fn(async () =>
      response(new Uint8Array(), {
        status: 302,
        headers: { location: "https://example.com/payload" },
      })
    );
    const blocked = createInstagramMediaMirror({
      writeBytes: async () => ({ objectRef: "gs://corpus/image.jpg" }),
      fetch: blockedFetch,
      maxBytes: 100,
    });
    await expect(blocked.mirror(imageChild)).rejects.toThrow("not allowlisted");
  });

  it("rejects non-HTTPS or non-CDN sources before fetching", async () => {
    const fetch = vi.fn();
    const mirror = createInstagramMediaMirror({
      writeBytes: async () => ({ objectRef: "gs://corpus/image.jpg" }),
      fetch,
      maxBytes: 100,
    });
    await expect(
      mirror.mirror({ ...imageChild, sourceRef: "http://instagram.fbcdn.net/a.jpg" })
    ).rejects.toThrow("not allowlisted");
    await expect(
      mirror.mirror({ ...imageChild, sourceRef: "https://evilfbcdn.net/a.jpg" })
    ).rejects.toThrow("not allowlisted");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enforces streamed byte caps and validates magic bytes against modality", async () => {
    const writeBytes = vi.fn(async () => ({ objectRef: "gs://corpus/media" }));
    const oversized = createInstagramMediaMirror({
      writeBytes,
      fetch: async () => response(new Uint8Array(16)),
      maxBytes: 8,
    });
    await expect(oversized.mirror(imageChild)).rejects.toThrow("byte cap");

    const wrongMime = createInstagramMediaMirror({
      writeBytes,
      fetch: async () => response(new Uint8Array([0, 1, 2, 3])),
      maxBytes: 100,
    });
    await expect(wrongMime.mirror(imageChild)).rejects.toThrow("unsupported file signature");
    await expect(wrongMime.mirror({ ...imageChild, modality: "video" })).rejects.toThrow(
      "unsupported file signature"
    );
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it("rejects ephemeral HTTP references returned by the writer", async () => {
    const mirror = createInstagramMediaMirror({
      writeBytes: async () => ({ objectRef: "https://cdn.example/media.jpg" }),
      fetch: async () => response(jpeg),
      maxBytes: 100,
    });
    await expect(mirror.mirror(imageChild)).rejects.toThrow("durable GCS object reference");
  });

  it("recognizes MP4 magic only for video children", async () => {
    const mp4 = new Uint8Array(16);
    mp4.set(new TextEncoder().encode("....ftypisom"));
    const mirror = createInstagramMediaMirror({
      writeBytes: async () => ({ objectRef: "gs://corpus/video.mp4" }),
      fetch: async () => response(mp4),
      maxBytes: 100,
    });
    await expect(mirror.mirror({ ...imageChild, modality: "video" })).resolves.toMatchObject({
      objectRef: "gs://corpus/video.mp4",
      checksum: createHash("sha256").update(mp4).digest("hex"),
    });
    await expect(mirror.mirror(imageChild)).rejects.toThrow("non-image bytes");
  });
});
