/** Store-owned ordered delivery contract for one three-slide social carousel. */
import { z } from "zod";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { StoreRepo } from "../skill-kit";

const POST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ARTIFACT_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const renderedImage = z.object({
  sha256: z.string().regex(HASH),
  path: z.string().min(1),
}).strict().superRefine((image, ctx) => {
  if (image.path !== `social/production/renders/${image.sha256}.jpeg.b64`)
    ctx.addIssue({ code: "custom", message: "Final image path must be content-addressed" });
});
const slide = z.object({
  artifactId: z.string().regex(ARTIFACT_ID),
  postId: z.string().regex(POST_ID),
  inputHash: z.string().regex(HASH),
  artistCredit: z.string().trim().min(1).max(300).optional(),
  finalImage: renderedImage.optional(),
}).strict();

export const generationCarouselSchema = z.object({
  schemaVersion: z.literal(1),
  parentPostId: z.string().regex(POST_ID),
  caption: z.string().trim().min(1).max(5_000),
  slides: z.tuple([slide, slide, slide]),
}).strict().superRefine((manifest, ctx) => {
  const month = manifest.parentPostId.match(/^(\d{4}-(?:0[1-9]|1[0-2]))-/)?.[1];
  if (!month || manifest.slides.some(s => !s.postId.startsWith(`${month}-`) || s.postId === manifest.parentPostId))
    ctx.addIssue({ code: "custom", message: "Carousel children must belong to the parent month" });
  for (const key of ["artifactId", "postId", "inputHash"] as const)
    if (new Set(manifest.slides.map(s => s[key])).size !== 3)
      ctx.addIssue({ code: "custom", message: `Carousel ${key} values must be distinct` });
});
export type GenerationCarousel = z.infer<typeof generationCarouselSchema>;
export type GenerationCarouselSlide = GenerationCarousel["slides"][number];

export function generationCarouselPath(parentPostId: string): string {
  if (!POST_ID.test(parentPostId)) throw new Error("Invalid carousel parent post ID");
  return `social/production/carousels/${parentPostId}.json`;
}

/** Null means absent. A present malformed manifest is never treated as a normal post. */
export async function loadGenerationCarousel(repo: StoreRepo, parentPostId: string): Promise<GenerationCarousel | null> {
  const raw = await repo.readFile(generationCarouselPath(parentPostId));
  if (raw === null) return null;
  if (!raw || raw.length > 64_000) throw new Error("Carousel manifest invalid");
  const manifest = generationCarouselSchema.parse(JSON.parse(raw));
  if (manifest.parentPostId !== parentPostId) throw new Error("Carousel parent ID mismatch");
  return manifest;
}

/** Listing is bounded and reports bad manifests separately, leaving children visible. */
export async function listGenerationCarouselsForMonth(repo: StoreRepo, month: string): Promise<{
  manifests: GenerationCarousel[]; invalid: string[];
}> {
  if (!MONTH.test(month)) throw new Error("Invalid carousel month");
  const prefix = `social/production/carousels/${month}-`;
  const paths = await repo.list(prefix);
  if (paths.length > 100) throw new Error("Too many carousel manifests for month");
  const manifests: GenerationCarousel[] = [], invalid: string[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix) || !path.endsWith(".json")) continue;
    const parentPostId = path.slice("social/production/carousels/".length, -5);
    try {
      const manifest = await loadGenerationCarousel(repo, parentPostId);
      if (manifest) manifests.push(manifest);
      else invalid.push(parentPostId);
    } catch { invalid.push(parentPostId); }
  }
  return { manifests, invalid };
}

/** Read an immutable final JPEG without touching the provider. The route also
 * checks the matching broker job and delivery receipt before calling this. */
export async function readPersistedCarouselImage(repo: StoreRepo, slide: GenerationCarouselSlide): Promise<Buffer> {
  if (!slide.finalImage) throw new Error("Carousel final image absent");
  const { sha256, path } = slide.finalImage;
  if (path !== `social/production/renders/${sha256}.jpeg.b64`) throw new Error("Invalid carousel final image path");
  const encoded = await repo.readFile(path);
  if (!encoded || encoded.length > 12_000_000 || encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Carousel final image unavailable");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || createHash("sha256").update(bytes).digest("hex") !== sha256)
    throw new Error("Carousel final image hash mismatch");
  const meta = await sharp(bytes, { limitInputPixels: 2_000_000 }).metadata();
  if (meta.format !== "jpeg" || meta.width !== 1080 || meta.height !== 1350 ||
      (meta.orientation ?? 1) !== 1 || (meta.pages ?? 1) !== 1)
    throw new Error("Carousel final image dimensions invalid");
  return bytes;
}
