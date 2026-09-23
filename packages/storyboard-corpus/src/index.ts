import { createHash } from "node:crypto";
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { readFile as readLocalFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const text = z.string().trim().min(1);
const mediaSchema = z.object({
  ref: text,
  sourceRef: text.optional(),
  localPath: text.optional(),
  kind: z.enum(["image", "video-sample"]),
  mimeType: text.optional(),
  ordinal: z.number().int().nonnegative(),
  sampleTimeSeconds: z.number().finite().nonnegative().optional(),
});
export const postSchema = z
  .object({
    postId: text,
    format: z.enum(["single", "carousel", "video"]),
    media: z.array(mediaSchema).min(1),
    caption: z.string().optional(),
    engagement: z.record(z.number().finite()).optional(),
  })
  .superRefine((p, ctx) => {
    const ordinals = p.media.map((m) => m.ordinal);
    const refs = p.media.map((m) => m.ref);
    if (new Set(ordinals).size !== ordinals.length || ordinals.some((n, i) => n !== i))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "media must be ordered 0..n-1",
      });
    if (new Set(refs).size !== refs.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "media refs must be unique",
      });
    if (p.format === "single" && p.media.length !== 1)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "single requires exactly one media item",
      });
    if (p.format === "carousel" && p.media.length < 2)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "carousel requires at least two media items",
      });
    if (
      p.format === "video" &&
      (p.media.some((m) => m.kind !== "video-sample" || m.sampleTimeSeconds === undefined) ||
        new Set(p.media.map((m) => m.sampleTimeSeconds)).size < 2)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "video requires temporal samples, never a poster-only input",
      });
    if (
      p.format === "video" &&
      p.media.some(
        (m, i) =>
          i > 0 && (m.sampleTimeSeconds as number) <= (p.media[i - 1]!.sampleTimeSeconds as number)
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "video sample times must be ascending",
      });
    if (p.format !== "video" && p.media.some((m) => m.kind === "video-sample"))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "video samples require video format",
      });
  });
export type PostInput = z.infer<typeof postSchema>;

export const ledgerRowSchema = z.object({
  runId: text,
  postId: text,
  status: z.enum([
    "ready",
    "media-expired",
    "incomplete",
    "extraction-failed",
    "extracted",
    "unclustered",
  ]),
  inputHash: text,
  updatedAt: text,
  error: z.string().optional(),
  attempt: z.number().int().positive(),
  output: z.unknown().optional(),
  validated: z.boolean().optional(),
  input: z.unknown().optional(),
  model: text.optional(),
  version: text.optional(),
  promptHash: text.optional(),
  diagnostics: z
    .object({
      provider: text,
      httpStatus: z.number().int().optional(),
      finishReason: text.optional(),
      retryable: z.boolean(),
      usage: z
        .object({
          inputTokens: z.number().int().nonnegative().optional(),
          outputTokens: z.number().int().nonnegative().optional(),
          thinkingTokens: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
  media: z
    .array(
      z.object({
        ref: text,
        sourceRef: text.optional(),
        ordinal: z.number().int().nonnegative(),
        checksum: text.optional(),
        mimeType: text.optional(),
        sampleTimeSeconds: z.number().finite().nonnegative().optional(),
        capturedAt: z.string().optional(),
      })
    )
    .optional(),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

export interface AcquiredMedia {
  ref: string;
  sourceRef?: string;
  ordinal: number;
  kind: "image" | "video-sample";
  mimeType?: string;
  bytes: Buffer;
  checksum: string;
  sampleTimeSeconds?: number;
  capturedAt?: string;
}
export interface AcquiredPost {
  input: PostInput;
  media: AcquiredMedia[];
  inputHash: string;
}
export interface MediaObservation {
  mediaRef: string;
  ordinal: number;
  role: string;
  observation: string;
  visibleTreatment: string;
  transition?: { change: string; why: string };
  sampleTimeSeconds?: number;
}
export interface ExtractionResult {
  observations: MediaObservation[];
  narrativeMechanism: string;
  continuity: string[];
  temporalCoverage?: { sampledSeconds: number[]; complete: boolean };
  usage?: { inputTokens?: number; outputTokens?: number; thinkingTokens?: number };
}
export interface Extractor {
  model: string;
  version: string;
  promptHash: string;
  extract(post: AcquiredPost): Promise<ExtractionResult>;
}
export interface Acquisition {
  acquire(media: z.infer<typeof mediaSchema>): Promise<{ bytes: Buffer; capturedAt?: string }>;
}
type SafeDiagnostics = {
  provider: string;
  httpStatus?: number;
  finishReason?: string;
  retryable: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; thinkingTokens?: number };
};

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function inputHash(post: PostInput, media: AcquiredMedia[], extractor: Extractor): string {
  return sha256(
    stable({
      postId: post.postId,
      format: post.format,
      caption: post.caption ?? "",
      media: media.map((m) => ({
        ref: m.ref,
        ordinal: m.ordinal,
        kind: m.kind,
        mimeType: m.mimeType,
        checksum: m.checksum,
        sampleTimeSeconds: m.sampleTimeSeconds,
      })),
      model: extractor.model,
      version: extractor.version,
      promptHash: extractor.promptHash,
    })
  );
}

export class JsonlLedger {
  constructor(readonly path: string) {}
  async rows(): Promise<LedgerRow[]> {
    try {
      return (await readFile(this.path, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((x) => ledgerRowSchema.parse(JSON.parse(x)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async latest(runId: string, postId: string): Promise<LedgerRow | undefined> {
    return (await this.rows()).filter((r) => r.runId === runId && r.postId === postId).at(-1);
  }
  async append(row: LedgerRow): Promise<void> {
    ledgerRowSchema.parse(row);
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(row) + "\n", "utf8");
  }
}

export class LocalOrReferenceAcquisition implements Acquisition {
  async acquire(media: z.infer<typeof mediaSchema>): Promise<{ bytes: Buffer }> {
    if (!media.localPath)
      throw new Error(`no local media for source ref ${media.sourceRef ?? media.ref}`);
    return { bytes: await readLocalFile(media.localPath) };
  }
}

function validateExtraction(post: AcquiredPost, result: ExtractionResult): void {
  const parsed = resultSchema.parse(result);
  result = parsed;
  const refs = new Set(post.media.map((m) => m.ref));
  if (result.observations.length !== post.media.length)
    throw new Error("extractor must observe every attached media item");
  const seen = new Set<number>();
  for (const o of result.observations) {
    if (
      !refs.has(o.mediaRef) ||
      seen.has(o.ordinal) ||
      o.ordinal < 0 ||
      o.ordinal >= post.media.length ||
      o.ordinal !== seen.size
    )
      throw new Error(
        "extraction observations must reference each ordered media item exactly once and in order"
      );
    if (post.media[o.ordinal]?.ref !== o.mediaRef)
      throw new Error("observation order does not match attached media order");
    if (!o.observation.trim() || !o.visibleTreatment.trim() || !o.role.trim())
      throw new Error("observations require visible evidence and a role");
    if (o.ordinal > 0 && !o.transition)
      throw new Error("every observation after the first requires a transition");
    if (
      post.media[o.ordinal]?.sampleTimeSeconds !== undefined &&
      o.sampleTimeSeconds !== post.media[o.ordinal]!.sampleTimeSeconds
    )
      throw new Error("observation sample time does not match the attached media");
    seen.add(o.ordinal);
  }
  if (post.input.format === "video") {
    const times = result.temporalCoverage?.sampledSeconds ?? [];
    const expected = post.media.map((m) => m.sampleTimeSeconds);
    if (
      !result.temporalCoverage ||
      !result.temporalCoverage.complete ||
      times.length !== expected.length ||
      times.some((t, i) => t !== expected[i]) ||
      new Set(times).size < 2
    )
      throw new Error("video extraction must declare complete temporal sample coverage");
  }
}

export async function runExtraction(
  posts: unknown[],
  opts: {
    runId: string;
    ledger: JsonlLedger;
    acquisition: Acquisition;
    extractor: Extractor;
    maxPosts?: number;
    concurrency?: number;
  }
): Promise<LedgerRow[]> {
  const { runId, ledger, acquisition, extractor } = opts;
  if (!Number.isSafeInteger(opts.maxPosts ?? posts.length) || (opts.maxPosts ?? posts.length) < 0)
    throw new Error("maxPosts must be a nonnegative safe integer");
  if (opts.concurrency !== undefined && opts.concurrency !== 1)
    throw new Error("pilot concurrency is fixed at 1");
  const selectedRaw = posts.slice(0, opts.maxPosts ?? posts.length);
  const ids = selectedRaw.map((p) =>
    p && typeof p === "object" ? (p as { postId?: unknown }).postId : undefined
  );
  if (ids.some((id) => typeof id !== "string" || !id.trim()))
    throw new Error("every post must have a stable postId");
  if (new Set(ids as string[]).size !== ids.length)
    throw new Error("post IDs must be unique in an inventory");
  const out: LedgerRow[] = [];
  for (const raw of selectedRaw) {
    let post: PostInput;
    try {
      post = postSchema.parse(raw);
    } catch (e) {
      const postId = (raw as { postId: string }).postId;
      const prior = await ledger.latest(runId, postId);
      const failed: LedgerRow = {
        runId,
        postId,
        status: "extraction-failed",
        inputHash: sha256(stable(raw)),
        updatedAt: new Date().toISOString(),
        attempt: (prior?.attempt ?? 0) + 1,
        input: raw,
        error: e instanceof Error ? e.message : String(e),
      };
      await ledger.append(failed);
      out.push(failed);
      continue;
    }
    const previous = await ledger.latest(runId, post.postId);
    let readyWritten = false;
    let acquiredMedia: AcquiredMedia[] = [];
    let requestHash = sha256(stable(post));
    const ready: LedgerRow = {
      runId,
      postId: post.postId,
      status: "ready",
      inputHash: requestHash,
      updatedAt: new Date().toISOString(),
      attempt: (previous?.attempt ?? 0) + 1,
      input: post,
      model: extractor.model,
      version: extractor.version,
      promptHash: extractor.promptHash,
    };
    try {
      for (const m of post.media) {
        try {
          const got = await acquisition.acquire(m);
          acquiredMedia.push({
            ...m,
            bytes: got.bytes,
            checksum: sha256(got.bytes),
            capturedAt: got.capturedAt,
          });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          throw new Error(
            `${detail.startsWith("media-expired:") ? "media-expired" : "incomplete"}: ${m.ref}: ${detail}`
          );
        }
      }
      if (acquiredMedia.some((m) => m.bytes.length === 0))
        throw new Error("incomplete: zero-byte media");
      requestHash = inputHash(post, acquiredMedia, extractor);
      const acquired = { input: post, media: acquiredMedia, inputHash: requestHash };
      if (
        previous?.status === "extracted" &&
        previous.validated === true &&
        previous.inputHash === acquired.inputHash
      ) {
        out.push(previous);
        continue;
      }
      await ledger.append(ready);
      readyWritten = true;
      const result = await extractor.extract(acquired);
      validateExtraction(acquired, result);
      const done: LedgerRow = {
        ...ready,
        status: "extracted",
        inputHash: acquired.inputHash,
        output: result,
        validated: true,
        media: acquiredMedia.map((m) => ({
          ref: m.ref,
          sourceRef: m.sourceRef,
          ordinal: m.ordinal,
          checksum: m.checksum,
          mimeType: m.mimeType,
          sampleTimeSeconds: m.sampleTimeSeconds,
          capturedAt: m.capturedAt,
        })),
        updatedAt: new Date().toISOString(),
      };
      await ledger.append(done);
      out.push(done);
    } catch (e) {
      const rawDiagnostics =
        (e as { diagnostic?: unknown; diagnostics?: unknown }).diagnostic ??
        (e as { diagnostics?: unknown }).diagnostics;
      const diagnostics =
        rawDiagnostics && typeof rawDiagnostics === "object"
          ? (() => {
              const d = rawDiagnostics as Record<string, unknown>;
              const usage =
                d.usage && typeof d.usage === "object"
                  ? (d.usage as Record<string, unknown>)
                  : undefined;
              const safe: SafeDiagnostics = {
                provider: typeof d.provider === "string" ? d.provider : "unknown",
                httpStatus: typeof d.httpStatus === "number" ? d.httpStatus : undefined,
                finishReason: typeof d.finishReason === "string" ? d.finishReason : undefined,
                retryable: d.retryable === true,
                usage: usage
                  ? {
                      inputTokens:
                        typeof usage.inputTokens === "number" ? usage.inputTokens : undefined,
                      outputTokens:
                        typeof usage.outputTokens === "number" ? usage.outputTokens : undefined,
                      thinkingTokens:
                        typeof usage.thinkingTokens === "number" ? usage.thinkingTokens : undefined,
                    }
                  : undefined,
              };
              return safe;
            })()
          : undefined;
      const rawMessage = e instanceof Error ? e.message : String(e);
      const message =
        rawMessage.startsWith("media-expired:") ||
        rawMessage.startsWith("incomplete:") ||
        rawMessage.startsWith("extractor must") ||
        rawMessage.startsWith("extraction observations") ||
        rawMessage.startsWith("observations require") ||
        rawMessage.startsWith("every observation") ||
        rawMessage.startsWith("observation sample") ||
        rawMessage.startsWith("video extraction")
          ? rawMessage
          : diagnostics
            ? "provider request failed"
            : "extraction failed";
      const failed: LedgerRow = {
        ...ready,
        status: message.startsWith("media-expired:")
          ? "media-expired"
          : message.startsWith("incomplete:")
            ? "incomplete"
            : "extraction-failed",
        inputHash: requestHash,
        media: acquiredMedia.map((m) => ({
          ref: m.ref,
          sourceRef: m.sourceRef,
          ordinal: m.ordinal,
          checksum: m.checksum,
          mimeType: m.mimeType,
          sampleTimeSeconds: m.sampleTimeSeconds,
          capturedAt: m.capturedAt,
        })),
        diagnostics,
        error: message,
        updatedAt: new Date().toISOString(),
      };
      if (!readyWritten) await ledger.append(ready);
      await ledger.append(failed);
      out.push(failed);
    }
  }
  return out;
}

export const resultSchema = z.object({
  observations: z
    .array(
      z.object({
        mediaRef: text,
        ordinal: z.number().int().nonnegative(),
        role: text,
        observation: text,
        visibleTreatment: text,
        transition: z.object({ change: text, why: text }).optional(),
        sampleTimeSeconds: z.number().finite().nonnegative().optional(),
      })
    )
    .min(1),
  narrativeMechanism: text,
  continuity: z.array(text),
  temporalCoverage: z
    .object({ sampledSeconds: z.array(z.number().finite().nonnegative()), complete: z.boolean() })
    .optional(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      thinkingTokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export function countedPostIds(extracted: LedgerRow[]): string[] {
  const latest = new Map<string, LedgerRow>();
  for (const row of extracted) latest.set(`${row.runId}\u0000${row.postId}`, row);
  return [
    ...new Set(
      [...latest.values()]
        .filter((x) => {
          if (x.status !== "extracted" || x.validated !== true) return false;
          const input = postSchema.safeParse(x.input);
          const output = resultSchema.safeParse(x.output);
          if (!input.success || !output.success || x.media?.length !== input.data.media.length)
            return false;
          if (output.data.observations.length !== x.media.length) return false;
          return x.media.every(
            (m, i) =>
              /^[a-f0-9]{64}$/.test(m.checksum ?? "") &&
              m.ref === input.data.media[i]?.ref &&
              m.ordinal === i &&
              output.data.observations[i]?.mediaRef === m.ref &&
              output.data.observations[i]?.ordinal === i &&
              (i === 0 || !!output.data.observations[i]?.transition)
          );
        })
        .map((x) => x.postId)
    ),
  ].sort();
}

export * from "./field-cohort.js";
export * from "./acquire/manifest.js";
export * from "./acquire/recover.js";
