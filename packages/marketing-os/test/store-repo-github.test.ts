import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitHubStoreRepo } from "../templates/agents/lib/store-repo/github";

const path = "social/production/sources/large.jpeg.b64";
const apiUrl = `https://api.github.com/repos/Arthaus-Inc/marketplace/contents/${path}?ref=main`;
const raw = "a".repeat(1_200_000);
const blobSha = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
const metadata = (overrides: Record<string, unknown> = {}) => ({
  type: "file", encoding: "none", size: Buffer.byteLength(raw), content: "", sha: blobSha(raw),
  download_url: "https://evil.example/untrusted", ...overrides,
});
const repo = () => createGitHubStoreRepo({ repo: "Arthaus-Inc/marketplace", branch: "main", token: "test-token" });

afterEach(() => vi.unstubAllGlobals());

describe("GitHub Contents large-file reads", () => {
  it("reads encoding:none through the same bounded raw Contents URL and caches content with its blob SHA", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return calls.length === 1 ? Response.json(metadata()) : new Response(raw, { headers: { "content-length": String(raw.length) } });
    });
    const bound = repo();
    expect(await bound.readFile(path)).toBe(raw);
    expect(await bound.readFile(path)).toBe(raw);
    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.url)).toEqual([apiUrl, apiUrl]);
    expect(calls[0]!.init.headers).toMatchObject({ Accept: "application/vnd.github+json" });
    expect(calls[1]!.init.headers).toMatchObject({ Accept: "application/vnd.github.raw+json" });
    expect(calls[1]!.init.redirect).toBe("error");
    expect(calls[1]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls.every(call => call.url !== "https://evil.example/untrusted")).toBe(true);
  });

  it("preserves the metadata blob SHA for a subsequent update", async () => {
    let puts = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (init.method === "PUT") {
        puts++;
        expect(JSON.parse(String(init.body))).toMatchObject({ sha: blobSha(raw), branch: "main" });
        return Response.json({ content: { sha: "next-sha" } });
      }
      return (init.headers as Record<string, string>).Accept === "application/vnd.github.raw+json"
        ? new Response(raw) : Response.json(metadata());
    });
    await repo().writeFile(path, "replacement");
    expect(puts).toBe(1);
  });

  it("keeps the small base64 Contents response behavior", async () => {
    const small = "A small artifact.\n";
    const fetch = vi.fn(async () => Response.json({ type: "file", encoding: "base64", sha: blobSha(small),
      content: Buffer.from(small).toString("base64").replace(/(.{8})/g, "$1\n") }));
    vi.stubGlobal("fetch", fetch);
    expect(await repo().readFile("social/note.md")).toBe(small);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed on unsupported encoding or oversized metadata without a raw request", async () => {
    const fetch = vi.fn(async () => Response.json(metadata({ encoding: "gzip" })));
    vi.stubGlobal("fetch", fetch);
    await expect(repo().readFile(path)).rejects.toThrow(/Unsupported GitHub file encoding/);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => Response.json(metadata({ size: 8 * 1024 * 1024 + 1 })));
    await expect(repo().readFile(path)).rejects.toThrow(/read limit/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects truncated, oversized, and wrong-blob raw bodies", async () => {
    for (const body of [raw.slice(1), raw + "x", "b".repeat(raw.length)]) {
      let calls = 0;
      vi.stubGlobal("fetch", async () => ++calls === 1 ? Response.json(metadata()) : new Response(body));
      await expect(repo().readFile(path)).rejects.toThrow(/size mismatch|too large|blob SHA mismatch/);
      expect(calls).toBe(2);
    }
  });
});

describe("GitHub Contents writes racing the branch head", () => {
  const file = "email/campaigns/c/campaign.md";
  const small = (text: string, sha: string) =>
    Response.json({ type: "file", encoding: "base64", sha, content: Buffer.from(text).toString("base64") });
  const branchMoved = () =>
    Response.json({ message: "is at aaa but expected bbb", status: "409" }, { status: 409 });

  /** Serve reads from `reads` in order (last one repeats) and PUTs from `puts`. */
  function stub(reads: Array<() => Response>, puts: Array<() => Response>) {
    const seen = { reads: 0, puts: [] as Record<string, unknown>[] };
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
      if (init.method === "PUT") {
        seen.puts.push(JSON.parse(String(init.body)));
        return puts[Math.min(seen.puts.length - 1, puts.length - 1)]!();
      }
      return reads[Math.min(seen.reads++, reads.length - 1)]!();
    });
    return seen;
  }

  beforeEach(() => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0; }) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("retries a 409 caused by another file's commit and lands the write", async () => {
    const seen = stub([() => small("status: approved\n", "sha-a")], [branchMoved, () => Response.json({ content: { sha: "sha-b" } })]);
    await repo().writeFile(file, "status: drafted\n");
    expect(seen.puts).toHaveLength(2);
    expect(seen.puts.every((p) => p.sha === "sha-a")).toBe(true);
  });

  it("refuses to overwrite when the same file changed underneath it", async () => {
    const seen = stub(
      [() => small("status: approved\n", "sha-a"), () => small("status: held\n", "sha-other")],
      [branchMoved],
    );
    await expect(repo().writeFile(file, "status: drafted\n")).rejects.toThrow(/another writer changed this file/);
    expect(seen.puts).toHaveLength(1);
  });

  it("stops without a commit when the competing write already holds this content", async () => {
    const seen = stub(
      [() => small("status: approved\n", "sha-a"), () => small("status: drafted\n", "sha-other")],
      [branchMoved],
    );
    await repo().writeFile(file, "status: drafted\n");
    expect(seen.puts).toHaveLength(1);
  });

  it("gives up loudly when the branch never settles", async () => {
    const seen = stub([() => small("status: approved\n", "sha-a")], [branchMoved]);
    await expect(repo().writeFile(file, "status: drafted\n")).rejects.toThrow(/GitHub write failed \(409\)/);
    expect(seen.puts).toHaveLength(6);
  });
});
