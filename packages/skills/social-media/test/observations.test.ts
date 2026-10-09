import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@avant-garde/skill-kit";
import { InstagramReadRejected, measureFrameDifferences, observationPath, observationSchema,
  postCreativeHash, postMediaHash, readInstagramOutcomes, readPostObservations, type PostObservation } from "../src/observations";
import type { SocialPost } from "../src/types";

const sha = (letter: string) => letter.repeat(64);
const now = new Date("2026-10-09T18:00:00Z");
const post = { id: "loop", channel: "instagram", channelAccount: { id: "12", username: "store" },
  copy: "A night wind.", targetLink: "https://store.example", status: "published", body: "", assetRefs: [], provenance: [],
  platform: { id: "123", permalink: "https://instagram.example/123", publishedAt: "2026-10-09T15:00:00Z" },
  renderedVideo: { version: 1, storyboardId: "s", storyboardHash: sha("a"), reviewHash: sha("b"), sources: [],
    video: { url: "https://store.example/video.mp4", sha256: sha("c"), mimeType: "video/mp4", width: 1080, height: 1920, durationMs: 5000 },
    poster: { url: "https://store.example/poster.jpeg", sha256: sha("d"), width: 1080, height: 1920 } },
} as SocialPost;
const unavailable = { status: "unavailable", reason: "not-returned" } as const;
const record = (): PostObservation => ({ schemaVersion: 1, postId: post.id, observedAt: now.toISOString(),
  mediaHash: postMediaHash(post), creativeHash: postCreativeHash(post),
  motion: { method: "grayscale-frame-difference-v1", videoSha256: sha("c"), width: 1080, height: 1920,
    durationMs: 5000, sampleWidth: 160, sampleHeight: 284, sampleFps: 6, frames: 30,
    meanStepPercent: 0.2, maxStepPercent: 0.8, firstLastPercent: 1.5, littleChangeThresholdPercent: 0.25 },
  outcomes: { platformId: "123", publishedAt: post.platform!.publishedAt, ageHours: 3, period: "lifetime", source: "instagram-graph",
    metrics: { views: { status: "available", value: 0 }, reach: unavailable, saves: unavailable, shares: unavailable,
      likes: unavailable, comments: unavailable, averageWatchTimeMs: unavailable } },
});
const repoFor = (value: PostObservation) => createMemoryRepo({ [observationPath(value)]: JSON.stringify(value) });

describe("post observation bindings", () => {
  it("retains media diagnostics after copy/time changes but excludes prior-copy outcomes", async () => {
    const value = record(), repo = repoFor(value);
    const edited = { ...post, copy: "A new caption.", scheduledAt: "2026-10-10T15:00:00Z" };
    expect(postMediaHash(edited)).toBe(postMediaHash(post));
    expect(postCreativeHash({ ...post, scheduledAt: edited.scheduledAt })).toBe(postCreativeHash(post));
    const read = await readPostObservations(repo, edited, now);
    expect(read.motion).toEqual(value);
    expect(read.outcomes).toBeNull();
  });
  it("refuses diagnostics/outcomes for changed media or a different publication", async () => {
    const repo = repoFor(record());
    const replaced = { ...post, renderedVideo: { ...post.renderedVideo!, video: { ...post.renderedVideo!.video, sha256: sha("e") } } };
    expect(await readPostObservations(repo, replaced, now)).toMatchObject({ motion: null, outcomes: null, historical: 1 });
    const republished = { ...post, platform: { ...post.platform!, id: "456" } };
    expect(await readPostObservations(repo, republished, now)).toMatchObject({ outcomes: null });
  });
  it("keeps ordered carousel identity and isolates posts", async () => {
    const sequence = { ...post, renderedVideo: undefined, renderedSequence: { version: 1,
      storyboardId: "s", storyboardHash: sha("a"), reviewHash: sha("b"), slides: [
        { beatId: "a", boardName: "a", url: "https://store.example/a", sha256: sha("a"), width: 1080, height: 1350 },
        { beatId: "b", boardName: "b", url: "https://store.example/b", sha256: sha("b"), width: 1080, height: 1350 },
      ] } } as SocialPost;
    expect(postMediaHash({ ...sequence, renderedSequence: { ...sequence.renderedSequence!, slides: [...sequence.renderedSequence!.slides].reverse() } })).not.toBe(postMediaHash(sequence));
    expect(await readPostObservations(repoFor(record()), { ...post, id: "another" }, now)).toMatchObject({ motion: null, outcomes: null });
  });
  it("flags tampering, malformed records and future timestamps instead of presenting them as current", async () => {
    const value = record(), repo = repoFor(value);
    repo.files.set(observationPath(value), JSON.stringify({ ...value, motion: { ...value.motion, firstLastPercent: 0 } }));
    expect(await readPostObservations(repo, post, now)).toMatchObject({ motion: null, unreadable: 1 });
    const future = { ...record(), outcomes: undefined, observedAt: "2026-10-10T18:00:00Z" };
    expect(await readPostObservations(repoFor(future), post, now)).toMatchObject({ motion: null, unreadable: 1 });
  });
  it("disallows fake missing-metric zeros, traversal, empty evidence and unknown approval fields", () => {
    expect(() => observationSchema.parse({ ...record(), postId: "../other" })).toThrow();
    expect(() => observationSchema.parse({ ...record(), outcomes: undefined, motion: undefined })).toThrow();
    expect(() => observationSchema.parse({ ...record(), approved: true })).toThrow();
    expect(() => observationSchema.parse({ ...record(), outcomes: { ...record().outcomes!, ageHours: 99 } })).toThrow();
    const value = record(); value.outcomes!.metrics.reach = { status: "unavailable", reason: "not-returned", value: 0 } as never;
    expect(() => observationSchema.parse(value)).toThrow();
  });
});

describe("observed frame change", () => {
  it("distinguishes static frames from changed frames without inventing creative approval", () => {
    expect(measureFrameDifferences(Uint8Array.from([0, 0, 0, 0, 0, 0]), 2)).toEqual({ frames: 3, meanStepPercent: 0, maxStepPercent: 0, firstLastPercent: 0 });
    expect(measureFrameDifferences(Uint8Array.from([0, 0, 255, 255, 0, 0]), 2)).toEqual({ frames: 3, meanStepPercent: 100, maxStepPercent: 100, firstLastPercent: 0 });
    expect(() => measureFrameDifferences(Uint8Array.from([0, 1, 2]), 2)).toThrow();
  });
});

describe("Instagram result readback", () => {
  const info = { id: "123", caption: post.copy, timestamp: post.platform!.publishedAt, like_count: 0, comments_count: 2 };
  it("reads metrics independently and distinguishes denied/missing values from measured zero", async () => {
    const result = await readInstagramOutcomes(post, async (path, params) => {
      if (!path.endsWith("/insights")) return info;
      if (params.metric === "saved") throw new InstagramReadRejected();
      if (params.metric === "reach") throw new Error("network failed");
      if (params.metric === "views") return { data: [{ name: "views", period: "lifetime", values: [{ value: 0 }] }] };
      if (params.metric === "shares") return { data: [{ name: "shares", period: "lifetime", total_value: { value: 3 } }] };
      return { data: [] };
    }, now);
    expect(result.ageHours).toBe(3);
    expect(result.metrics).toMatchObject({ views: { status: "available", value: 0 }, shares: { status: "available", value: 3 },
      saves: { status: "unavailable", reason: "provider-rejected" }, reach: { status: "unavailable", reason: "request-failed" },
      likes: { status: "available", value: 0 }, comments: { status: "available", value: 2 }, averageWatchTimeMs: unavailable });
  });
  it("rejects a changed caption/platform ID and never reads insights for an unpublished post", async () => {
    await expect(readInstagramOutcomes(post, async () => ({ ...info, caption: "Edited on Instagram" }), now)).rejects.toThrow(/differs/);
    await expect(readInstagramOutcomes(post, async () => ({ ...info, id: "456" }), now)).rejects.toThrow(/differs/);
    await expect(readInstagramOutcomes({ ...post, status: "scheduled" }, async () => { throw new Error("Should not call provider"); }, now)).rejects.toThrow(/published/);
  });
  it("does not label non-lifetime, malformed, multi-value or negative metrics as measurements", async () => {
    const result = await readInstagramOutcomes(post, async (path, params) => path.endsWith("/insights")
      ? { data: [{ name: params.metric, period: "day", values: [{ value: 2 }, { value: 4 }] }] } : { ...info, like_count: -1 }, now);
    expect(result.metrics.views).toEqual(unavailable);
    expect(result.metrics.likes).toEqual(unavailable);
  });
});
