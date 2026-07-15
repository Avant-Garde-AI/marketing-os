/**
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
  /** Target link: product / collection / editorial URL. */
  targetLink: string;
  provenance: ProvenanceClaim[];
  status: PostStatus;
  /** Markdown body: the agent's rationale prose. */
  body: string;
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
