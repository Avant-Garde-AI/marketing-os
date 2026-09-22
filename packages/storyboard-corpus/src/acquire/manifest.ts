import { z } from "zod";

const text = z.string().trim().min(1);
const checksum = z.string().regex(/^[a-f0-9]{64}$/);
const modality = z.enum(["image", "video", "audio", "transcript", "unknown"]);

const orderedChildSchema = z
  .object({
    childId: text,
    ordinal: z.number().int().nonnegative(),
    modality,
    sourceRef: text,
    objectRef: text.optional(),
    localPath: text.optional(),
    checksum: checksum.optional(),
    sampleTimeSeconds: z.number().finite().nonnegative().optional(),
  })
  .strict();

const metricSchema = z
  .object({
    value: z.number().finite().nonnegative().optional(),
    status: z.enum(["measured", "unknown", "not-applicable"]),
    reason: text.optional(),
    observedAt: z.string().datetime().optional(),
    exposure: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .superRefine((metric, ctx) => {
    if (metric.status === "measured" && metric.value === undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "measured metrics require a value" });
    if (metric.status !== "measured" && metric.value !== undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown metrics cannot invent a value" });
  });

/**
 * The durable acquisition record. It has no scraper or model dependency, so
 * incomplete recovery remains an inspectable fact rather than a failed prompt.
 */
export const corpusSnapshotSchema = z
  .object({
    snapshotVersion: z.literal("corpus-snapshot-v2"),
    source: z
      .object({
        platform: text,
        postId: text,
        url: z.string().url().optional(),
        account: text.optional(),
        publishedAt: z.string().datetime().optional(),
      })
      .strict(),
    capture: z
      .object({
        metadataCapturedAt: z.string().datetime().optional(),
        mediaCapturedAt: z.string().datetime().optional(),
        collector: text.optional(),
        objectGeneration: text.optional(),
      })
      .strict(),
    media: z
      .object({ expected: z.array(orderedChildSchema).min(1), actual: z.array(orderedChildSchema) })
      .strict(),
    coverage: z
      .object({
        expectedCount: z.number().int().positive(),
        acquiredCount: z.number().int().nonnegative(),
        orderingVerified: z.boolean(),
        modalitiesObserved: z.array(modality),
        visualSamplesCovered: z.boolean(),
        fullVisualStreamCovered: z.boolean(),
        audioCovered: z.boolean(),
        transcriptCovered: z.boolean(),
      })
      .strict(),
    metrics: z.record(metricSchema),
    scope: z.object({ paidOrganic: z.enum(["paid", "organic", "unknown"]), useScope: text.optional() }).strict(),
    identity: z
      .object({
        canonicalPostId: text,
        occurrenceAliases: z.array(text),
        nearDuplicateGroup: text.optional(),
      })
      .strict(),
    disposition: z.enum(["ready", "excluded", "incomplete", "expired", "failed"]),
    reason: text.optional(),
  })
  .strict();

export type CorpusSnapshot = z.infer<typeof corpusSnapshotSchema>;
export type Metric = z.infer<typeof metricSchema>;
export type SnapshotStatus = CorpusSnapshot["disposition"];

export function metricFromRaw(value: number | null | undefined, reason = "sentinel"): Metric {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { status: "measured", value }
    : { status: "unknown", reason };
}

function ordered(children: CorpusSnapshot["media"]["expected"]): boolean {
  return children.every((child, index) => child.ordinal === index);
}

export type SnapshotAssessment = {
  canonicalPostId: string;
  status: SnapshotStatus;
  complete: boolean;
  reasons: string[];
  modalityGaps: Array<"visual" | "audio" | "transcript">;
};

/** Derives recovery readiness without hiding excluded, expired, or failed source rows. */
export function assessSnapshot(raw: unknown): SnapshotAssessment {
  const parsed = corpusSnapshotSchema.safeParse(raw);
  if (!parsed.success)
    return { canonicalPostId: "invalid", status: "failed", complete: false, reasons: ["snapshot-invalid"], modalityGaps: ["visual"] };
  const snapshot = parsed.data;
  const reasons: string[] = [];
  if (snapshot.coverage.expectedCount !== snapshot.media.expected.length) reasons.push("expected-count-mismatch");
  if (snapshot.coverage.acquiredCount !== snapshot.media.actual.length) reasons.push("acquired-count-mismatch");
  if (!ordered(snapshot.media.expected) || !ordered(snapshot.media.actual) || !snapshot.coverage.orderingVerified)
    reasons.push("order-unverified");
  if (snapshot.media.expected.length !== snapshot.media.actual.length) reasons.push("media-incomplete");
  for (const [index, expected] of snapshot.media.expected.entries()) {
    const actual = snapshot.media.actual[index];
    if (!actual || expected.childId !== actual.childId || expected.modality !== actual.modality)
      reasons.push(`child-mismatch:${index}`);
  }
  if (snapshot.media.actual.some((child) => !child.objectRef || !child.checksum)) reasons.push("durable-media-missing");
  if (snapshot.media.actual.some((child) => child.modality === "unknown")) reasons.push("unknown-modality");
  const modalityGaps: SnapshotAssessment["modalityGaps"] = [];
  if (!snapshot.coverage.visualSamplesCovered) modalityGaps.push("visual");
  const hasVideo = snapshot.media.expected.some((child) => child.modality === "video");
  if (hasVideo && !snapshot.coverage.audioCovered) modalityGaps.push("audio");
  if (hasVideo && !snapshot.coverage.transcriptCovered) modalityGaps.push("transcript");
  const complete = reasons.length === 0 && snapshot.coverage.visualSamplesCovered;
  const status =
    snapshot.disposition === "excluded" || snapshot.disposition === "expired" || snapshot.disposition === "failed"
      ? snapshot.disposition
      : complete
        ? "ready"
        : "incomplete";
  return { canonicalPostId: snapshot.identity.canonicalPostId, status, complete, reasons: [...new Set(reasons)], modalityGaps };
}

export function summarizeRecovery(snapshots: unknown[]) {
  const assessments = snapshots.map(assessSnapshot);
  return {
    planned: assessments.length,
    ready: assessments.filter((item) => item.status === "ready").length,
    incomplete: assessments.filter((item) => item.status === "incomplete").length,
    expired: assessments.filter((item) => item.status === "expired").length,
    failed: assessments.filter((item) => item.status === "failed").length,
    excluded: assessments.filter((item) => item.status === "excluded").length,
    visualGaps: assessments.filter((item) => item.modalityGaps.includes("visual")).length,
    audioGaps: assessments.filter((item) => item.modalityGaps.includes("audio")).length,
    transcriptGaps: assessments.filter((item) => item.modalityGaps.includes("transcript")).length,
  };
}
