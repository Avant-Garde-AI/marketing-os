import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main, parseArgs, type CliDependencies } from "../src/cli";
import type { PostInput } from "../src/index";

const post: PostInput = {
  postId: "p-1",
  format: "single",
  media: [{ ref: "m-1", kind: "image", ordinal: 0, localPath: "/tmp/pixel.png" }],
  caption: "private source text",
};
const args = [
  "--manifest",
  "manifest.json",
  "--out",
  "ledger.jsonl",
  "--run-id",
  "pilot-1",
  "--project",
  "demo-project",
  "--model",
  "gemini-test",
  "--max-posts",
  "1",
];

describe("corpus pilot CLI", () => {
  it("requires explicit bounded execution flags and supplies stable defaults", () => {
    expect(parseArgs(args)).toMatchObject({
      manifest: "manifest.json",
      out: "ledger.jsonl",
      runId: "pilot-1",
      maxPosts: 1,
      maxOutputTokens: 4096,
      timeoutMs: 180000,
      execute: false,
    });
    expect(() => parseArgs(args.filter((x) => x !== "--max-posts" && x !== "1"))).toThrow(
      /max-posts.*required/
    );
    expect(() => parseArgs([...args, "--max-posts", "0"])).toThrow(/positive safe integer/);
    expect(() => parseArgs([...args, "--max-output-tokens", "255"])).toThrow(/256–8192/);
    expect(() => parseArgs([...args, "--max-output-tokens", "8193"])).toThrow(/256–8192/);
    expect(() => parseArgs([...args, "--timeout-ms", "999"])).toThrow(/1000–180000/);
    expect(() => parseArgs([...args, "--timeout-ms", "180001"])).toThrow(/1000–180000/);
  });

  it("dry-runs without acquiring auth, invoking a model, or printing source content", async () => {
    const token = vi.fn(async () => "secret-token");
    const createExtractor = vi.fn(() => {
      throw new Error("model must not be created");
    });
    const lines: string[] = [];
    const result = await main(args, {
      readManifest: async () => [post],
      mediaReady: async () => true,
      accessToken: token,
      createExtractor,
      print: (line) => lines.push(line),
    });
    expect(result).toMatchObject({
      mode: "dry-run",
      selectedPosts: 1,
      selectedMedia: 1,
      validPosts: 1,
      readyPosts: 1,
      readyMedia: 1,
    });
    expect(token).not.toHaveBeenCalled();
    expect(createExtractor).not.toHaveBeenCalled();
    expect(lines.join("\n")).not.toContain("private source text");
  });

  it("executes only through injected runner and keeps credentials in the token callback", async () => {
    const runner = vi.fn(
      async (posts: unknown[], options: { extractor: { model: string }; maxPosts?: number }) => {
        expect(posts).toEqual([post]);
        expect(options.maxPosts).toBe(1);
        expect(options.extractor.model).toBe("gemini-test");
        return [
          {
            runId: "pilot-1",
            postId: "p-1",
            status: "extracted",
            inputHash: "hash",
            updatedAt: "now",
            attempt: 1,
            validated: true,
            output: {},
          },
        ];
      }
    );
    const createExtractor = vi.fn((options: { model: string }) => ({
      model: options.model,
      version: "test",
      promptHash: "test",
      extract: async () => {
        throw new Error("unused");
      },
    }));
    const deps: CliDependencies = {
      readManifest: async () => [post],
      mediaReady: async () => true,
      accessToken: async () => "secret-token",
      createExtractor,
      runExtraction: runner as CliDependencies["runExtraction"],
      print: () => {},
    };
    const result = await main([...args, "--execute"], deps);
    expect(result.mode).toBe("execute");
    expect(runner).toHaveBeenCalledOnce();
    expect(createExtractor).toHaveBeenCalledOnce();
  });

  it("reports invalid and unresolved media without exposing manifest content", async () => {
    const lines: string[] = [];
    const result = await main(args, {
      readManifest: async () => [
        post,
        { postId: "bad", format: "single", media: [] },
        {
          postId: "private",
          format: "single",
          caption: "do not print",
          media: [{ ref: "m", kind: "image", ordinal: 0 }],
        },
      ],
      mediaReady: async () => false,
      print: (line) => lines.push(line),
    });
    expect(result).toMatchObject({ selectedPosts: 1, validPosts: 1, readyPosts: 0, readyMedia: 0 });
    expect(lines.join("\n")).not.toContain("do not print");
  });

  it("requires local media to be regular nonempty files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "corpus-cli-"));
    const empty = join(directory, "empty.png");
    await writeFile(empty, "");
    const manifest = { ...post, media: [{ ...post.media[0]!, localPath: empty }] };
    const result = await main(args, { readManifest: async () => [manifest], print: () => {} });
    expect(result.readyPosts).toBe(0);
    expect(result.readyMedia).toBe(0);
    const directoryResult = await main(args, {
      readManifest: async () => [{ ...post, media: [{ ...post.media[0]!, localPath: directory }] }],
      print: () => {},
    });
    expect(directoryResult.readyPosts).toBe(0);
  });

  it("sanitizes malformed manifest JSON errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "corpus-cli-json-"));
    const malformed = join(directory, "manifest.json");
    await writeFile(malformed, '{"caption":"private caption",');
    try {
      await main(
        args.map((arg) => (arg === "manifest.json" ? malformed : arg)),
        { print: () => {} }
      );
      throw new Error("expected malformed manifest to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("manifest must contain valid JSON");
      expect((error as Error).message).not.toContain("private caption");
    }
  });
});
