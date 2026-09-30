import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeVerifiedLoopExport,
  parseLoopExportManifest,
  parseLoopExportRange,
} from "../templates/agents/lib/social/generation-export";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const job = {
  artifactId: "passion-flower-loop-pilot-v4",
  postId: "2026-10-instagram-01",
  inputHash: "a".repeat(64),
};

function fixture() {
  const reelBytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom-reel-export")]);
  const feedBytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom-feed-export")]);
  const manifest = {
    schemaVersion: 1,
    ...job,
    source: {
      filename: "provider-loop.mp4", sha256: "b".repeat(64), codec: "h264",
      width: 720, height: 1280, frameRate: "24/1", durationSec: 5.041667,
      sourceUpscaled: true, note: "Provider output is 720x1280; final variants are Lanczos upscales.",
    },
    exports: [
      { variant: "reel", filename: `${job.artifactId}-reel.mp4`, sha256: hash(reelBytes), bytes: reelBytes.length,
        codec: "h264", pixelFormat: "yuv420p", width: 1080, height: 1920, frameRate: "24/1", durationSec: 5.041667,
        fit: "full-frame scale; no crop; source aspect ratio retained" },
      { variant: "feed", filename: `${job.artifactId}-feed.mp4`, sha256: hash(feedBytes), bytes: feedBytes.length,
        codec: "h264", pixelFormat: "yuv420p", width: 1080, height: 1350, frameRate: "24/1", durationSec: 5.041667,
        fit: "contain with #f4f3ee side padding; no crop; full source frame retained" },
    ],
  };
  return { manifest, reelBytes, feedBytes };
}

describe("verified loop export", () => {
  it("accepts a matching receipt while preserving the recorded source upscale facts", () => {
    const { manifest } = fixture();
    const parsed = parseLoopExportManifest(JSON.stringify(manifest), job);
    expect(parsed.manifest.source).toMatchObject({ width: 720, height: 1280, sourceUpscaled: true });
    expect(parsed.entries.get("reel")).toMatchObject({ width: 1080, height: 1920 });
  });

  it("supports other honest source metadata instead of baking this pilot's source into core", () => {
    const { manifest } = fixture();
    const generalReceipt = { ...manifest, source: { ...manifest.source, filename: "native-loop.mp4",
      width: 1440, height: 2560, sourceUpscaled: false } };
    expect(parseLoopExportManifest(JSON.stringify(generalReceipt), job).manifest.source)
      .toMatchObject({ width: 1440, height: 2560, sourceUpscaled: false });
  });

  it("rejects receipts bound to a different artifact, post, or input hash", () => {
    const { manifest } = fixture();
    for (const changed of [
      { ...job, artifactId: "another-loop" },
      { ...job, postId: "another-post" },
      { ...job, inputHash: "c".repeat(64) },
    ]) expect(() => parseLoopExportManifest(JSON.stringify(manifest), changed)).toThrow();
  });

  it("checks decoded MP4 signature and exact content hash", () => {
    const { manifest, reelBytes } = fixture();
    const { entries } = parseLoopExportManifest(JSON.stringify(manifest), job);
    const reel = entries.get("reel")!;
    expect(decodeVerifiedLoopExport(reelBytes.toString("base64"), reel)).toEqual(reelBytes);
    const changed = Buffer.from(reelBytes); changed[changed.length - 1] ^= 1;
    expect(() => decodeVerifiedLoopExport(changed.toString("base64"), reel)).toThrow();
    expect(() => decodeVerifiedLoopExport(Buffer.from("not an mp4").toString("base64"), reel)).toThrow();
  });

  it("rejects a receipt that claims the wrong Instagram target dimensions", () => {
    const { manifest } = fixture();
    const wrong = { ...manifest, exports: manifest.exports.map((entry) => entry.variant === "feed"
      ? { ...entry, width: 1080, height: 1920 } : entry) };
    expect(() => parseLoopExportManifest(JSON.stringify(wrong), job)).toThrow();
  });

  it("parses single byte ranges and rejects malformed or unsatisfiable ranges", () => {
    expect(parseLoopExportRange(null, 100)).toBeNull();
    expect(parseLoopExportRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseLoopExportRange("bytes=95-", 100)).toEqual({ start: 95, end: 99 });
    expect(parseLoopExportRange("bytes=-8", 100)).toEqual({ start: 92, end: 99 });
    expect(parseLoopExportRange("bytes=0-999", 100)).toEqual({ start: 0, end: 99 });
    expect(parseLoopExportRange("bytes=100-", 100)).toBe(false);
    expect(parseLoopExportRange("bytes=10-5", 100)).toBe(false);
    expect(parseLoopExportRange("bytes=0-1,3-4", 100)).toBe(false);
  });
});
