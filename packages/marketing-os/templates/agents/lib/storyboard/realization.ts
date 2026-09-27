import { z } from "zod";
import sharp from "sharp";
import { hashPreview } from "../actions/hash";
import { registerAction } from "../actions/registry";
import type { RuntimeAction } from "../actions/types";
import { getTenant } from "../tenant-context";
import { socialRepo } from "../social/repo";
import { parsePost, postPath, serializePost, linkDesignToPost, renderedSequenceSchema } from "../social/artifacts";
import { syncPostIndex } from "../social/index-sync";
import { socialReviewLink } from "../social/review-links";
import { getDesignSurfaceAdapter } from "../design-surfaces/config";
import { getTenantTeam } from "../design-surfaces/tenancy";
import { createSurface, exportSurfaceBoards } from "../design-surfaces/surface";
import { checkComposeFit } from "../design-surfaces/compose";
import type { ComposeSpec, ComposeElement } from "../design-surfaces/types";
import { getBrandInstructions } from "../../src/mastra/brand/store";
import { loadBrandTokens } from "../../src/mastra/tools/design-surfaces";
import { readSelectedStoryboard } from "./reviews";
import { imageDigest, saveSocialImage, validateSocialAssetBase } from "./assets";
import type { Storyboard } from "./types";
import type { PlanningContext } from "./schemas";

const box = z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() });
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const slideLayoutSchema = z.object({
  beatId: z.string().min(1),
  boardName: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  width: z.number().int().min(320).max(2160), height: z.number().int().min(320).max(2160),
  backgroundColor: color,
  image: box.extend({
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    // Normalized source coordinates, explicit rather than an automatic guessed crop.
    crop: z.object({ left: z.number().min(0).max(1), top: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).optional(),
  }),
  copy: box.extend({ fontFamily: z.string().min(1).max(80), fontSize: z.number().min(12).max(160), color, textAlign: z.enum(["left", "center", "right"]) }).optional(),
}).strict();
export const realizationParamsSchema = z.object({
  reviewId: z.string().regex(/^[a-z0-9-]{1,100}$/), reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  postId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), layouts: z.array(slideLayoutSchema).min(1).max(10),
}).strict();
export type SlideLayout = z.infer<typeof slideLayoutSchema>;
type RealizationParams = z.infer<typeof realizationParamsSchema>;

/** Source-only first adapter. Unsupported generation/motion never silently falls back to a catalog stack. */
export function validateRealization(story: Storyboard, context: PlanningContext, layouts: SlideLayout[]): void {
  if (story.format === "video" || layouts.length !== story.beats.length) throw new Error("Still realization requires exactly one layout per beat");
  if (new Set(layouts.map(l => l.boardName)).size !== layouts.length) throw new Error("Board names must be unique");
  const size = `${layouts[0]?.width}:${layouts[0]?.height}`;
  for (const [i, beat] of story.beats.entries()) {
    const l = layouts[i]!;
    if (l.beatId !== beat.id) throw new Error("Layouts must preserve exact storyboard beat order");
    if (beat.brief.seconds) throw new Error("Motion requires a separately quoted imagery adapter");
    if (`${l.width}:${l.height}` !== size) throw new Error("Carousel slide dimensions must agree");
    if (l.width / l.height < 0.8 || l.width / l.height > 1.91) throw new Error("Unsupported Instagram image aspect");
    if (beat.brief.aspect) {
      const parts = beat.brief.aspect.split(":").map(Number);
      if (parts.length !== 2 || !parts[0] || !parts[1] || Math.abs(l.width / l.height - parts[0] / parts[1]) > 0.01)
        throw new Error("Layout aspect differs from selected visual brief");
    }
    if (!beat.brief.asset || beat.brief.sourcing === "generated" || beat.brief.asset.use === "mockup-input")
      throw new Error("This adapter requires an existing source asset; generation and mockups require a separately quoted imagery adapter");
    if (!context.assets.some(a => a.ref === beat.brief.asset!.ref)) throw new Error("Asset is absent from reviewed context");
    if (beat.brief.asset.use === "detail-crop" && !l.image.crop) throw new Error("Detail crop requires explicit source coordinates");
    if (beat.brief.asset.use === "as-is" && l.image.crop) throw new Error("An as-is beat cannot crop its source");
    const c = l.image.crop;
    if (c && (c.left + c.width > 1.000001 || c.top + c.height > 1.000001)) throw new Error("Crop extends beyond source pixels");
    if (!!beat.copy?.trim() !== !!l.copy) throw new Error("Every selected on-slide copy needs exactly one text placement");
    for (const b of [l.image, ...(l.copy ? [l.copy] : [])])
      if (b.x + b.width > l.width || b.y + b.height > l.height) throw new Error("Layout extends beyond board");
  }
}

/** Bounded read; hash is bound into the gate preview so expiring or changed source pixels cannot drift. */
export async function fetchReviewedSource(ref: string): Promise<Uint8Array> {
  const url = new URL(ref);
  if (url.protocol !== "https:" || url.username || url.password || !["cdn.shopify.com"].includes(url.hostname))
    throw new Error("Source realization currently accepts reviewed Shopify CDN assets only");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(25000) });
  if (!response.ok || !/^image\/(jpeg|png|webp)(?:;|$)/.test(response.headers.get("content-type") ?? "")) throw new Error("Source image unavailable");
  if (Number(response.headers.get("content-length") ?? 0) > 12 * 1024 * 1024) throw new Error("Source image too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing image body");
  const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 12 * 1024 * 1024) throw new Error("Source image too large"); chunks.push(value); } }
  finally { await reader.cancel(); }
  if (!length) throw new Error("Empty image source");
  return Buffer.concat(chunks);
}

export async function sourceForLayout(bytes: Uint8Array, layout: SlideLayout): Promise<Uint8Array> {
  if (imageDigest(bytes) !== layout.image.sourceSha256) throw new Error("Source pixels changed; prepare and approve again");
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image dimensions unavailable");
  let image = sharp(bytes);
  if (layout.image.crop) {
    const c = layout.image.crop;
    const left = Math.floor(c.left * metadata.width), top = Math.floor(c.top * metadata.height);
    const width = Math.min(metadata.width - left, Math.round(c.width * metadata.width));
    const height = Math.min(metadata.height - top, Math.round(c.height * metadata.height));
    if (width < 16 || height < 16) throw new Error("Crop too small to be legible");
    image = image.extract({ left, top, width, height });
  }
  // Contain preserves aspect and source framing. Cropping is only the explicit operation above.
  return image.resize(Math.round(layout.image.width), Math.round(layout.image.height), { fit: "contain", background: layout.backgroundColor }).jpeg({ quality: 95 }).toBuffer();
}

async function material(p: RealizationParams) {
  const tenant = getTenant();
  const selected = await readSelectedStoryboard(socialRepo, p.reviewId, p.reviewHash, { tenant: tenant.shop, brand: await getBrandInstructions(tenant.shop) });
  validateRealization(selected.storyboard, selected.context, p.layouts);
  const raw = await socialRepo.readFile(postPath(p.postId));
  if (!raw) throw new Error("Author the proposed post through social_post_upsert with bound facts first");
  const post = parsePost(raw);
  if (["published", "cancelled", "declined"].includes(post.status)) throw new Error("Frozen post cannot be realized");
  if (post.copy !== selected.storyboard.caption || post.copyFormulaRef !== selected.storyboard.copyFormulaRef)
    throw new Error("Authored caption/formula must match the selected storyboard; revise and review again");
  const sources = new Map<string, Uint8Array>();
  for (const [i, beat] of selected.storyboard.beats.entries()) {
    const ref = beat.brief.asset!.ref;
    if (!sources.has(ref)) sources.set(ref, await fetchReviewedSource(ref));
    if (imageDigest(sources.get(ref)!) !== p.layouts[i]!.image.sourceSha256) throw new Error("Source pixels changed; prepare and approve again");
  }
  const brand = await loadBrandTokens(tenant.shop);
  const authored = { id: post.id, channel: post.channel, copy: post.copy, targetLink: post.targetLink, copyFormulaRef: post.copyFormulaRef, scheduledAt: post.scheduledAt };
  return { selected, post, sources, brand, previewHash: hashPreview({ p, selection: selected.selection, storyboardHash: selected.storyboardHash, post: authored, brand }) };
}

export function createRealizationAction(): RuntimeAction<RealizationParams> {
  return {
    kind: "social.storyboard_realize", title: "Realize the selected storyboard", risk: "low", scopes: [], paramsSchema: realizationParamsSchema,
    async preview(p) {
      const m = await material(p);
      return { summary: `Compose ${p.layouts.length} source-backed slides for ${p.postId}`, previewHash: m.previewHash,
        rows: [{ label: "Story", value: m.selected.storyboard.premise }, { label: "Caption", value: m.post.copy },
          ...p.layouts.map((l, i) => ({ label: `Slide ${i + 1}: ${l.beatId}`, value: JSON.stringify(l) }))],
        warnings: ["Uses existing source pixels and explicit crops. No image-generation spend. Derived crops are not bare-artwork masters.", "Publishing requires a separate approval covering the complete rendered sequence."] };
    },
    async execute(p) {
      const m = await material(p); const tenant = getTenant();
      const base = process.env.MOS_AGENTS_PUBLIC_URL;
      if (!base) throw new Error("Missing public deployment URL");
      validateSocialAssetBase(base);
      // Resume only an exact completed execution. New consent or material gets a new realization.
      const receiptPath = `social/storyboards/${p.reviewId}/realizations/${m.previewHash}.json`;
      const previous = await socialRepo.readFile(receiptPath);
      if (previous) {
        const receipt = JSON.parse(previous);
        if (JSON.stringify(receipt.renderedSequence) !== JSON.stringify(m.post.renderedSequence)) throw new Error("Previously realized post changed; use a new review or layout");
        return { ok: true, summary: "Storyboard was already realized", detail: receipt };
      }
      const boards = [];
      for (const [i, beat] of m.selected.storyboard.beats.entries()) {
        const l = p.layouts[i]!;
        const elements: ComposeElement[] = [{ type: "image", name: beat.id, x: l.image.x, y: l.image.y, width: l.image.width, height: l.image.height,
          data: await sourceForLayout(m.sources.get(beat.brief.asset!.ref)!, l), mediaType: "image/jpeg" }];
        if (l.copy) elements.push({ type: "text", name: `${beat.id}-copy`, ...l.copy, fontSize: String(l.copy.fontSize), characters: beat.copy!, fills: [{ fillColor: l.copy.color, fillOpacity: 1 }] });
        boards.push({ name: l.boardName, width: l.width, height: l.height, background: { fillColor: l.backgroundColor, fillOpacity: 1 }, elements });
      }
      const spec: ComposeSpec = { fileName: `${p.postId} — ${m.selected.storyboard.id}`, boards, ...m.brand };
      const fit = checkComposeFit(spec);
      if (fit.errors.length || fit.warnings.some(w => w.code === "text-board-clip")) throw new Error("Layout does not fit: " + [...fit.errors, ...fit.warnings].map(w => w.message).join("; "));
      const home = await getTenantTeam(tenant.shop); const adapter = getDesignSurfaceAdapter();
      const { surface } = await createSurface(adapter, { tenantId: tenant.shop, ...home, kind: "social.post", boundTo: { type: "post", id: p.postId }, spec, createdBy: "agent" });
      const rendered = await exportSurfaceBoards(adapter, { ...surface.penpot, names: p.layouts.map(l => l.boardName), format: "jpeg" });
      const slides = [];
      for (const l of p.layouts) {
        const artifact = rendered[l.boardName]!;
        const dims = await sharp(artifact.data).metadata();
        if (dims.width !== l.width || dims.height !== l.height) throw new Error("Rendered slide dimensions disagree with the approved layout");
        slides.push({ beatId: l.beatId, boardName: l.boardName, width: dims.width, height: dims.height, ...await saveSocialImage(socialRepo, tenant.shop, artifact.data, base) });
      }
      // Recheck concurrent authorship before replacing the post. A renderer failure leaves only draft assets.
      const current = await socialRepo.readFile(postPath(p.postId));
      if (!current || JSON.stringify(parsePost(current)) !== JSON.stringify(m.post)) throw new Error("Post changed during rendering; re-propose");
      await readSelectedStoryboard(socialRepo, p.reviewId, p.reviewHash, { tenant: tenant.shop, brand: await getBrandInstructions(tenant.shop) });
      const next = linkDesignToPost(m.post, surface.penpot);
      next.renderedSequence = renderedSequenceSchema.parse({ version: 1, storyboardId: m.selected.storyboard.id, storyboardHash: m.selected.storyboardHash, reviewHash: p.reviewHash, slides });
      delete next.approval; next.status = "asset_ready";
      await socialRepo.writeFile(postPath(p.postId), serializePost(next));
      await syncPostIndex(tenant.shop, next);
      const result = { postId: p.postId, storyboardId: m.selected.storyboard.id, review: socialReviewLink(tenant.shop, next.groupId ?? next.id).url, slides, renderedSequence: next.renderedSequence, designSurface: surface.penpot };
      await socialRepo.writeFile(receiptPath, JSON.stringify(result, null, 2));
      return { ok: true, summary: `Realized ${slides.length} ordered slides; ready for final review`, detail: result };
    },
  };
}

registerAction("social.storyboard_realize", createRealizationAction);
