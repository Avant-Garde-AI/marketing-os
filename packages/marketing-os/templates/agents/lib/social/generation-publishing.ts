/** Trusted delivery → post binding. Preview is read-only; writes run only in gate execute. */
import { z } from "zod";
import type { SocialPost, SocialRepo } from "./types";
import { parsePost, postPath, renderedSequenceSchema, serializePost } from "./artifacts";
import { loadGenerationCarousel, readPersistedCarouselImage } from "./generation-carousel";
import { readGenerationInput } from "./generation-input";
import { generationDeliveryRepoFromPreview, loadGenerationDelivery } from "./generation-delivery";
import { loadGenerationJobForPost } from "./generation-review";
import { saveSocialImage, validateSocialAssetBase } from "../storyboard/assets";
import { getTenant } from "../tenant-context";
import { hashPreview } from "../actions/hash";
import { createSocialActions } from "./actions";
import { socialActionDeps } from "./register-actions";
import { socialRepo } from "./repo";
import { registerAction } from "../actions/registry";
import { instagramIdentity } from "./channels/instagram";
import { brokerTokenSource } from "./channels";
import { socialCarouselReviewLink } from "./review-links";

export const carouselIntentSchema = z.object({
  postId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/),
  expectedManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  accountId: z.string().regex(/^\d+$/), accountUsername: z.string().min(1).max(100),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export type CarouselIntent = z.infer<typeof carouselIntentSchema>;
export const carouselManifestHash = (manifest: unknown) => hashPreview(manifest);

/** Verifies source bytes, finished broker jobs, delivery bindings, final JPEGs and destination. */
export async function readPublishableCarousel(repo: SocialRepo, p: CarouselIntent, base: string) {
  const tenant = getTenant();
  const githubRepo = tenant.githubRepo ?? process.env.GITHUB_REPO;
  if (!githubRepo) throw new Error("A tenant store repository is required");
  validateSocialAssetBase(base);
  const manifest = await loadGenerationCarousel(repo, p.postId);
  if (!manifest || carouselManifestHash(manifest) !== p.expectedManifestHash)
    throw new Error("Carousel changed; reload the complete review before publishing");
  if ([...manifest.caption].length > 2200) throw new Error("Instagram caption exceeds 2,200 characters");
  const identity = await instagramIdentity(brokerTokenSource);
  if (identity.id !== p.accountId || identity.username !== p.accountUsername)
    throw new Error("Connected Instagram account changed; review the destination again");
  const assets: Buffer[] = [], deliveryHashes: string[] = [];
  for (const slide of manifest.slides) {
    const input = await readGenerationInput(repo, slide.artifactId);
    if (input.inputHash !== slide.inputHash || input.plan.postId !== slide.postId ||
        input.plan.mechanic !== "collection-scene" || input.plan.sceneComposition !== "single-artwork")
      throw new Error("Carousel immutable source binding changed");
    const job = await loadGenerationJobForPost(slide.postId);
    if (!job || job.state !== "succeeded" || !job.imageUrl || job.artifactId !== slide.artifactId ||
        job.inputHash !== slide.inputHash || job.mechanic !== "collection-scene" ||
        generationDeliveryRepoFromPreview(job) !== githubRepo) throw new Error("Carousel generation job is incomplete or mismatched");
    const delivery = await loadGenerationDelivery(repo, job);
    if (!delivery?.scene) throw new Error("Carousel delivery receipt missing");
    deliveryHashes.push(hashPreview(delivery));
    assets.push(await readPersistedCarouselImage(repo, slide));
  }
  const sequence = renderedSequenceSchema.parse({ version: 1, origin: "generation-delivery",
    parentPostId: manifest.parentPostId, manifestHash: p.expectedManifestHash, deliveryHashes,
    slides: manifest.slides.map((s, i) => ({ beatId: s.artifactId, boardName: `slide-${i + 1}`,
      sha256: s.finalImage!.sha256, width: 1080, height: 1350,
      url: `${base.replace(/\/$/, "")}/api/social/assets/${tenant.shop}/${s.finalImage!.sha256}.jpeg` })) });
  const candidate: SocialPost = { id: p.postId, groupId: p.postId, channel: "instagram", channelAccount: identity,
    copy: manifest.caption, assetRefs: manifest.slides.map(s => `social/assets/${s.finalImage!.sha256}.jpeg.b64`),
    renderedSequence: sequence, targetLink: base, provenance: [], status: "asset_ready",
    body: "Three ordered lifestyle scenes. Source-verified generation deliveries; no storyboard-selection claim.\n" +
      manifest.slides.map((s, i) => `${i + 1}. ${s.artistCredit ?? s.postId}`).join("\n") };
  const raw = await repo.readFile(postPath(p.postId));
  if (raw) {
    const prior = parsePost(raw);
    if (prior.channel !== candidate.channel || prior.copy !== candidate.copy ||
        JSON.stringify(prior.renderedSequence) !== JSON.stringify(sequence) ||
        JSON.stringify(prior.channelAccount) !== JSON.stringify(identity))
      throw new Error("Bound post differs from the reviewed delivery; rebind with a new review");
    return { post: prior, assets };
  }
  return { post: candidate, assets };
}

export async function persistCarouselBinding(repo: SocialRepo, material: Awaited<ReturnType<typeof readPublishableCarousel>>, base: string) {
  const { post, assets } = material;
  for (const bytes of assets) await saveSocialImage(repo, getTenant().shop, bytes, base);
  // Never regress a scheduled/published post during binding.
  if (!await repo.readFile(postPath(post.id))) await repo.writeFile(postPath(post.id), serializePost(post));
}

function carouselAction(mode: "publish" | "schedule") {
  return {
    kind: `social.${mode}_carousel`, title: mode === "publish" ? "Publish reviewed carousel" : "Schedule reviewed carousel",
    risk: "medium" as const, scopes: ["social:publish"], paramsSchema: carouselIntentSchema,
    async preview(p: CarouselIntent) {
      if (mode === "schedule" && (!p.scheduledAt || Date.parse(p.scheduledAt) <= Date.now()))
        throw new Error("Choose a future publish time");
      if (mode === "publish" && p.scheduledAt) throw new Error("Immediate publish must not include a schedule time");
      const base = process.env.MOS_AGENTS_PUBLIC_URL ?? "";
      const { post } = await readPublishableCarousel(socialRepo, p, base);
      const memoryRepo: SocialRepo = { ...socialRepo, readFile: async path => path === postPath(p.postId) ? serializePost(post) : socialRepo.readFile(path) };
      const actions = createSocialActions({ ...socialActionDeps(), repo: memoryRepo, validateMaterial: undefined });
      const preview = mode === "publish" ? await actions.publishPost.preview({ postId: p.postId })
        : await actions.schedulePost.preview({ postId: p.postId, scheduledAt: p.scheduledAt! });
      const tenant = getTenant();
      return { ...preview, rows: [{ label: "Destination", value: `Instagram @${p.accountUsername} (${p.accountId})` },
        { label: "Complete caption", value: post.copy }, ...(preview.rows ?? []).filter(r => r.label !== "Caption")],
        previewUrl: socialCarouselReviewLink(tenant.shop, p.postId, tenant.githubRepo ?? process.env.GITHUB_REPO!).url,
        previewHash: hashPreview({ mode, params: p, postPreview: preview.previewHash }) };
    },
    async execute(p: CarouselIntent) {
      const base = process.env.MOS_AGENTS_PUBLIC_URL ?? "";
      const deps = socialActionDeps();
      return deps.withPostLock!(p.postId, async () => {
      const material = await readPublishableCarousel(socialRepo, p, base);
      await persistCarouselBinding(socialRepo, material, base);
      const actions = createSocialActions({ ...deps, withPostLock: undefined, validateMaterial: undefined });
      return mode === "publish" ? actions.publishPost.execute({ postId: p.postId })
        : actions.schedulePost.execute({ postId: p.postId, scheduledAt: p.scheduledAt! });
      });
    },
  };
}
registerAction("social.publish_carousel", () => carouselAction("publish"));
registerAction("social.schedule_carousel", () => carouselAction("schedule"));
