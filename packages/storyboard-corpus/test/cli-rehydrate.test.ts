import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { mainRehydrate, parseRehydrateArgs } from "../src/cli-rehydrate";

const prefix = "gs://private-bucket/instagram-organic/2026-09-24/recovery-v2";
const args = (root: string) => ["--prefix", prefix, "--shortcodes", "abc", "--cache-dir", join(root, "cache"), "--out", join(root, "manifest.json"), "--max-bytes", "1024"];

describe("stored candidate rehydration CLI", () => {
  it("requires explicit bounded GCS input and does not read on dry-run", async () => {
    const root = await mkdtemp(join(tmpdir(), "rehydrate-cli-"));
    try {
      const result = await mainRehydrate(args(root), { readCandidate: async () => { throw new Error("unexpected GCS read"); }, print: () => {} });
      expect(result).toEqual({ mode: "dry-run", selected: 1, ready: 0 });
      expect(() => parseRehydrateArgs([...args(root), "--shortcodes", "a,b,c,d"])).toThrow();
      expect(() => parseRehydrateArgs([...args(root).slice(0, -1), "0"])).toThrow("max-bytes");
      expect(() => parseRehydrateArgs(["--prefix", "gs://other/../escape", ...args(root).slice(2)])).toThrow("prefix");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("checks candidate origin before media download and writes a private local manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "rehydrate-cli-"));
    try {
      const executeArgs = [...args(root), "--execute"];
      await expect(mainRehydrate(executeArgs, {
        readCandidate: async () => ({ snapshotRef: "gs://other-bucket/posts/abc/snapshot.json" }),
        rehydrate: async () => { throw new Error("unexpected media download"); }, print: () => {},
      })).rejects.toThrow("identity mismatch");

      const candidate = { snapshotRef: `${prefix}/posts/abc/snapshot.json`, snapshot: { source: { postId: "instagram:abc" } } };
      const result = await mainRehydrate(executeArgs, {
        readCandidate: async (ref) => { expect(ref).toBe(`${prefix}/posts/abc/candidate.json`); return candidate; },
        rehydrate: async (raw, options) => {
          expect(raw).toEqual([candidate]);
          expect(options.maxPosts).toBe(1);
          expect(options.maxBytes).toBe(1024);
          return [candidate as never];
        },
        print: () => {},
      });
      expect(result.ready).toBe(1);
      expect(JSON.parse(await readFile(result.out!, "utf8"))).toEqual([candidate]);
      expect((await stat(result.out!)).mode & 0o777).toBe(0o600);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
