/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0 — its test suite lives there). Keep this file faithful below this
 * header; fix bugs upstream first, then re-vendor.
 *
 * Social Media Agent (spec 24) — SM0 type definitions.
 *
 * Spec 22 D1 pattern: files are truth, DB is the index. These types model the
 * three repo artifacts under `social/` (alongside `agents/brand/`):
 *
 *   social/strategy.md            — the standing social strategy
 *   social/calendar/{YYYY-MM}.md  — the month's plan (one row per planned post)
 *   social/posts/{id}/post.md     — the post spec
 *
 * All three are YAML-front-matter markdown, the same physical format as
 * brand.md (see @avant-garde/brand-md) — parsed with the `yaml` package and a
 * front-matter split, prose body preserved verbatim for round-trips.
 */

import type { z } from "zod";

// ---------------------------------------------------------------------------
// Provenance (spec 24 §1 — post claims carry origin like every brand claim)
// ---------------------------------------------------------------------------

export type ProvenanceOrigin = "owner" | "agent" | "data";

export interface ProvenanceClaim {
  claim: string;
  origin: ProvenanceOrigin;
}

// ---------------------------------------------------------------------------
// social/strategy.md
// ---------------------------------------------------------------------------

export interface StrategyChannel {
  /** Channel key, e.g. "instagram", "pinterest". */
  channel: string;
  /** Editorial register for the channel (brand.md §9 per-surface voice, extended). */
  register: string;
  /** Cadence target: planned posts per week on this channel. */
  cadencePerWeek: number;
}

export interface StrategyPillar {
  /** Pillar name, e.g. "artist-stories". */
  name: string;
  /** Pointer into brand.md's messaging framework (section / claim ref). */
  messagingRef: string;
  /** Relative weight for pillar rotation (share of slots). */
  weight: number;
}

export interface SeasonalArc {
  name: string;
  /** Months the arc covers, as YYYY-MM strings. */
  months?: string[];
  description?: string;
}

export interface SocialStrategy {
  channels: StrategyChannel[];
  pillars: StrategyPillar[];
  seasonalArcs?: SeasonalArc[];
  /** Markdown body: the prose rationale for the strategy. */
  body: string;
}

// ---------------------------------------------------------------------------
// social/calendar/{YYYY-MM}.md
// ---------------------------------------------------------------------------

export interface CalendarSlot {
  /** ISO date (YYYY-MM-DD) the post is planned for. */
  slot: string;
  channel: string;
  /** Pillar name (matches strategy.md pillars). */
  pillar: string;
  /** The slot's commercial/editorial intent — every slot carries its why. */
  intent: string;
  /** Post id once a post.md exists for the slot; null while unassigned. */
  postId: string | null;
  /** Slot status (mirrors the post lifecycle; "planned" while unassigned). */
  status: string;
}

export interface SocialCalendar {
  /** YYYY-MM. */
  month: string;
  /** Calendar-level status: proposed | approved | archived. */
  status: string;
  slots: CalendarSlot[];
  /** Prose in the body outside the table (rationale, notes). Optional. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// social/posts/{id}/post.md
// ---------------------------------------------------------------------------

/** Post lifecycle (spec 24 §1). */
export const POST_STATUSES = [
  "proposed",
  "approved",
  "asset_ready",
  "scheduled",
  "published",
  "declined",
  "cancelled",
  "failed",
  "measured",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * Design Studio surface bound to a post (SM1 design-link glue, spec 24 §3 /
 * spec 23 §2 `boundTo`). Recorded in post.md front matter when the asset
 * pipeline composes the post's creative, so the calendar entry links to the
 * draft ("Open in Studio").
 */
export interface DesignSurfaceRef {
  /** Design Studio (Penpot) team id. */
  teamId: string;
  /** Design file id. */
  fileId: string;
  /** Page within the file (the file's first page when absent). */
  pageId?: string;
}

/**
 * Approval record written by social.schedule_post's execute (spec 24 D2 —
 * approve-at-schedule). `hash` is the deterministic publish-material hash at
 * approval time; the cron recomputes it from current file state before
 * publishing, and any drift (copy edit, time move, creative rebinding)
 * invalidates the approval — the post drops back and the card re-arms.
 */
export interface PostApproval {
  hash: string;
  /** ISO datetime the approval executed. */
  at: string;
  /**
   * Penpot revision of the bound Design Surface at approval time. Canvas
   * edits bump the file's revn WITHOUT changing the designSurface ref, so the
   * publish-material hash alone can't see them — the cron re-reads the revn
   * and treats a bump as consent drift (spec 23 `edited` fallback; the
   * webhook lane is SM3). Absent when the revision seam wasn't bound or the
   * canvas was unreachable at approval time.
   */
  surfaceRevn?: number;
}

/** Platform write-back after a successful publish (spec 24 §1 index fields). */
export interface PostPlatformResult {
  /** The platform's media/post id. */
  id: string;
  /** Public permalink ("" when the platform didn't return one). */
  permalink: string;
  /** ISO datetime the publish completed. */
  publishedAt: string;
}

export interface SocialPost {
  id: string;
  channel: string;
  /** ISO datetime the post is scheduled for (absent until scheduled). */
  scheduledAt?: string;
  /** The caption text. */
  copy: string;
  /** The brand copy formula this copy instantiated (brand.md ref). Optional. */
  copyFormulaRef?: string;
  /** Repo-relative asset paths (spec 23 exports land in social/posts/{id}/assets/). */
  assetRefs: string[];
  /** The composed Design Surface for this post's creative (absent until SM1 links one). */
  designSurface?: DesignSurfaceRef;
  /** Target link: product / collection / editorial URL. */
  targetLink: string;
  provenance: ProvenanceClaim[];
  status: PostStatus;
  /** Approve-at-schedule consent record (absent until social.schedule_post executes). */
  approval?: PostApproval;
  /** Platform id + permalink once published. */
  platform?: PostPlatformResult;
  /** Last publish failure message (set when status is "failed"). */
  failure?: string;
  /** Markdown body: the agent's rationale prose. */
  body: string;
}

// ---------------------------------------------------------------------------
// Channel adapter seam (spec 24 §4 D3 — direct platform APIs)
// ---------------------------------------------------------------------------

/**
 * A publishing connector for one channel — `publish(post, assetUrl) →
 * {platformId, permalink}` (spec 24 §4). The pack declares the Actions against
 * this interface; the RUNTIME implements it (lib/social/channels/*) and owns
 * credential resolution: v1 is a single-tenant env-token bootstrap, the
 * per-tenant token source (Vault / provider_connections, spec 12 pattern)
 * drops into the same seam later.
 */
export interface SocialChannelAdapter {
  channel: string;
  /**
   * Publish the post with `assetUrl` as its creative — a PUBLIC image URL the
   * platform fetches (the design-surface export route). Must throw with a
   * clear message on any platform rejection; the caller records failures.
   */
  publish(post: SocialPost, assetUrl: string): Promise<{ platformId: string; permalink: string }>;
}

// ---------------------------------------------------------------------------
// Repo accessor — bound at tool-construction time
// ---------------------------------------------------------------------------

/**
 * Minimal accessor over the tenant's store repo. The hosted runtime binds it
 * to the store's git repo (GitHub contents API, local checkout, …); tests bind
 * it to an in-memory map. Paths are repo-relative (e.g. "social/strategy.md").
 *
 * `writeFile` exists on the interface for SM1+ (asset pipeline) and so a
 * single binding serves the whole pack's lifecycle — the SM0 read tools never
 * call it.
 */
export interface SocialRepo {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Tool definition shape
// ---------------------------------------------------------------------------

/**
 * Plain tool definition — deliberately NOT a Mastra `createTool` instance.
 * This package stays free of @mastra/core so the hosted runtime (which owns
 * the Mastra version) wraps these at merge time:
 *
 *   createTool({ id, description, inputSchema, outputSchema,
 *                execute: ({ context }) => def.execute(context) })
 */
export interface SkillToolDefinition<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  id: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  execute: (input: z.infer<I>) => Promise<z.infer<O>>;
}
