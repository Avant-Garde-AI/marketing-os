/**
 * An owner's own edit to a post, made on the review screen.
 *
 * The agent's authoring path treats any copy change as "realize and review
 * again": it unbinds the rendered media and drops the post to `proposed`. That
 * is right for an agent, which may have changed what the creative should be.
 * It is wrong for the owner fixing a word in a caption — the video did not
 * change, and making them wait on a re-render to correct a typo is how edits
 * end up not being made.
 *
 * So this keeps the media bound and moves the receipts with the caption: the
 * delivery receipt (video) or carousel manifest (slides) carries the caption
 * the publisher re-checks, and its hash is re-derived here. What it never does
 * is keep consent: editing a scheduled post takes it off the schedule, with
 * its time remembered, so the next click approves exactly what is on screen.
 */
import { hashPreview } from "../actions/hash";
import { parsePost, postPath, serializePost } from "./artifacts";
import { generationCarouselPath, loadGenerationCarousel } from "./generation-carousel";
import { generationDeliveryPath, generationDeliverySchema } from "./generation-delivery";
import { carouselManifestHash } from "./generation-publishing";
import { socialActionDeps } from "./register-actions";
import type { SocialPost } from "./types";

const EDITABLE = new Set(["proposed", "asset_ready", "scheduled"]);
const INSTAGRAM_CAPTION_MAX = 2200;

export interface OwnerEdit {
  copy?: string;
  /** ISO datetime the owner wants it to go out. Recorded, never consent. */
  plannedAt?: string;
}

export async function ownerEditPost(
  postId: string,
  edit: OwnerEdit,
  actor: string,
): Promise<{ post: SocialPost; unscheduled: boolean }> {
  const deps = socialActionDeps();
  const run = async () => {
    const raw = await deps.repo.readFile(postPath(postId));
    if (raw === null) throw new Error(`Post ${postId} not found`);
    const post = parsePost(raw);
    if (!EDITABLE.has(post.status))
      throw new Error(`This post is ${post.status}, so it can no longer be edited.`);

    const next: SocialPost = { ...post };
    let changed = false;

    if (edit.copy !== undefined) {
      const copy = edit.copy.replace(/\r\n/g, "\n").trim();
      if (!copy) throw new Error("A caption cannot be empty.");
      if ([...copy].length > INSTAGRAM_CAPTION_MAX)
        throw new Error(`Captions are limited to ${INSTAGRAM_CAPTION_MAX.toLocaleString("en-US")} characters.`);
      if (copy !== post.copy) {
        const video = post.renderedVideo;
        const sequence = post.renderedSequence;
        if (video) {
          if (!("origin" in video)) throw new Error("This video's caption is part of its storyboard. Ask the agent to revise it.");
          const path = generationDeliveryPath(video.artifactId);
          const receiptRaw = await deps.repo.readFile(path);
          if (!receiptRaw) throw new Error("This video's delivery record is missing, so its caption cannot be changed here.");
          const receipt = generationDeliverySchema.parse({ ...JSON.parse(receiptRaw), caption: copy });
          await deps.repo.writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
          next.renderedVideo = { ...video, deliveryHash: hashPreview(receipt) };
        } else if (sequence) {
          if (!("origin" in sequence)) throw new Error("These slides' caption is part of their storyboard. Ask the agent to revise it.");
          const path = generationCarouselPath(postId);
          const manifestRaw = await deps.repo.readFile(path);
          if (!manifestRaw) throw new Error("This carousel's record is missing, so its caption cannot be changed here.");
          await deps.repo.writeFile(path, `${JSON.stringify({ ...JSON.parse(manifestRaw), caption: copy }, null, 2)}\n`);
          const manifest = await loadGenerationCarousel(deps.repo, postId);
          if (!manifest) throw new Error("The carousel record did not save.");
          next.renderedSequence = { ...sequence, manifestHash: carouselManifestHash(manifest) };
        }
        next.copy = copy;
        changed = true;
      }
    }

    if (edit.plannedAt !== undefined) {
      const at = new Date(edit.plannedAt);
      if (Number.isNaN(at.getTime())) throw new Error("That is not a valid time.");
      if (at.getTime() <= Date.now()) throw new Error("Pick a time in the future.");
      const iso = at.toISOString().replace(".000Z", "Z");
      if (iso !== (post.scheduledAt ?? post.plannedAt)) {
        next.plannedAt = iso;
        changed = true;
      }
    }

    if (!changed) return { post, unscheduled: false };

    // Consent covered the old caption and the old time. Neither survives.
    let unscheduled = false;
    if (post.status === "scheduled") {
      if (next.plannedAt === post.plannedAt && post.scheduledAt) next.plannedAt = post.scheduledAt;
      delete next.scheduledAt;
      delete next.approval;
      next.status = "asset_ready";
      unscheduled = true;
    }
    next.provenance = [
      ...post.provenance,
      { claim: `Edited on the review screen by ${actor} (${[edit.copy !== undefined ? "caption" : null, edit.plannedAt !== undefined ? "time" : null].filter(Boolean).join(", ")}).`, origin: "owner" },
    ];
    await deps.repo.writeFile(postPath(postId), serializePost(next));
    await deps.onPostSaved?.(next);
    return { post: next, unscheduled };
  };
  return deps.withPostLock ? deps.withPostLock(postId, run) : run();
}
