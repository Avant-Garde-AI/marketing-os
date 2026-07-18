/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM2 — fix bugs upstream first, then re-vendor).
 */
/**
 * The three social publish Actions (spec 24 §4, SM2) — spec 20 Action<P>
 * declarations, same shape and discipline as the email pack's
 * (packages/skills/email-campaign/src/actions.ts).
 *
 * DECLARED here (the pack owns the semantics), EXECUTED by the platform gate:
 * the hosted runtime registers these factories; marketing-os-app's gate calls
 * preview() at propose time and execute() only after a human approval claims
 * the proposal's nonce. The pack never sees a platform credential — the
 * channel adapter (SocialChannelAdapter, runtime-bound) owns that seam.
 *
 * Approve-at-schedule (spec 24 D2): approving social.schedule_post IS consent
 * to publish at time T. Its execute() records an approval hash over exactly
 * the publish material (channel, copy, target link, creative binding, asset
 * refs, time); the cron recomputes that hash from current file state before
 * publishing — any post-approval edit invalidates the consent, the post drops
 * back to asset_ready, and the card re-arms. What was approved is exactly
 * what ships, or it re-asks.
 *
 * social.publish_post is BOTH the immediate-publish Action and the cron's
 * execute path (§5): one publish implementation, two triggers, both under the
 * schedule approval's consent or a direct approval.
 *
 * Asset gating: publishing REQUIRES the post's creative — a bound Design
 * Surface (spec 23) whose export is the image the platform fetches. Previews
 * fail with a clear message when the post isn't asset_ready.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Action, ActionPreview, ActionResult } from "../skill-kit";
import type { SocialChannelAdapter, SocialPost, SocialRepo } from "./types";
import { parsePost, postPath, serializePost } from "./artifacts";

// ---------------------------------------------------------------------------
// Dependencies — the runtime binds these; tests bind fakes
// ---------------------------------------------------------------------------

export interface SocialActionDeps {
  repo: SocialRepo;
  /**
   * Resolve the channel's publishing adapter (lib/social/channels in the
   * runtime — Instagram + Threads first). Throws for unsupported channels.
   */
  adapterFor: (channel: string) => SocialChannelAdapter;
  /**
   * PUBLIC image URL for the post's bound Design Surface export — the exact
   * bytes the platform will fetch (the runtime points this at the
   * design-surface export route). Throws when the post has no surface bound.
   */
  assetUrl: (post: SocialPost) => string;
  /**
   * Current Penpot revision (revn) of the post's bound Design Surface — the
   * canvas-edit detector (spec 23 `edited` fallback): edits bump the revn
   * without touching the designSurface ref, which the publish-material hash
   * can't see. Bound by the runtime to the design-surface adapter; return
   * null when unresolvable (no surface, canvas unreachable) — the check
   * degrades to hash-only, exactly the pre-seam behavior. Optional so repo
   * bindings without a design-surface lane still typecheck.
   */
  surfaceRevision?: (post: SocialPost) => Promise<number | null>;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function hashMaterial(material: unknown): string {
  return sha256(JSON.stringify(material));
}

async function loadPost(repo: SocialRepo, id: string): Promise<SocialPost> {
  const raw = await repo.readFile(postPath(id));
  if (raw === null) throw new Error(`post "${id}" not found (${postPath(id)})`);
  return parsePost(raw);
}

async function savePost(repo: SocialRepo, post: SocialPost): Promise<void> {
  await repo.writeFile(postPath(post.id), serializePost(post));
}

/**
 * The publish material — everything that affects what ships. The schedule
 * approval's hash is computed over this; the cron recomputes it from current
 * file state, so ANY drift (copy edit, time move, creative rebinding, asset
 * change) invalidates the consent. Note: a canvas edit that doesn't change
 * the designSurface REF is not caught here — that's spec 23's `edited`
 * webhook flag (SM3 hardening); v1 treats the binding as the creative's
 * identity.
 */
export function publishMaterial(post: SocialPost): Record<string, unknown> {
  return {
    postId: post.id,
    channel: post.channel,
    copy: post.copy,
    targetLink: post.targetLink,
    assetRefs: post.assetRefs,
    designSurface: post.designSurface ?? null,
    scheduledAt: post.scheduledAt ?? null,
  };
}

/** The approve-at-schedule consent hash (stored in post.approval, re-checked by the cron). */
export function approvalHash(post: SocialPost): string {
  return hashMaterial(publishMaterial(post));
}

/**
 * The full consent re-verification the cron runs before publishing a
 * scheduled post (D2): the publish-material hash (copy/time/binding drift)
 * AND the canvas revision (edits that don't change the binding). Lives here
 * so the consent semantics stay in the pack — the cron just acts on the
 * verdict. A null current revision (canvas unreachable, seam unbound) skips
 * the revision check rather than blocking: a genuinely unreachable canvas
 * fails the publish at asset-fetch anyway, visibly.
 */
export async function verifyScheduleConsent(
  post: SocialPost,
  deps: Pick<SocialActionDeps, "surfaceRevision">,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!post.approval) return { ok: false, reason: "scheduled post has no approval record" };
  if (post.approval.hash !== approvalHash(post)) {
    return { ok: false, reason: "publish material changed since approval" };
  }
  if (post.approval.surfaceRevn != null && deps.surfaceRevision) {
    const current = await deps.surfaceRevision(post);
    if (current != null && current !== post.approval.surfaceRevn) {
      return {
        ok: false,
        reason: `creative was edited on the canvas since approval (revision ${post.approval.surfaceRevn} → ${current})`,
      };
    }
  }
  return { ok: true };
}

/**
 * Publishing readiness — shared by both publish-path previews. Throws the
 * clear message the approver (and the agent) needs when the post isn't ready.
 */
function requirePublishable(post: SocialPost, allowed: string[]): void {
  if (!allowed.includes(post.status)) {
    throw new Error(
      `post "${post.id}" is "${post.status}" — only ${allowed.join("/")} posts can take this action` +
        (post.status === "proposed" || post.status === "approved"
          ? " (compose the creative and export it first — the post must be asset_ready)"
          : ""),
    );
  }
  if (!post.designSurface) {
    throw new Error(
      `post "${post.id}" has no Design Surface bound — it is not asset_ready. Compose the creative (compose_design_surface, kind "social.post") and link it (social_link_design) first.`,
    );
  }
}

function baseRows(post: SocialPost): { label: string; value: string }[] {
  return [
    { label: "Channel", value: post.channel },
    { label: "Caption", value: post.copy.length > 120 ? `${post.copy.slice(0, 117)}…` : post.copy },
    { label: "Link", value: post.targetLink },
  ];
}

// ---------------------------------------------------------------------------
// social.schedule_post (medium) — approval = consent to publish at T (D2)
// ---------------------------------------------------------------------------

const scheduleParams = z.object({
  postId: z.string().min(1),
  scheduledAt: z
    .string()
    .datetime({ offset: true })
    .describe("ISO datetime — approval is consent to publish at this time, no second touch"),
});
export type SchedulePostParams = z.infer<typeof scheduleParams>;

function schedulePost(deps: SocialActionDeps): Action<SchedulePostParams> {
  return {
    kind: "social.schedule_post",
    title: "Schedule social post",
    paramsSchema: scheduleParams,
    summary: (p) =>
      `Schedule post "${p.postId}" to publish at ${p.scheduledAt} — approval IS consent to publish`,
    scopes: ["social:publish"],
    risk: "medium",
    async preview(p) {
      const post = await loadPost(deps.repo, p.postId);
      requirePublishable(post, ["asset_ready", "scheduled"]);
      if (Date.parse(p.scheduledAt) <= Date.now()) {
        throw new Error(
          `scheduledAt ${p.scheduledAt} is in the past — use social.publish_post to publish now`,
        );
      }
      const asset = deps.assetUrl(post); // throws when unresolvable — publish would too
      const scheduled: SocialPost = { ...post, scheduledAt: p.scheduledAt };
      const warnings: string[] = [];
      if (post.status === "scheduled" && post.scheduledAt !== p.scheduledAt) {
        warnings.push(`reschedules from ${post.scheduledAt} — the previous approval is replaced`);
      }
      return {
        summary: `Publish to ${post.channel} at ${p.scheduledAt} — the cron ships it with no second touch. The card image IS the final creative.`,
        rows: [
          ...baseRows(post),
          { label: "Publish time", value: p.scheduledAt },
          { label: "Undo", value: "social.cancel_post any time before publish" },
        ],
        previewUrl: asset,
        ...(warnings.length ? { warnings } : {}),
        previewHash: hashMaterial({ kind: "social.schedule_post", material: publishMaterial(scheduled) }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const post = await loadPost(deps.repo, p.postId);
      // Idempotent: already scheduled at exactly this time with a live consent.
      if (post.status === "scheduled" && post.scheduledAt === p.scheduledAt && post.approval) {
        return {
          ok: true,
          summary: `already scheduled for ${p.scheduledAt}`,
          detail: { postId: post.id, scheduledAt: p.scheduledAt },
        };
      }
      requirePublishable(post, ["asset_ready", "scheduled"]);
      const scheduled: SocialPost = { ...post, scheduledAt: p.scheduledAt, status: "scheduled" };
      delete scheduled.failure;
      // The consent record the cron re-verifies (D2). Hash covers the post's
      // publish material AS APPROVED — current file state at execute time,
      // which the gate guarantees matches the previewed state (nonce). The
      // canvas revision pins the creative's PIXELS at approval time — edits
      // bump it without changing the binding, so hash alone can't see them.
      const surfaceRevn = (await deps.surfaceRevision?.(scheduled)) ?? null;
      scheduled.approval = {
        hash: approvalHash(scheduled),
        at: new Date().toISOString(),
        ...(surfaceRevn != null ? { surfaceRevn } : {}),
      };
      await savePost(deps.repo, scheduled);
      return {
        ok: true,
        summary: `Scheduled — publishes to ${post.channel} at ${p.scheduledAt} (consent recorded; edits re-arm the card)`,
        detail: { postId: post.id, scheduledAt: p.scheduledAt, approvalHash: scheduled.approval.hash },
      } satisfies ActionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// social.publish_post (medium) — immediate publish; ALSO the cron's execute path
// ---------------------------------------------------------------------------

const publishParams = z.object({
  postId: z.string().min(1),
});
export type PublishPostParams = z.infer<typeof publishParams>;

function publishPost(deps: SocialActionDeps): Action<PublishPostParams> {
  return {
    kind: "social.publish_post",
    title: "Publish social post now",
    paramsSchema: publishParams,
    summary: (p) => `Publish post "${p.postId}" immediately — it goes live on approve`,
    scopes: ["social:publish"],
    risk: "medium",
    async preview(p) {
      const post = await loadPost(deps.repo, p.postId);
      requirePublishable(post, ["asset_ready", "scheduled", "failed"]);
      deps.adapterFor(post.channel); // unsupported channel fails at preview, not after approval
      const asset = deps.assetUrl(post);
      return {
        summary: `Publish to ${post.channel} NOW — live the moment this is approved. The card image IS the final creative.`,
        rows: [
          ...baseRows(post),
          { label: "Publish time", value: "immediately on approval" },
          { label: "Undo", value: "none after publish (delete on-platform manually)" },
        ],
        previewUrl: asset,
        ...(post.status === "failed" && post.failure
          ? { warnings: [`retries a failed publish (last error: ${post.failure})`] }
          : {}),
        previewHash: hashMaterial({ kind: "social.publish_post", material: publishMaterial(post) }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const post = await loadPost(deps.repo, p.postId);
      // Idempotent: a retry after a landed publish returns what exists.
      if (post.status === "published" && post.platform) {
        return {
          ok: true,
          summary: `already published (${post.platform.permalink || post.platform.id})`,
          detail: { postId: post.id, ...post.platform },
        };
      }
      requirePublishable(post, ["asset_ready", "scheduled", "failed"]);
      const adapter = deps.adapterFor(post.channel);
      const asset = deps.assetUrl(post);
      try {
        const { platformId, permalink } = await adapter.publish(post, asset);
        const published: SocialPost = {
          ...post,
          status: "published",
          platform: { id: platformId, permalink, publishedAt: new Date().toISOString() },
        };
        delete published.failure;
        await savePost(deps.repo, published);
        return {
          ok: true,
          summary: `Published to ${post.channel}${permalink ? ` — ${permalink}` : ` (id ${platformId})`}`,
          detail: { postId: post.id, platformId, permalink },
        } satisfies ActionResult;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Record the failure on the artifact FIRST (files are truth), then
        // surface it — the gate audits the error, the cron flags it.
        const failed: SocialPost = { ...post, status: "failed", failure: message };
        await savePost(deps.repo, failed);
        throw new Error(`publish to ${post.channel} failed: ${message}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// social.cancel_post (low) — the undo lane
// ---------------------------------------------------------------------------

const cancelParams = z.object({
  postId: z.string().min(1),
  discard: z
    .boolean()
    .optional()
    .describe("false/absent → back to asset_ready (re-schedulable); true → cancelled"),
});
export type CancelPostParams = z.infer<typeof cancelParams>;

function cancelPost(deps: SocialActionDeps): Action<CancelPostParams> {
  return {
    kind: "social.cancel_post",
    title: "Cancel scheduled post",
    paramsSchema: cancelParams,
    summary: (p) => `Cancel the scheduled publish of post "${p.postId}"`,
    scopes: ["social:publish"],
    risk: "low",
    async preview(p) {
      const post = await loadPost(deps.repo, p.postId);
      if (post.status !== "scheduled") {
        throw new Error(`post "${p.postId}" is "${post.status}" — only scheduled posts cancel`);
      }
      return {
        summary: `Cancel "${post.id}" (was publishing to ${post.channel} at ${post.scheduledAt})`,
        rows: [
          ...baseRows(post),
          { label: "Was publishing", value: post.scheduledAt ?? "—" },
          { label: "After cancel", value: p.discard ? "cancelled" : "back to asset_ready" },
        ],
        previewHash: hashMaterial({
          kind: "social.cancel_post",
          postId: post.id,
          scheduledAt: post.scheduledAt ?? null,
        }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const post = await loadPost(deps.repo, p.postId);
      if (post.status !== "scheduled") {
        // Idempotent: already pulled.
        return { ok: true, summary: `post "${p.postId}" is "${post.status}" — nothing scheduled`, detail: { postId: post.id } };
      }
      const updated: SocialPost = { ...post, status: p.discard ? "cancelled" : "asset_ready" };
      delete updated.scheduledAt;
      delete updated.approval;
      await savePost(deps.repo, updated);
      return {
        ok: true,
        summary: p.discard ? "Cancelled — post retired" : "Cancelled — post back to asset_ready",
        detail: { postId: post.id },
      } satisfies ActionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// The factory (spec 20 §5 `actions` — bound per tenant by the runtime)
// ---------------------------------------------------------------------------

export function createSocialActions(deps: SocialActionDeps): {
  schedulePost: Action<SchedulePostParams>;
  publishPost: Action<PublishPostParams>;
  cancelPost: Action<CancelPostParams>;
} {
  return {
    schedulePost: schedulePost(deps),
    publishPost: publishPost(deps),
    cancelPost: cancelPost(deps),
  };
}
