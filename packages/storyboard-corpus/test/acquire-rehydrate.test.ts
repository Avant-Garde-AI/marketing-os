import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { rehydrateCandidates } from "../src/acquire/rehydrate";
import { recoverCarousel } from "../src/acquire/recover";

const bytes = Buffer.from("offline image fixture");
const checksum = createHash("sha256").update(bytes).digest("hex");
const ref = (extension = "jpg") => `gs://private-bucket/research/storyboard/media/${checksum}.${extension}`;

async function candidate() {
  const recovered = await recoverCarousel(
    { shortcode: "abc", accountHandle: "artist", postUrl: "https://www.instagram.com/p/abc/", expectedChildren: 2, metadataCapturedAt: "2026-09-01T00:00:00.000Z" },
    { fetchPost: async () => ({ shortcode: "abc", accountHandle: "artist", children: [0, 1].map((ordinal) => ({ childId: `c${ordinal}`, ordinal, modality: "image" as const, sourceRef: `provider:${ordinal}` })), orderEvidenceRef: "provider-run:1" }) },
    { mirror: async () => ({ objectRef: ref(), checksum }) }
  );
  return { snapshotRef: "gs://private-bucket/research/storyboard/posts/abc/snapshot.json", snapshot: recovered.snapshot, caption: "Private caption" };
}

describe("GCS candidate rehydration", () => {
  it("downloads content-addressed images, verifies hashes, and hydrates private local paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "storyboard-rehydrate-"));
    try {
      const calls: string[][] = [];
      const result = await rehydrateCandidates([await candidate()], {
        localCacheDir: join(root, "cache"), maxPosts: 1, maxBytes: 1024,
        execFile: async (_command, args) => { calls.push(args); await (await import("node:fs/promises")).writeFile(args[3]!, bytes, { mode: 0o600 }); },
      });
      expect(result[0]!.snapshot.media.actual.map((item) => item.localPath)).toHaveLength(2);
      expect(result[0]!.snapshot.media.actual[0]!.localPath).toBe(result[0]!.snapshot.media.actual[1]!.localPath);
      expect(await readFile(result[0]!.snapshot.media.actual[0]!.localPath!)).toEqual(bytes);
      expect((await stat(result[0]!.snapshot.media.actual[0]!.localPath!)).mode & 0o777).toBe(0o600);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.slice(0, 2)).toEqual(["storage", "cp"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects candidate count, byte, checksum, object path, bucket, and modality violations", async () => {
    const root = await mkdtemp(join(tmpdir(), "storyboard-rehydrate-"));
    const valid = await candidate();
    const opts = { localCacheDir: join(root, "cache"), maxPosts: 1, maxBytes: 1024, execFile: async (_c: string, args: string[]) => { await (await import("node:fs/promises")).writeFile(args[3]!, bytes); } };
    try {
      await expect(rehydrateCandidates([valid, valid], opts)).rejects.toThrow("maxPosts");
      await expect(rehydrateCandidates([valid], { ...opts, maxBytes: 2 })).rejects.toThrow("maxBytes");
      const badChecksum = structuredClone(valid);
      badChecksum.snapshot.media.actual[0]!.checksum = "0".repeat(64);
      await expect(rehydrateCandidates([badChecksum], opts)).rejects.toThrow("content-addressed");
      const escaped = structuredClone(valid);
      escaped.snapshot.media.actual[0]!.objectRef = `gs://other-bucket/research/storyboard/media/${checksum}.jpg`;
      await expect(rehydrateCandidates([escaped], opts)).rejects.toThrow("bucket");
      const mixed = structuredClone(valid);
      mixed.snapshot.media.expected[0]!.modality = "video";
      await expect(rehydrateCandidates([mixed], opts)).rejects.toThrow("image-only");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects bytes that do not match the manifest checksum", async () => {
    const root = await mkdtemp(join(tmpdir(), "storyboard-rehydrate-"));
    try {
      await expect(rehydrateCandidates([await candidate()], {
        localCacheDir: join(root, "cache"), maxPosts: 1, maxBytes: 1024,
        execFile: async (_c, args) => { await (await import("node:fs/promises")).writeFile(args[3]!, "corrupt"); },
      })).rejects.toThrow("checksum mismatch");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
