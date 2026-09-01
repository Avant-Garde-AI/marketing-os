/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0/SM2 + spec 26 — its test suite lives there). Keep this file faithful
 * below this header; fix bugs upstream first, then re-vendor.
 */
/**
 * Artifact → index projection, the PURE half (spec 22 D1: files are truth, the
 * DB is a rebuildable index; spec 26 §2 ⟨BUILD⟩ 1).
 *
 * The pack owns the SEMANTICS of its projection — which month a post belongs
 * to, what the calendar should show, what its thumbnail is — and the runtime
 * owns the plumbing (pool, tenant resolution, SQL). Everything here is pure
 * and deterministic so it can be tested without a database, exactly like
 * `verifyScheduleConsent` keeps the consent rules in the pack while the cron
 * only acts on the verdict.
 *
 * WHY THIS EXISTS AT ALL (spec 26 §5, failure mode 2): the email pack shipped
 * an authoring tool that wrote the artifact and never synced the index.
 * Campaigns rendered perfectly at their preview URL and appeared NOWHERE in
 * the console or the calendar, and nothing errored — the projection is the
 * only thing those surfaces read. Write through at the authoring write; the
 * cron sweep is the backstop, not the mechanism.
 */

import type { SocialPost } from "./types";
import { postPath } from "./artifacts";

/** What the shared cross-channel calendar needs (public.mos_calendar_items).
 * Structurally identical to the runtime's CalendarItem — declared here rather
 * than imported so this module stays dependency-free and safe to pull into a
 * client component (spec 26 §5, failure mode 6). */
export interface SocialCalendarProjection {
  channel: "social";
  packId: "social-media";
  itemId: string;
  month: string;
  scheduledAt?: string;
  status: string;
  title: string;
  intent: string;
  thumbnailUrl?: string;
}

/** Posts with no schedule and no date-prefixed id land here rather than
 * inventing a month — the calendar renders them in a backlog lane. */
export const UNSCHEDULED_MONTH = "unscheduled";

const ID_MONTH_RE = /^(\d{4}-(?:0[1-9]|1[0-2]))/;

/**
 * The month a post belongs to: its schedule when set, else its id prefix
 * (plan-created ids are `{YYYY-MM}-…`), else "unscheduled". Same rule as the
 * email pack's `campaignMonth`, so both channels land in the same buckets on
 * the shared calendar.
 */
export function postMonth(post: SocialPost): string {
  if (post.scheduledAt) return post.scheduledAt.slice(0, 7);
  return post.id.match(ID_MONTH_RE)?.[1] ?? UNSCHEDULED_MONTH;
}

/**
 * The post's creative as a durable image URL for the calendar and review
 * surfaces (spec 26 D4).
 *
 * D4 as written called for re-hosting because "composed imagery URLs are
 * signed and expire in 24h". That is true of the exporter's own asset URIs;
 * it is NOT true of this one. The design-surface export route re-renders on
 * GET from the file id — no signature, no expiry, the unguessable UUID is the
 * access control (the same surfacing pattern as /api/brand-image/{id}). So the
 * URL is already durable and re-hosting would buy nothing.
 *
 * What it is NOT is IMMUTABLE: it renders CURRENT canvas state, so a thumbnail
 * silently changes if someone edits the board after review. That is the same
 * blind spot the publish consent check exists for — consent pins the
 * revision, a bare thumbnail URL does not. So when the artifact knows the
 * approved revision we append it: the route ignores the extra parameter, but
 * the STORED URL then changes whenever the canvas does, which turns invisible
 * drift into a visible diff on the calendar row.
 *
 * Returns undefined when no surface is bound — the calendar renders a text
 * card, exactly as it does for an all-copy email.
 */
export function postThumbnailUrl(post: SocialPost, publicUrl: string): string | undefined {
  if (!post.designSurface) return undefined;
  const base = publicUrl.replace(/\/$/, "");
  if (!base) return undefined;
  const qs = new URLSearchParams({ format: "jpeg" });
  if (post.designSurface.pageId) qs.set("pageId", post.designSurface.pageId);
  if (post.approval?.surfaceRevn != null) qs.set("revn", String(post.approval.surfaceRevn));
  return `${base}/api/design-surfaces/export/${post.designSurface.fileId}?${qs.toString()}`;
}

/**
 * The key a post is grouped under for review (spec 26 D3). An explicit
 * `groupId` when the post is one variant of a multi-platform idea; otherwise
 * the post's own id — a lone post is a group of one, so every consumer can
 * group unconditionally without special-casing.
 */
export function groupKey(post: SocialPost): string {
  return post.groupId ?? post.id;
}

/**
 * Partition posts into review groups, deterministically.
 *
 * Groups are ordered by their earliest scheduled variant (unscheduled last,
 * then by key) and variants within a group by channel then id — so the review
 * room lays the same idea's platforms out in a stable order every time, and a
 * reviewer comparing two visits sees the same arrangement.
 */
export function groupPosts(posts: SocialPost[]): { key: string; posts: SocialPost[] }[] {
  const byKey = new Map<string, SocialPost[]>();
  for (const p of posts) {
    const k = groupKey(p);
    const bucket = byKey.get(k);
    if (bucket) bucket.push(p);
    else byKey.set(k, [p]);
  }
  const groups = [...byKey.entries()].map(([key, ps]) => ({
    key,
    posts: ps
      .slice()
      .sort((a, b) => a.channel.localeCompare(b.channel) || a.id.localeCompare(b.id)),
  }));
  const earliest = (g: { posts: SocialPost[] }): string =>
    g.posts.map((p) => p.scheduledAt ?? "￿").sort()[0] ?? "￿";
  return groups.sort((a, b) => earliest(a).localeCompare(earliest(b)) || a.key.localeCompare(b.key));
}

/** Console-relative detail route for a post — `lib/calendar/routes.ts` already
 * maps `social → /social/posts/{id}` (spec 26 §2). Exposed so the projection
 * and any surface agree on one construction. */
export function postDetailPath(post: SocialPost): string {
  return `/social/posts/${post.id}`;
}

/**
 * Project a post onto the shared calendar contract. `status` is the pack's
 * own lifecycle string and stays opaque to the calendar, which renders chips
 * and never interprets (spec 26 §2).
 *
 * `title` prefers the first line of the caption — a caption's opening line is
 * what a human scanning a month actually recognises — and falls back to the
 * id so a row is never blank.
 */
export function postCalendarProjection(
  post: SocialPost,
  publicUrl: string,
): SocialCalendarProjection {
  const firstLine = post.copy.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  const title = firstLine
    ? firstLine.length > 80
      ? `${firstLine.slice(0, 77)}…`
      : firstLine
    : post.id;
  const thumbnailUrl = postThumbnailUrl(post, publicUrl);
  return {
    channel: "social",
    packId: "social-media",
    itemId: post.id,
    month: postMonth(post),
    ...(post.scheduledAt ? { scheduledAt: post.scheduledAt } : {}),
    status: post.status,
    // The channel the post publishes to IS its intent line on a cross-channel
    // calendar — "instagram" next to an email's archetype is the distinction
    // the shared view exists to show.
    intent: post.channel,
    title,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
}

/** Row shape for `pack_social.posts` — the pack-private index (spec 26 D2).
 * Kept separate from the calendar projection on purpose: shared view and pack
 * state must not be overloaded into one table. */
export interface SocialPostIndexRow {
  id: string;
  channel: string;
  /** Review-group key (spec 26 D3); a lone post groups under its own id. */
  groupKey: string;
  calendarMonth: string;
  status: string;
  scheduledAt: string | null;
  targetLink: string | null;
  copy: string | null;
  surfaceFileId: string | null;
  surfacePageId: string | null;
  surfaceRevn: number | null;
  approvalHash: string | null;
  approvalAt: string | null;
  platformId: string | null;
  platformPermalink: string | null;
  publishedAt: string | null;
  failure: string | null;
  repoPath: string;
}

/** Flatten a post artifact into its pack-private index row. Every field is
 * derived from the file, so the table is always rebuildable by re-reading
 * artifacts (spec 22 D1). */
export function postIndexRow(post: SocialPost): SocialPostIndexRow {
  return {
    id: post.id,
    channel: post.channel,
    groupKey: groupKey(post),
    calendarMonth: postMonth(post),
    status: post.status,
    scheduledAt: post.scheduledAt ?? null,
    targetLink: post.targetLink || null,
    copy: post.copy || null,
    surfaceFileId: post.designSurface?.fileId ?? null,
    surfacePageId: post.designSurface?.pageId ?? null,
    surfaceRevn: post.approval?.surfaceRevn ?? null,
    approvalHash: post.approval?.hash ?? null,
    approvalAt: post.approval?.at ?? null,
    platformId: post.platform?.id ?? null,
    platformPermalink: post.platform?.permalink || null,
    publishedAt: post.platform?.publishedAt ?? null,
    failure: post.failure ?? null,
    repoPath: postPath(post.id),
  };
}
