/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0/SM2 + spec 26 — its test suite lives there). Keep this file faithful
 * below this header; fix bugs upstream first, then re-vendor.
 */
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
import {
  calendarPath,
  parseCalendar,
  parsePost,
  postPath,
  serializeCalendar,
  serializePost,
} from "./artifacts";

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

// ---------------------------------------------------------------------------
// social/calendar/{month}.md — persisting a proposed plan
// ---------------------------------------------------------------------------

/**
 * Write a month's calendar.
 *
 * `proposePlan` builds a plan and even serializes it (`calendarMarkdown`), but
 * nothing ever wrote it: `calendarPath()` appeared only in read paths, so the
 * pack could propose a calendar and read a calendar and never persist one. The
 * agent would report "the calendar is planned" perfectly truthfully and the
 * console would still say "Nothing planned yet" — the proposal lived only in
 * the conversation. This is the missing half.
 *
 * APPROVAL IS NOT SILENTLY DISCARDED. Re-planning over an `approved` calendar
 * throws unless the caller says `replaceApproved`. A month someone signed off
 * on is a decision, and overwriting it because a new planning turn happened to
 * run is the kind of quiet loss nobody notices until the wrong post ships.
 * Re-proposing over a `proposed` calendar is fine — that is just iterating.
 */
export interface SocialCalendarUpsertInput {
  month: string;
  /** The serialized calendar — `PlanProposal.calendarMarkdown` verbatim. */
  calendarMarkdown: string;
  /** Overwrite a calendar that has already been approved. Default false. */
  replaceApproved?: boolean;
}

export interface SocialCalendarUpsertResult {
  path: string;
  month: string;
  slotCount: number;
  status: string;
  created: boolean;
}

export async function upsertCalendar(
  repo: SocialRepo,
  input: SocialCalendarUpsertInput,
): Promise<SocialCalendarUpsertResult> {
  const path = calendarPath(input.month); // throws on a malformed month
  const raw = (input.calendarMarkdown ?? "").trim();
  if (!raw) {
    throw new Error(
      `social_calendar_upsert: calendarMarkdown is empty — pass PlanProposal.calendarMarkdown from social_plan_propose`,
    );
  }

  // Parse before writing: a calendar that cannot be read back is worse than no
  // calendar, because the console renders an empty state either way and only
  // one of them looks like a bug.
  const parsed = parseCalendar(raw);
  if (parsed.month !== input.month) {
    throw new Error(
      `social_calendar_upsert: month mismatch — argument says "${input.month}", the markdown says "${parsed.month}"`,
    );
  }

  const existingRaw = await repo.readFile(path);
  if (existingRaw !== null && !input.replaceApproved) {
    const existing = parseCalendar(existingRaw);
    if (existing.status === "approved") {
      throw new Error(
        `social_calendar_upsert: ${input.month} is already approved (${existing.slots.length} slots). ` +
          `Pass replaceApproved: true to discard that approval deliberately.`,
      );
    }
  }

  await repo.writeFile(path, raw);
  return {
    path,
    month: parsed.month,
    slotCount: parsed.slots.length,
    status: parsed.status,
    created: existingRaw === null,
  };
}

// ---------------------------------------------------------------------------
// Binding a post back to its calendar slot
// ---------------------------------------------------------------------------

export interface LinkPostResult {
  linked: boolean;
  month: string | null;
  slot: string | null;
  /** Why nothing was linked, when linked is false. Never thrown — see below. */
  note?: string;
}

/**
 * Attach a post to the calendar slot it fulfils.
 *
 * `CalendarSlot.postId` starts null and nothing ever set it. The month sheet
 * walks the calendar and resolves each slot to its post, so with the link
 * missing it renders "the month's calendar has no posts attached to its slots"
 * — while the posts sit right there, written and correct. The artifacts were
 * complete and unrelated to each other.
 *
 * Matching is by DATE + CHANNEL, taking the first slot still unfilled. Post ids
 * conventionally start `YYYY-MM-DD`, and `scheduledAt` is preferred when set
 * because a rescheduled post belongs to the day it will actually run.
 *
 * NEVER THROWS. A post that cannot find a slot is a normal state — ad-hoc posts
 * exist, and a month may not be planned yet. Failing the authoring write
 * because the calendar is missing would make the calendar a prerequisite for
 * writing a post, which inverts the dependency.
 */
export async function linkPostToCalendarSlot(
  repo: SocialRepo,
  post: { id: string; channel?: string; scheduledAt?: string | null; status?: string },
): Promise<LinkPostResult> {
  const date = (post.scheduledAt ?? "").slice(0, 10) || post.id.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { linked: false, month: null, slot: null, note: `no date in "${post.id}" and no scheduledAt` };
  }
  const month = date.slice(0, 7);

  let raw: string | null;
  try {
    raw = await repo.readFile(calendarPath(month));
  } catch {
    return { linked: false, month, slot: date, note: `could not read the ${month} calendar` };
  }
  if (raw === null) {
    return { linked: false, month, slot: date, note: `no calendar for ${month} — nothing to attach to` };
  }

  const calendar = parseCalendar(raw);
  const already = calendar.slots.find((s) => s.postId === post.id);
  if (already) return { linked: true, month, slot: already.slot };

  const target = calendar.slots.find(
    (s) => s.slot === date && (!post.channel || s.channel === post.channel) && !s.postId,
  );
  if (!target) {
    return {
      linked: false, month, slot: date,
      note: `no free ${post.channel ?? "any"} slot on ${date} in the ${month} calendar`,
    };
  }

  target.postId = post.id;
  if (post.status) target.status = post.status;
  await repo.writeFile(calendarPath(month), serializeCalendar(calendar));
  return { linked: true, month, slot: target.slot };
}
