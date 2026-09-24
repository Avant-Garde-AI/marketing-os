import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createGcsWriters } from "../src/acquire/gcs-writer";
import type { RecoverySource } from "../src/acquire/recover";

const source: RecoverySource = {
  shortcode: "DTbusF1GO7X",
  accountHandle: "artist",
  postUrl: "https://www.instagram.com/p/DTbusF1GO7X/",
  expectedChildren: 2,
  metadataCapturedAt: "2026-09-01T00:00:00.000Z",
};
const mediaBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01, 0x02]);
const checksum = createHash("sha256").update(mediaBytes).digest("hex");

async function testRoot() {
  return mkdtemp(join(tmpdir(), "storyboard-gcs-writer-test-"));
}

describe("GCS evidence and media writers", () => {
  it("uploads raw provider evidence under the fixed prefix without exposing it in the object name", async () => {
    const root = await testRoot();
    const calls: Array<{ args: string[]; payload: Buffer; mode: number }> = [];
    try {
      const writers = createGcsWriters({
        prefix: "gs://arthaus-creative-corpus/research/storyboard/",
        localCacheDir: join(root, "cache"),
        tempDir: join(root, "tmp"),
        execFile: async (_command, args) => {
          const path = args[2]!;
          calls.push({
            args,
            payload: await readFile(path),
            mode: (await stat(path)).mode & 0o777,
          });
        },
      });
      const evidenceRef = await writers.writeRawResponse({
        source,
        response: [
          {
            shortCode: source.shortcode,
            caption: "private caption",
            mediaUrl: "https://cdn.example/x",
          },
        ],
        capturedAt: "2026-09-24T12:34:56.000Z",
      });

      expect(evidenceRef).toMatch(
        /^gs:\/\/arthaus-creative-corpus\/research\/storyboard\/posts\/DTbusF1GO7X\/evidence\/20260924T123456000Z-[a-f0-9]{64}\.json$/
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]!.args.slice(0, 2)).toEqual(["storage", "cp"]);
      expect(calls[0]!.args[3]).toBe(evidenceRef);
      expect(calls[0]!.mode).toBe(0o600);
      expect(calls[0]!.payload.toString("utf8")).toContain("private caption");
      expect(calls[0]!.args.join(" ")).not.toContain("cdn.example");
      expect(await readdir(join(root, "tmp"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores media by verified content hash and returns a private local cache path", async () => {
    const root = await testRoot();
    const calls: Array<{ args: string[]; payload: Buffer; mode: number }> = [];
    try {
      const writers = createGcsWriters({
        prefix: "gs://arthaus-creative-corpus/research/storyboard",
        localCacheDir: join(root, "cache"),
        tempDir: join(root, "tmp"),
        execFile: async (_command, args) => {
          calls.push({
            args,
            payload: await readFile(args[2]!),
            mode: (await stat(args[2]!)).mode & 0o777,
          });
        },
      });
      const result = await writers.writeBytes({
        child: {
          childId: "media-1",
          ordinal: 0,
          modality: "image",
          sourceRef: "https://instagram.fbcdn.net/media.jpg?secret=do-not-log",
        },
        bytes: mediaBytes,
        mimeType: "image/jpeg",
        checksum,
      });

      expect(result.objectRef).toBe(
        `gs://arthaus-creative-corpus/research/storyboard/media/${checksum}.jpg`
      );
      expect(result.localPath).toBe(join(root, "cache", "media", `${checksum}.jpg`));
      expect(await readFile(result.localPath!)).toEqual(Buffer.from(mediaBytes));
      expect((await stat(result.localPath!)).mode & 0o777).toBe(0o600);
      expect(calls[0]!.mode).toBe(0o600);
      expect(calls[0]!.payload).toEqual(Buffer.from(mediaBytes));
      expect(calls[0]!.args[3]).toBe(result.objectRef);
      expect(calls[0]!.args.join(" ")).not.toContain("secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe prefixes and checksum mismatches before upload", async () => {
    expect(() =>
      createGcsWriters({ prefix: "gs://bucket/research/../other", localCacheDir: "/tmp/cache" })
    ).toThrow("unsafe path component");
    expect(() => createGcsWriters({ prefix: "gs://bucket", localCacheDir: "/tmp/cache" })).toThrow(
      "bucket plus a non-empty object path"
    );

    const root = await testRoot();
    const execFile = vi.fn(async () => undefined);
    try {
      const writers = createGcsWriters({
        prefix: "gs://arthaus-creative-corpus/research/storyboard",
        localCacheDir: join(root, "cache"),
        tempDir: join(root, "tmp"),
        execFile,
      });
      await expect(
        writers.writeBytes({
          child: {
            childId: "media-1",
            ordinal: 0,
            modality: "image",
            sourceRef: "https://cdninstagram.com/x",
          },
          bytes: mediaBytes,
          mimeType: "image/jpeg",
          checksum: "0".repeat(64),
        })
      ).rejects.toThrow("checksum does not match");
      expect(execFile).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not surface command output or source data when upload fails", async () => {
    const root = await testRoot();
    try {
      const writers = createGcsWriters({
        prefix: "gs://arthaus-creative-corpus/research/storyboard",
        localCacheDir: join(root, "cache"),
        tempDir: join(root, "tmp"),
        execFile: async () => {
          throw new Error("token=secret https://cdn.example caption text");
        },
      });
      await expect(
        writers.writeRawResponse({
          source,
          response: { caption: "caption text" },
          capturedAt: "2026-09-24T00:00:00.000Z",
        })
      ).rejects.toThrow("GCS upload failed");
      expect(await readdir(join(root, "tmp"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defaults private staging under the caller cache", async () => {
    const root = await testRoot();
    try {
      let staged = "";
      const writers = createGcsWriters({
        prefix: "gs://arthaus-creative-corpus/research/storyboard",
        localCacheDir: join(root, "cache"),
        execFile: async (_command, args) => {
          staged = args[2]!;
        },
      });
      await writers.writeRawResponse({
        source,
        response: { ok: true },
        capturedAt: "2026-09-24T00:00:00.000Z",
      });
      expect(staged.startsWith(join(root, "cache", ".tmp"))).toBe(true);
      expect(await readdir(join(root, "cache", ".tmp"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
