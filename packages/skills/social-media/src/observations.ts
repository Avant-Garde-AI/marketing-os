/** Read-only quality/outcome evidence. Never scheduling consent or pattern admission. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { StoreRepo } from "@avant-garde/skill-kit";
import type { SocialPost } from "./types";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/).max(160);
const percent = z.number().finite().min(0).max(100);
const metric = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), value: z.number().finite().nonnegative() }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["provider-rejected", "not-returned", "request-failed"]) }).strict(),
]);

export const observationSchema = z.object({
  schemaVersion: z.literal(1),
  postId: id,
  mediaHash: digest,
  creativeHash: digest,
  observedAt: z.string().datetime(),
  motion: z.object({
    method: z.literal("grayscale-frame-difference-v1"),
    videoSha256: digest,
    width: z.number().int().positive(), height: z.number().int().positive(),
    durationMs: z.number().positive().finite(),
    sampleWidth: z.number().int().positive(), sampleHeight: z.number().int().positive(),
    sampleFps: z.number().positive().max(30), frames: z.number().int().min(3),
    meanStepPercent: percent, maxStepPercent: percent, firstLastPercent: percent,
    littleChangeThresholdPercent: percent,
  }).strict().optional(),
  outcomes: z.object({
    platformId: z.string().regex(/^\d+$/),
    publishedAt: z.string().datetime({ offset: true }),
    ageHours: z.number().finite().nonnegative(),
    period: z.literal("lifetime"),
    source: z.literal("instagram-graph"),
    metrics: z.object({
      views: metric, reach: metric, saves: metric, shares: metric, likes: metric, comments: metric,
      averageWatchTimeMs: metric,
    }).strict(),
  }).strict().optional(),
}).strict().superRefine((record, ctx) => {
  if (!record.motion && !record.outcomes) ctx.addIssue({ code: "custom", message: "An observation needs motion diagnostics or outcomes" });
  if (record.outcomes && Date.parse(record.outcomes.publishedAt) > Date.parse(record.observedAt))
    ctx.addIssue({ code: "custom", message: "Observation precedes publication" });
});

export type PostObservation = z.infer<typeof observationSchema>;
export type OutcomeMetric = z.infer<typeof metric>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Ordered immutable media bytes; a caption/date edit does not invalidate motion analysis. */
export function postMediaHash(post: SocialPost): string {
  if (post.renderedVideo) return hash({ video: post.renderedVideo.video.sha256 });
  if (post.renderedSequence) return hash({ slides: post.renderedSequence.slides.map(slide => slide.sha256) });
  throw new Error("Observations require immutable bound video or carousel media");
}

/** Content identity, separate from approval: moving a release date does not rewrite a result. */
export function postCreativeHash(post: SocialPost): string {
  return hash({ id: post.id, channel: post.channel, account: post.channelAccount ?? null,
    copy: post.copy, targetLink: post.targetLink, mediaHash: postMediaHash(post) });
}

export function observationPrefix(postId: string): string {
  return `social/observations/${id.parse(postId)}/`;
}
export function observationPath(record: PostObservation): string {
  const valid = observationSchema.parse(record);
  return `${observationPrefix(valid.postId)}${hash(valid)}.json`;
}

export async function readPostObservations(repo: StoreRepo, post: SocialPost, now = new Date()) {
  const paths = (await repo.list(observationPrefix(post.id))).filter(path =>
    new RegExp(`^social/observations/${post.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[a-f0-9]{64}\\.json$`).test(path));
  const records: PostObservation[] = [];
  let unreadable = 0;
  for (const path of paths) {
    try {
      const raw = await repo.readFile(path);
      if (!raw) throw new Error("Missing observation");
      const record = observationSchema.parse(JSON.parse(raw));
      if (record.postId !== post.id || observationPath(record) !== path || Date.parse(record.observedAt) > now.getTime())
        throw new Error("Observation identity or timestamp mismatch");
      records.push(record);
    } catch { unreadable++; }
  }
  records.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  let mediaHash: string | null = null, creativeHash: string | null = null;
  try { mediaHash = postMediaHash(post); creativeHash = postCreativeHash(post); } catch { /* An unbound draft has no current observations. */ }
  const motion = records.find(record => record.motion && record.mediaHash === mediaHash &&
    record.motion.videoSha256 === post.renderedVideo?.video.sha256) ?? null;
  const outcomes = records.find(record => record.outcomes && record.mediaHash === mediaHash &&
    record.creativeHash === creativeHash && record.outcomes.platformId === post.platform?.id) ?? null;
  return { motion, outcomes, unreadable, historical: records.filter(record => record !== motion && record !== outcomes).length };
}

/** Diagnostic only: pixel change can be noise, drift or a camera move, not a better story. */
export function measureFrameDifferences(bytes: Uint8Array, frameSize: number) {
  if (!Number.isInteger(frameSize) || frameSize <= 0 || bytes.length % frameSize !== 0 || bytes.length / frameSize < 3)
    throw new Error("At least three complete grayscale frames are required");
  const frames = bytes.length / frameSize;
  const difference = (a: number, b: number) => {
    let sum = 0;
    for (let pixel = 0; pixel < frameSize; pixel++) sum += Math.abs(bytes[a * frameSize + pixel]! - bytes[b * frameSize + pixel]!);
    return sum / frameSize / 255 * 100;
  };
  const steps = Array.from({ length: frames - 1 }, (_, i) => difference(i, i + 1));
  return { frames, meanStepPercent: steps.reduce((sum, value) => sum + value, 0) / steps.length,
    maxStepPercent: Math.max(...steps), firstLastPercent: difference(0, frames - 1) };
}

type GraphRead = (path: string, params: Record<string, string>) => Promise<unknown>;
const absent: OutcomeMetric = { status: "unavailable", reason: "not-returned" };
const value = (raw: unknown): OutcomeMetric => typeof raw === "number" && Number.isFinite(raw) && raw >= 0
  ? { status: "available", value: raw } : absent;

/** Each metric fails independently. Permission errors and missing data never become zero. */
export async function readInstagramOutcomes(post: SocialPost, query: GraphRead, now = new Date()): Promise<NonNullable<PostObservation["outcomes"]>> {
  if (post.channel !== "instagram" || !post.platform?.id || !/^[0-9]+$/.test(post.platform.id) ||
    !["published", "measured"].includes(post.status)) throw new Error("Outcomes require a published Instagram post");
  const info = z.object({ id: z.string(), caption: z.string().optional(), timestamp: z.string(),
    like_count: z.unknown().optional(), comments_count: z.unknown().optional() }).parse(
    await query(`/${post.platform.id}`, { fields: "id,caption,timestamp,like_count,comments_count" }));
  if (info.id !== post.platform.id || (info.caption ?? "") !== post.copy) throw new Error("Published media or caption differs from this revision");
  const publishedAt = new Date(info.timestamp).toISOString();
  const ageHours = (now.getTime() - Date.parse(publishedAt)) / 3_600_000;
  if (ageHours < 0) throw new Error("Publication is in the future");
  const readMetric = async (name: string): Promise<OutcomeMetric> => {
    try {
      const raw = await query(`/${post.platform!.id}/insights`, { metric: name });
      const response = z.object({ data: z.array(z.object({ name: z.string(), period: z.string().optional(),
        values: z.array(z.object({ value: z.unknown() })).optional(), total_value: z.object({ value: z.unknown() }).optional() })) }).safeParse(raw);
      if (!response.success) return absent;
      const entry = response.data.data.find(item => item.name === name && (!item.period || item.period === "lifetime"));
      return value(entry?.total_value?.value ?? (entry?.values?.length === 1 ? entry.values[0]!.value : undefined));
    } catch (error) {
      return { status: "unavailable", reason: error instanceof InstagramReadRejected ? "provider-rejected" : "request-failed" };
    }
  };
  const [views, reach, saves, shares, averageWatchTimeMs] = await Promise.all([
    readMetric("views"), readMetric("reach"), readMetric("saved"), readMetric("shares"),
    post.renderedVideo ? readMetric("ig_reels_avg_watch_time") : Promise.resolve(absent),
  ]);
  return { platformId: post.platform.id, publishedAt, ageHours, period: "lifetime", source: "instagram-graph",
    metrics: { views, reach, saves, shares, likes: value(info.like_count), comments: value(info.comments_count), averageWatchTimeMs } };
}

/** Deliberately contains no provider response text or request URL (which could include credentials). */
export class InstagramReadRejected extends Error {
  constructor() { super("Instagram read was rejected"); }
}
