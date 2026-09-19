import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JsonlLedger,
  countedPostIds,
  runExtraction,
  type Acquisition,
  type Extractor,
  type PostInput,
} from "../src/index";

const post = (over: Partial<PostInput> = {}): PostInput => ({
  postId: "post-1",
  format: "carousel",
  caption: "caption",
  media: [
    { ref: "m0", kind: "image", ordinal: 0 },
    { ref: "m1", kind: "image", ordinal: 1 },
  ],
  ...over,
});
const acquirer: Acquisition = { acquire: async (m) => ({ bytes: Buffer.from(m.ref) }) };
function extractor(
  seen: { posts: number; attached: number } = { posts: 0, attached: 0 }
): Extractor {
  return {
    model: "fake",
    version: "1",
    promptHash: "prompt-1",
    extract: async (p) => {
      seen.posts++;
      seen.attached += p.media.length;
      return {
        observations: p.media.map((m) => ({
          mediaRef: m.ref,
          ordinal: m.ordinal,
          role: "beat",
          observation: `visible ${m.ref}`,
          visibleTreatment: "image",
          ...(m.ordinal ? { transition: { change: "changes", why: "continue" } } : {}),
        })),
        narrativeMechanism: "reveal",
        continuity: [],
      };
    },
  };
}
async function ledger(): Promise<JsonlLedger> {
  const d = await mkdtemp(join(tmpdir(), "storyboard-corpus-"));
  return new JsonlLedger(join(d, "run.jsonl"));
}

describe("storyboard corpus extraction", () => {
  it("passes a whole ordered carousel with every attachment to one extractor call", async () => {
    const seen = { posts: 0, attached: 0 },
      out = await runExtraction([post()], {
        runId: "r",
        ledger: await ledger(),
        acquisition: acquirer,
        extractor: extractor(seen),
      });
    expect(out[0]?.status).toBe("extracted");
    expect(seen).toEqual({ posts: 1, attached: 2 });
    expect(
      (out[0]?.output as { observations: { ordinal: number }[] }).observations.map((x) => x.ordinal)
    ).toEqual([0, 1]);
  });
  it("rejects caption-only pseudo-vision and retains the failure", async () => {
    const l = await ledger();
    const bad: Extractor = {
      model: "fake",
      version: "1",
      promptHash: "p",
      extract: async () => ({
        observations: [],
        narrativeMechanism: "caption says it all",
        continuity: [],
      }),
    };
    const out = await runExtraction([post()], {
      runId: "r",
      ledger: l,
      acquisition: acquirer,
      extractor: bad,
    });
    expect(out[0]?.status).toBe("extraction-failed");
    expect(out[0]?.error).toBe("extraction failed");
    expect((await l.rows()).some((r) => r.status === "extraction-failed")).toBe(true);
  });
  it("does not extract an incomplete carousel", async () => {
    let calls = 0;
    const badAcq: Acquisition = {
      acquire: async (m) => {
        calls++;
        if (m.ref === "m1") throw new Error("expired");
        return { bytes: Buffer.from(m.ref) };
      },
    };
    const out = await runExtraction([post()], {
      runId: "r",
      ledger: await ledger(),
      acquisition: badAcq,
      extractor: extractor(),
    });
    expect(out[0]?.status).toBe("incomplete");
    expect(calls).toBe(2);
  });
  it("requires temporal coverage for video and never accepts a poster as the sequence", async () => {
    const video: PostInput = {
      postId: "v",
      format: "video",
      media: [
        { ref: "v0", kind: "video-sample", ordinal: 0, sampleTimeSeconds: 0 },
        { ref: "v1", kind: "video-sample", ordinal: 1, sampleTimeSeconds: 2 },
      ],
    };
    const noCoverage: Extractor = {
      ...extractor(),
      extract: async (p) => ({
        observations: p.media.map((m) => ({
          mediaRef: m.ref,
          ordinal: m.ordinal,
          role: "beat",
          observation: "frame",
          visibleTreatment: "motion",
          sampleTimeSeconds: m.sampleTimeSeconds,
          ...(m.ordinal ? { transition: { change: "changes", why: "continue" } } : {}),
        })),
        narrativeMechanism: "sequence",
        continuity: [],
      }),
    };
    const out = await runExtraction([video], {
      runId: "r",
      ledger: await ledger(),
      acquisition: acquirer,
      extractor: noCoverage,
    });
    expect(out[0]?.status).toBe("extraction-failed");
    expect(out[0]?.error).toMatch(/temporal sample coverage/);
  });
  it("resumes only when media and extractor hashes still match", async () => {
    const l = await ledger(),
      seen = { posts: 0, attached: 0 },
      x = extractor(seen);
    await runExtraction([post()], { runId: "r", ledger: l, acquisition: acquirer, extractor: x });
    await runExtraction([post()], { runId: "r", ledger: l, acquisition: acquirer, extractor: x });
    expect(seen.posts).toBe(1);
    await runExtraction([post({ caption: "changed" })], {
      runId: "r",
      ledger: l,
      acquisition: acquirer,
      extractor: x,
    });
    expect(seen.posts).toBe(2);
  });
  it("counts unique successful posts rather than frames or repeated ledger rows", async () => {
    const rows = await runExtraction([post({ postId: "a" })], {
      runId: "r",
      ledger: await ledger(),
      acquisition: acquirer,
      extractor: extractor(),
    });
    expect(countedPostIds([...rows, ...rows])).toEqual(["a"]);
    expect(
      countedPostIds([...rows, { ...rows[0]!, status: "extraction-failed", validated: false }])
    ).toEqual([]);
  });
  it("supports bounded maxPosts and concurrency one by default", async () => {
    const seen = { posts: 0, attached: 0 },
      out = await runExtraction([post(), post({ postId: "post-2" })], {
        runId: "r",
        ledger: await ledger(),
        acquisition: acquirer,
        extractor: extractor(seen),
        maxPosts: 1,
      });
    expect(out).toHaveLength(1);
    expect(seen.posts).toBe(1);
  });
  it("keeps three-run resume stable and reprocesses changed bytes, version, or prompt", async () => {
    const l = await ledger(),
      seen = { posts: 0, attached: 0 },
      x = extractor(seen);
    await runExtraction([post()], { runId: "r", ledger: l, acquisition: acquirer, extractor: x });
    await runExtraction([post()], { runId: "r", ledger: l, acquisition: acquirer, extractor: x });
    await runExtraction([post()], { runId: "r", ledger: l, acquisition: acquirer, extractor: x });
    expect(seen.posts).toBe(1);
    const changedBytes: Acquisition = {
      acquire: async (m) => ({ bytes: Buffer.from(`${m.ref}-changed`) }),
    };
    await runExtraction([post()], {
      runId: "r",
      ledger: l,
      acquisition: changedBytes,
      extractor: x,
    });
    await runExtraction([post()], {
      runId: "r",
      ledger: l,
      acquisition: changedBytes,
      extractor: { ...x, version: "2" },
    });
    await runExtraction([post()], {
      runId: "r",
      ledger: l,
      acquisition: changedBytes,
      extractor: { ...x, promptHash: "prompt-2" },
    });
    expect(seen.posts).toBe(4);
    const rows = await l.rows();
    expect(rows.filter((r) => r.status === "ready")).toHaveLength(4);
  });
  it("retains a retryable failure, retries it, excludes malformed output from counts, and keeps valid posts", async () => {
    const l = await ledger(),
      bad: Extractor = {
        ...extractor(),
        extract: async () => {
          throw Object.assign(new Error("secret provider body"), {
            diagnostics: { provider: "vertex", retryable: true, usage: { inputTokens: 4 } },
          });
        },
      };
    const failed = await runExtraction([post()], {
      runId: "r",
      ledger: l,
      acquisition: acquirer,
      extractor: bad,
    });
    expect(failed[0]?.status).toBe("extraction-failed");
    expect(failed[0]?.error).toBe("provider request failed");
    expect(failed[0]?.diagnostics).toMatchObject({
      provider: "vertex",
      retryable: true,
      usage: { inputTokens: 4 },
    });
    expect(
      (
        await runExtraction([post()], {
          runId: "r",
          ledger: l,
          acquisition: acquirer,
          extractor: extractor(),
        })
      )[0]?.status
    ).toBe("extracted");
    const l2 = await ledger(),
      malformed = { ...post({ postId: "bad" }), media: [] };
    const good = await runExtraction([malformed, post({ postId: "good" })], {
      runId: "r2",
      ledger: l2,
      acquisition: acquirer,
      extractor: extractor(),
    });
    expect(good.map((r) => r.status)).toEqual(["extraction-failed", "extracted"]);
    expect(countedPostIds(await l2.rows())).toEqual(["good"]);
  });
});

it("does not count a forged validated flag with an empty extraction", () => {
  expect(
    countedPostIds([
      {
        runId: "r",
        postId: "fake",
        status: "extracted",
        inputHash: "h",
        updatedAt: "now",
        attempt: 1,
        validated: true,
        output: {},
      },
    ])
  ).toEqual([]);
});
