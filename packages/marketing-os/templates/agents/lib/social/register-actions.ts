/**
 * Register the social pack's three publish Actions with the runtime registry
 * (spec 24 SM2 → spec 20 A1) — the exact shape of lib/email/register-actions.
 * Factories construct per call inside runWithTenant — bindings (repo, channel
 * adapters, asset URL) resolve from the tenant context.
 *
 * Import side effect: pulled in once by the agent/tool layer
 * (src/mastra/tools/social.ts) and by the gate's /api/actions/execute route;
 * the cron shares the same deps via socialActionDeps() so gate-dispatched and
 * cron-fired publishes run ONE implementation.
 */

import { createSocialActions, type SocialActionDeps } from "./actions";
import { socialRepo } from "./repo";
import { adapterFor } from "./channels";
import { registerAction } from "../actions/registry";
import { getDesignSurfaceAdapter, isDesignSurfacesConfigured } from "../design-surfaces/config";
import type { SocialPost } from "./types";

/**
 * The post's creative as a PUBLIC image URL — the design-surface export route
 * (stateless server render; unguessable UUID is the access control, same
 * surfacing pattern as chat galleries/Slack cards). format=jpeg because
 * Instagram's Content Publishing API only fetches JPEG.
 */
export function socialAssetUrl(post: SocialPost): string {
  const base = process.env.MOS_AGENTS_PUBLIC_URL;
  if (!base) {
    throw new Error("MOS_AGENTS_PUBLIC_URL not configured — cannot build a public asset URL for publishing");
  }
  if (!post.designSurface) {
    throw new Error(
      `post "${post.id}" has no Design Surface bound — compose the creative and link it (social_link_design) before publishing`,
    );
  }
  const { fileId, pageId } = post.designSurface;
  const qs = new URLSearchParams({ format: "jpeg" });
  if (pageId) qs.set("pageId", pageId);
  return `${base.replace(/\/$/, "")}/api/design-surfaces/export/${fileId}?${qs.toString()}`;
}

/**
 * Current canvas revision of the post's bound Design Surface — the
 * canvas-edit detector behind approve-at-schedule (spec 23 `edited`
 * fallback). Null on ANY failure by design: an unresolvable revision must
 * degrade the consent check to hash-only, never block scheduling — a
 * genuinely dead canvas fails the publish at asset-fetch, visibly.
 */
export async function socialSurfaceRevision(post: SocialPost): Promise<number | null> {
  if (!post.designSurface || !isDesignSurfacesConfigured()) return null;
  try {
    const structure = await getDesignSurfaceAdapter().getFileStructure(post.designSurface.fileId);
    return structure.revn;
  } catch (e) {
    console.error(
      `[social] surface revision unavailable for post "${post.id}": ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}

/** One deps construction for every executor (propose preview, gate execute, cron). */
export function socialActionDeps(): SocialActionDeps {
  return {
    repo: socialRepo,
    adapterFor: (channel) => adapterFor(channel),
    assetUrl: socialAssetUrl,
    surfaceRevision: socialSurfaceRevision,
  };
}

let registered = false;

/** Idempotent module-level registration. */
export function registerSocialActions(): void {
  if (registered) return;
  registered = true;
  registerAction("social.schedule_post", () => createSocialActions(socialActionDeps()).schedulePost);
  registerAction("social.publish_post", () => createSocialActions(socialActionDeps()).publishPost);
  registerAction("social.cancel_post", () => createSocialActions(socialActionDeps()).cancelPost);
}

registerSocialActions();
