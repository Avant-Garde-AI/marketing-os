/** Revalidate a bound generation Reel against the exact paid job, input, export and public bytes. */
import { instagramIdentity } from "./channels/instagram";
import { brokerTokenSource } from "./channels";
import sharp from "sharp";
import type { SocialPost, SocialRepo } from "./types";
import { hashPreview } from "../actions/hash";
import { readGenerationInput } from "./generation-input";
import { loadGenerationJobForPost } from "./generation-review";
import { generationDeliveryRepoFromPreview, loadGenerationDelivery } from "./generation-delivery";
import { loadVerifiedLoopExport, loopExportManifestPath } from "./generation-export";
import { readSocialVideo } from "./video-assets";
import { readSocialImage, validateSocialAssetBase } from "../storyboard/assets";
import { getTenant } from "../tenant-context";
export async function validateGeneratedVideo(repo: SocialRepo, post: SocialPost, base: string) {
  const receipt = post.renderedVideo;
  if (!receipt || !("origin" in receipt)) return;
  validateSocialAssetBase(base);
  const account = await instagramIdentity(brokerTokenSource);
  if (!post.channelAccount || account.id !== post.channelAccount.id || account.username !== post.channelAccount.username)
    throw new Error("Connected Instagram destination changed since review");
  const tenant = getTenant(), githubRepo = tenant.githubRepo ?? process.env.GITHUB_REPO;
  const input = await readGenerationInput(repo, receipt.artifactId);
  const job = await loadGenerationJobForPost(post.id);
  if (!githubRepo || !job || job.state !== "succeeded" || job.artifactId !== receipt.artifactId ||
      job.inputHash !== receipt.inputHash || input.inputHash !== receipt.inputHash ||
      input.plan.postId !== post.id || input.plan.mechanic !== "artwork-loop" ||
      generationDeliveryRepoFromPreview(job) !== githubRepo) throw new Error("Reel generation job changed or is incomplete");
  const delivery = await loadGenerationDelivery(repo, job);
  const exportRaw = await repo.readFile(loopExportManifestPath(job.artifactId));
  if (!delivery || !exportRaw || hashPreview(delivery) !== receipt.deliveryHash ||
      hashPreview(JSON.parse(exportRaw)) !== receipt.exportHash || delivery.caption !== post.copy)
    throw new Error("Reel delivery or caption changed since review");
  const exp = await loadVerifiedLoopExport(repo, job, "reel");
  const video = await readSocialVideo(repo, receipt.video.sha256);
  const poster = await readSocialImage(repo, receipt.poster.sha256);
  const prefix = `${base.replace(/\/$/, "")}/api/social/assets/${tenant.shop}/`;
  if (!video || !poster || exp.sha256 !== receipt.video.sha256 || exp.width !== receipt.video.width ||
      exp.height !== receipt.video.height || Math.round(exp.durationSec * 1000) !== receipt.video.durationMs ||
      receipt.video.url !== `${prefix}${exp.sha256}.mp4` ||
      receipt.poster.url !== `${prefix}${receipt.poster.sha256}.jpeg` ||
      JSON.stringify(receipt.sources) !== JSON.stringify(input.plan.sources.map(s => ({ ref: s.sourceRef, sha256: s.sourceSha256 }))))
    throw new Error("Reel public assets or source bindings changed");
  const meta = await sharp(poster, { limitInputPixels: 2_100_000 }).metadata();
  if (meta.format !== "jpeg" || meta.width !== receipt.poster.width || meta.height !== receipt.poster.height ||
      meta.width !== 1080 || meta.height !== 1920) throw new Error("Reel cover dimensions invalid");
}
