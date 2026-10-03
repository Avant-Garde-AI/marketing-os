/** Read-only, job-bound delivery receipt and verified scene render. */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { StoreRepo } from "../skill-kit";
import { getTenant, HOSTED, runWithTenant } from "../tenant-context";
import { compositeArtworkScene } from "./scene-composite";
import { readGenerationInput } from "./generation-input";
import type { GenerationReview } from "./generation-review";
import { verifyLink } from "./review-links";

type BoundJob = Pick<GenerationReview, "artifactId" | "postId" | "inputHash" | "mechanic" | "sourcePreviewUrl">;
type SceneJob = BoundJob & Pick<GenerationReview, "state" | "imageUrl">;
const id = /^[a-z0-9][a-z0-9-]{0,99}$/;
const hash = /^[a-f0-9]{64}$/;
const point = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]);
const placement = z.object({
  sourceRef: z.string().trim().min(1).max(200),
  quad: z.tuple([point, point, point, point]),
  mat: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  fit: z.enum(["contain", "cover"]).optional(),
}).strict();
export const generationDeliverySchema = z.object({
  schemaVersion: z.literal(1),
  artifactId: z.string().regex(id),
  postId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/),
  inputHash: z.string().regex(hash),
  caption: z.string().trim().min(1).max(5_000),
  scene: z.object({
    backgroundSha256: z.string().regex(hash),
    placements: z.array(placement).min(1).max(3),
  }).strict().optional(),
}).strict();
export type GenerationDelivery = z.infer<typeof generationDeliverySchema>;

export function generationDeliveryPath(artifactId: string): string {
  if (!id.test(artifactId)) throw new Error("Invalid generation artifact ID");
  return `social/production/deliveries/${artifactId}.json`;
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Repo choice comes from a second signed, hash-bound link returned by the broker. */
export function generationDeliveryRepoFromPreview(job: BoundJob): string | null {
  const tenant = getTenant();
  // A client-owned execute request carries shop/slug but may omit repo. Its
  // deployment owns exactly one store, so use the same configured repo as preview.
  // Hosted requests still require the signed job binding below.
  if (!HOSTED) return tenant.githubRepo ?? process.env.GITHUB_REPO ?? null;
  const url = new URL(job.sourcePreviewUrl);
  const repo = url.searchParams.get("repo");
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      url.pathname !== `/review/generation/${encodeURIComponent(job.artifactId)}` ||
      url.searchParams.get("shop") !== tenant.shop || url.searchParams.get("hash") !== job.inputHash ||
      !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
      verifyLink("review", tenant.shop, `generation:${job.artifactId}:${job.inputHash}:${repo}`,
        url.searchParams.get("t"), url.searchParams.get("e")) !== "ok")
    throw new Error("Generation source preview is not bound to this tenant and repo");
  return repo;
}

async function withJobRepo<T>(job: BoundJob, fn: () => Promise<T>): Promise<T> {
  const tenant = getTenant();
  const githubRepo = generationDeliveryRepoFromPreview(job);
  return runWithTenant({ ...tenant, githubRepo }, fn);
}

/** Null means no receipt. A present but invalid receipt always fails closed. */
export async function loadGenerationDelivery(repo: StoreRepo, job: BoundJob): Promise<GenerationDelivery | null> {
  if (!id.test(job.artifactId) || !hash.test(job.inputHash)) throw new Error("Invalid generation job binding");
  return withJobRepo(job, async () => {
    const raw = await repo.readFile(generationDeliveryPath(job.artifactId));
    if (raw === null) return null;
    if (raw.length === 0 || raw.length > 64_000) throw new Error("Generation delivery receipt invalid");
    const receipt = generationDeliverySchema.parse(JSON.parse(raw));
    if (receipt.artifactId !== job.artifactId || receipt.postId !== job.postId || receipt.inputHash !== job.inputHash ||
        (job.mechanic === "collection-scene") !== Boolean(receipt.scene))
      throw new Error("Generation delivery receipt does not match the broker job");
    const input = await readGenerationInput(repo, job.artifactId);
    if (input.inputHash !== job.inputHash || input.plan.postId !== job.postId || input.plan.mechanic !== job.mechanic)
      throw new Error("Generation delivery receipt does not match immutable source input");
    if (receipt.scene) {
      const expected = input.plan.sceneComposition === "single-artwork" ? 1 : 3;
      const planned = new Set(input.plan.sources.map(source => source.sourceRef));
      const placed = new Set(receipt.scene.placements.map(item => item.sourceRef));
      if (planned.size !== expected || receipt.scene.placements.length !== expected || placed.size !== expected ||
          [...planned].some(ref => !placed.has(ref)))
        throw new Error("Generation delivery placements do not match reviewed artworks");
    }
    return receipt;
  });
}

const BACKGROUND_HOSTS = new Set(["cdn.higgsfield.ai", "d8j0ntlcm91z4.cloudfront.net", "d2ol7oe51mr4n9.cloudfront.net"]);
const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;

async function readProviderBackground(rawUrl: string, expectedHash: string): Promise<Buffer> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !BACKGROUND_HOSTS.has(url.hostname.toLowerCase())) throw new Error("Untrusted scene background URL");
  const response = await fetch(url, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Scene background unavailable");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BACKGROUND_BYTES) throw new Error("Scene background too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Scene background missing");
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_BACKGROUND_BYTES) throw new Error("Scene background too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  if (digest(bytes) !== expectedHash) throw new Error("Scene background hash mismatch");
  const meta = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
  if ((meta.format !== "jpeg" && meta.format !== "png") || !meta.width || !meta.height ||
      meta.width * meta.height > 20_000_000 || (meta.orientation ?? 1) !== 1 || (meta.pages ?? 1) !== 1)
    throw new Error("Scene background format invalid");
  return bytes;
}

/** Refetch each content-addressed source; the contact sheet is never composited. */
async function readVerifiedSources(repo: StoreRepo, job: BoundJob) {
  const input = await readGenerationInput(repo, job.artifactId);
  if (input.inputHash !== job.inputHash || input.plan.postId !== job.postId || input.plan.mechanic !== "collection-scene")
    throw new Error("Generation source input changed");
  const sources: { ref: string; bytes: Buffer }[] = [];
  for (const source of input.plan.sources) {
    const encoded = await repo.readFile(source.sourcePath);
    if (!encoded || encoded.length > 6_000_000 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      throw new Error("Verified scene source unavailable");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded || digest(bytes) !== source.sourceSha256)
      throw new Error("Verified scene source changed");
    const meta = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
    if (meta.format !== "jpeg" || meta.width !== source.width || meta.height !== source.height ||
        (meta.orientation ?? 1) !== 1 || source.width < 1024 || source.height < 1024)
      throw new Error("Verified scene source dimensions changed");
    sources.push({ ref: source.sourceRef, bytes });
  }
  return { sources, composition: input.plan.sceneComposition };
}

export async function renderGenerationScene(repo: StoreRepo, job: SceneJob, receipt: GenerationDelivery): Promise<Buffer> {
  if (job.mechanic !== "collection-scene" || job.state !== "succeeded" || !job.imageUrl || !receipt.scene ||
      receipt.artifactId !== job.artifactId || receipt.postId !== job.postId || receipt.inputHash !== job.inputHash)
    throw new Error("Finished scene and matching receipt required");
  return withJobRepo(job, async () => {
    const { sources, composition } = await readVerifiedSources(repo, job);
    const expected = composition === "single-artwork" ? 1 : 3;
    if (receipt.scene!.placements.length !== expected ||
        new Set(receipt.scene!.placements.map(item => item.sourceRef)).size !== expected ||
        sources.some(source => !receipt.scene!.placements.some(item => item.sourceRef === source.ref)))
      throw new Error("Generation delivery placements do not match reviewed artworks");
    const background = await readProviderBackground(job.imageUrl!, receipt.scene!.backgroundSha256);
    return compositeArtworkScene({ background, sources, placements: receipt.scene!.placements, composition });
  });
}
