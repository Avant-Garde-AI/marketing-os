/**
 * The authoring write — `social_post_upsert` (spec 26 §2 ⟨BUILD⟩, AC 1).
 *
 * Until this existed there was NO WAY to create a post artifact: the plan tool
 * returns a calendar draft without persisting, `social_link_design` only binds
 * a surface to a post that must already exist, and the publish Actions only
 * move an existing post through its lifecycle. `social_post_read` could read
 * files that nothing wrote. This closes that loop.
 *
 * Two disciplines inherited from the email pack's `email_campaign_upsert`,
 * both of which are load-bearing:
 *
 *  1. **Status is LIFECYCLE, never content-derived.** Authoring content must
 *     never promote a post. If writing a caption could set `approved`, an
 *     agent could approve its own work by writing a caption — the gate would
 *     be decorative. Status advances only through the Actions (and, for
 *     `asset_ready`, through binding a creative).
 *  2. **Post-approval edits invalidate consent (spec 24 D2).** Editing a
 *     `scheduled` post drops it back to `asset_ready` and clears the approval
 *     record, so what was approved is exactly what ships or the card re-arms.
 *     The cron enforces the same rule as a backstop; doing it here makes it
 *     immediate and visible instead of deferred to the next sweep.
 *
 * Pure and repo-only: this module builds and validates the next artifact. The
 * runtime performs the write and the index sync at its own seam — the pack
 * never touches a database.
 */

import type { SocialPost, SocialRepo } from "./types";
import { parsePost, postPath, serializePost } from "./artifacts";

/**
 * Statuses whose artifact must not be edited in place. `published` has already
 * gone out — the file is a record of what shipped, and rewriting it would make
 * the record lie. Terminal states are frozen for the same reason.
 */
const FROZEN: ReadonlySet<string> = new Set(["published", "cancelled", "declined"]);

/** Editing one of these fields changes WHAT WOULD SHIP, so it invalidates an
 * approve-at-schedule consent. Bookkeeping fields (provenance, body) do not. */
const MATERIAL_FIELDS = ["channel", "copy", "targetLink", "assetRefs", "scheduledAt"] as const;

export interface SocialPostUpsertInput {
  id: string;
  /** Required to CREATE; optional on update. */
  channel?: string;
  /** Post group (spec 26 D3) — variants of one idea share it. */
  groupId?: string;
  copy?: string;
  targetLink?: string;
  scheduledAt?: string;
  copyFormulaRef?: string;
  assetRefs?: string[];
  provenance?: { claim: string; origin: "owner" | "agent" | "data" }[];
  /** Markdown body — the agent's rationale prose. */
  body?: string;
}

export interface SocialPostUpsertResult {
  post: SocialPost;
  created: boolean;
  /** Set when a post-approval edit voided consent (spec 24 D2). */
  consentCleared: boolean;
  /** What still blocks this post from being schedulable. */
  missing: string[];
}

/** What a post still needs before `social.schedule_post` can be proposed. */
export function schedulingGaps(post: SocialPost): string[] {
  const missing: string[] = [];
  if (!post.copy.trim()) missing.push("copy (the caption)");
  if (!post.targetLink.trim()) missing.push("targetLink");
  if (!post.designSurface) {
    missing.push(
      "creative (compose_design_surface with kind 'social.post', then social_link_design)",
    );
  }
  if (post.provenance.length === 0) missing.push("provenance (at least one claim with its origin)");
  return missing;
}

/**
 * Build the next artifact for a post, applying the lifecycle rules. Returns
 * the post to write; the caller persists it and syncs the index.
 *
 * @throws when the id is unknown and no `channel`/`copy`/`targetLink` were
 *         supplied to create it, or when the artifact is frozen.
 */
export function nextPost(
  existing: SocialPost | null,
  input: SocialPostUpsertInput,
): { post: SocialPost; created: boolean; consentCleared: boolean } {
  if (existing && FROZEN.has(existing.status)) {
    throw new Error(
      `post "${input.id}" is "${existing.status}" — its artifact is frozen so the record of what shipped cannot drift. Work on a new post id.`,
    );
  }

  if (!existing) {
    const missingToCreate = [
      input.channel ? null : "channel",
      input.copy ? null : "copy",
      input.targetLink ? null : "targetLink",
    ].filter((f): f is string => f !== null);
    if (missingToCreate.length > 0) {
      throw new Error(
        `post "${input.id}" does not exist — pass ${missingToCreate.join(", ")} to create it.`,
      );
    }
  }

  const base: SocialPost = existing
    ? { ...existing }
    : {
        id: input.id,
        channel: input.channel!,
        ...(input.groupId ? { groupId: input.groupId } : {}),
        copy: input.copy!,
        targetLink: input.targetLink!,
        assetRefs: [],
        provenance: [],
        // Never anything further: a new post is proposed, and only the
        // lifecycle may advance it.
        status: "proposed",
        body: "",
      };

  const next: SocialPost = { ...base };
  if (input.channel !== undefined) next.channel = input.channel;
  if (input.groupId !== undefined) next.groupId = input.groupId;
  if (input.copy !== undefined) next.copy = input.copy;
  if (input.targetLink !== undefined) next.targetLink = input.targetLink;
  if (input.copyFormulaRef !== undefined) next.copyFormulaRef = input.copyFormulaRef;
  if (input.assetRefs !== undefined) next.assetRefs = input.assetRefs;
  if (input.provenance !== undefined) next.provenance = input.provenance;
  if (input.body !== undefined) next.body = input.body;
  if (input.scheduledAt !== undefined) next.scheduledAt = input.scheduledAt;

  // D2: did this edit change what would actually ship?
  let consentCleared = false;
  if (existing?.approval) {
    const materialChanged = MATERIAL_FIELDS.some((f) => {
      const before = JSON.stringify(existing[f] ?? null);
      const after = JSON.stringify(next[f] ?? null);
      return before !== after;
    });
    if (materialChanged) {
      delete next.approval;
      // Back to the last honest state: the creative is still bound, so
      // asset_ready — the card re-arms from there.
      next.status = "asset_ready";
      delete next.scheduledAt;
      if (input.scheduledAt !== undefined) next.scheduledAt = input.scheduledAt;
      consentCleared = true;
    }
  }

  return { post: next, created: existing === null, consentCleared };
}

/** Read → merge → write. The repo is the caller's binding; index sync happens
 * at the runtime seam immediately after (spec 26 failure mode 2). */
export async function upsertPost(
  repo: SocialRepo,
  input: SocialPostUpsertInput,
): Promise<SocialPostUpsertResult> {
  const path = postPath(input.id);
  const raw = await repo.readFile(path);
  const existing = raw === null ? null : parsePost(raw);
  const { post, created, consentCleared } = nextPost(existing, input);
  await repo.writeFile(path, serializePost(post));
  return { post, created, consentCleared, missing: schedulingGaps(post) };
}
