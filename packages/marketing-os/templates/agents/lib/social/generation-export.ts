/** Content-addressed Instagram loop exports, bound to the paid generation receipt. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { StoreRepo } from "../skill-kit";
import type { GenerationReview } from "./generation-review";
import { loadGenerationDelivery } from "./generation-delivery";

const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const EXPORT_DIMENSIONS = {
  reel: { width: 1080, height: 1920 },
  feed: { width: 1080, height: 1350 },
} as const;
export type LoopExportVariant = keyof typeof EXPORT_DIMENSIONS;

const exportSchema = z.object({
  variant: z.enum(["reel", "feed"]),
  filename: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}-(?:reel|feed)\.mp4$/),
  sha256: z.string().regex(HASH),
  bytes: z.number().int().positive().max(MAX_EXPORT_BYTES),
  codec: z.literal("h264"),
  pixelFormat: z.literal("yuv420p"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.literal("24/1"),
  durationSec: z.number().positive().max(30),
  fit: z.string().min(1).max(160),
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifactId: z.string().regex(ID),
  postId: z.string().regex(POST_ID),
  inputHash: z.string().regex(HASH),
  source: z.object({
    filename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.mp4$/),
    sha256: z.string().regex(HASH),
    codec: z.string().regex(/^[A-Za-z0-9_+-]{1,24}$/),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    frameRate: z.string().regex(/^\d{1,3}\/\d{1,4}$/).refine((value) => {
      const [numerator, denominator] = value.split("/").map(Number);
      return numerator > 0 && denominator > 0 && numerator / denominator <= 120;
    }),
    durationSec: z.number().positive().max(30),
    sourceUpscaled: z.boolean(),
    note: z.string().min(1).max(300),
  }).strict(),
  exports: z.array(exportSchema).length(2),
}).strict();

export function loopExportManifestPath(artifactId: string): string {
  if (!ID.test(artifactId)) throw new Error("Invalid generation artifact ID");
  return `social/production/exports/${artifactId}-exports.json`;
}

export function loopExportBytesPath(artifactId: string, variant: LoopExportVariant): string {
  if (!ID.test(artifactId) || !(variant in EXPORT_DIMENSIONS)) throw new Error("Invalid loop export variant");
  return `social/production/exports/${artifactId}-${variant}.mp4.b64`;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function parseLoopExportManifest(raw: string, job: Pick<GenerationReview, "artifactId" | "postId" | "inputHash">) {
  if (raw.length === 0 || raw.length > 16_000) throw new Error("Loop export receipt unavailable");
  const manifest = manifestSchema.parse(JSON.parse(raw));
  if (manifest.artifactId !== job.artifactId || manifest.postId !== job.postId || manifest.inputHash !== job.inputHash)
    throw new Error("Loop export receipt does not match generation job");
  const entries = new Map(manifest.exports.map((entry) => [entry.variant, entry]));
  if (entries.size !== 2 || !entries.has("reel") || !entries.has("feed")) throw new Error("Loop export variants invalid");
  for (const variant of ["reel", "feed"] as const) {
    const entry = entries.get(variant)!;
    const expected = EXPORT_DIMENSIONS[variant];
    const expectedFit = variant === "reel"
      ? "full-frame scale; no crop; source aspect ratio retained"
      : "contain with #f4f3ee side padding; no crop; full source frame retained";
    if (entry.filename !== `${job.artifactId}-${variant}.mp4` || entry.width !== expected.width ||
        entry.height !== expected.height || entry.fit !== expectedFit ||
        Math.abs(entry.durationSec - manifest.source.durationSec) > 1 / 24)
      throw new Error("Loop export format receipt invalid");
  }
  return { manifest, entries };
}

export function decodeVerifiedLoopExport(encoded: string, entry: z.infer<typeof exportSchema>): Buffer {
  const maxBase64Length = Math.ceil(MAX_EXPORT_BYTES / 3) * 4;
  if (!encoded || encoded.length > maxBase64Length || encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error("Loop export bytes unavailable");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || bytes.length !== entry.bytes || bytes.length > MAX_EXPORT_BYTES ||
      sha256(bytes) !== entry.sha256 || bytes.toString("ascii", 4, 8) !== "ftyp")
    throw new Error("Loop export bytes failed verification");
  return bytes;
}

export function parseLoopExportRange(value: string | null, size: number): { start: number; end: number } | null | false {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size)
    return false;
  return { start, end: Math.min(end, size - 1) };
}

/** Fail closed if the repo artifact is stale, malformed, or not the exact paid job. */
export async function loadVerifiedLoopExport(
  repo: StoreRepo,
  job: GenerationReview,
  variant: LoopExportVariant,
): Promise<{
  bytes: Buffer;
  sha256: string;
  filename: string;
  width: number;
  height: number;
  durationSec: number;
  fit: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceUpscaled: boolean;
}> {
  if (job.mechanic !== "artwork-loop" || job.state !== "succeeded" || !job.videoUrl ||
      !ID.test(job.artifactId) || !POST_ID.test(job.postId) || !HASH.test(job.inputHash))
    throw new Error("Completed loop job required");

  const receipt = await loadGenerationDelivery(repo, job);
  if (!receipt || receipt.scene) throw new Error("Matching loop delivery receipt required");
  const raw = await repo.readFile(loopExportManifestPath(job.artifactId));
  if (!raw) throw new Error("Loop export receipt unavailable");
  const { manifest, entries } = parseLoopExportManifest(raw, job);
  const entry = entries.get(variant)!;

  const encoded = await repo.readFile(loopExportBytesPath(job.artifactId, variant));
  if (!encoded) throw new Error("Loop export bytes unavailable");
  const bytes = decodeVerifiedLoopExport(encoded, entry);
  return { bytes, sha256: entry.sha256, filename: entry.filename, width: entry.width, height: entry.height,
    durationSec: entry.durationSec, fit: entry.fit, sourceWidth: manifest.source.width,
    sourceHeight: manifest.source.height, sourceUpscaled: manifest.source.sourceUpscaled };
}
