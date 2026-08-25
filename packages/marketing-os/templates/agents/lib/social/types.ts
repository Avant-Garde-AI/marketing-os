/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0/SM2 — its test suite lives there). Keep this file faithful below this
 * header; fix bugs upstream first, then re-vendor.
 */
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

import type { ProvenanceClaim, StoreRepo } from "../skill-kit";

// ---------------------------------------------------------------------------
// Provenance (spec 24 §1 — post claims carry origin like every brand claim)
// Canonical types live in @avant-garde/skill-kit (05 H6); re-exported here so
// existing consumers keep importing from the pack.
// ---------------------------------------------------------------------------

export type { ProvenanceOrigin, ProvenanceClaim } from "../skill-kit";

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
 * Minimal accessor over the tenant's store repo — now the shared `StoreRepo`
 * seam from @avant-garde/skill-kit (05 H6: one binding implementation in the
 * hosted runtime serves every pack). `SocialRepo` remains as the pack-local
 * alias so existing consumers compile unchanged.
 *
 * `writeFile` exists on the interface for SM1+ (asset pipeline) and so a
 * single binding serves the whole pack's lifecycle — the SM0 read tools never
 * call it.
 */
export type SocialRepo = StoreRepo;

// ---------------------------------------------------------------------------
// Tool definition shape — canonical in @avant-garde/skill-kit, re-exported.
// ---------------------------------------------------------------------------

export type { SkillToolDefinition } from "../skill-kit";

// ---------------------------------------------------------------------------
// Domain reference — the "social genome" (spec 24 §6)
//
// The OUTWARD reference, sitting beside brand.md's inward one: brand.md says
// who the store IS; the genome says what the store's DOMAIN currently looks
// like — the layout grammar, editorial register and copy structures a market
// actually uses. Compose grounds on both, and the hierarchy is not negotiable:
// **brand.md dominates (identity); the genome informs (fluency).** A genome
// that drives composition instead of informing it regresses a distinctive
// brand toward its market's aesthetic mean.
//
// SPLIT OF CONCERNS. This layer defines the SPEC only — the shape a genome
// must take for the platform to pick it up. How a store ACQUIRES the corpus
// (which competitors, which scraper, which credentials) is deliberately out of
// scope and lives in the store's own repo: domain-specific, often paid, often
// bound by a third party's terms. Nothing here scrapes, fetches, or names a
// vendor. Same discipline as design-surfaces: `domain` is an opaque
// store-owned string this layer never interprets.
//
// SAFETY PROPERTY — abstractions, never assets. No type here carries image
// bytes or a fetchable asset for reference content, and that is structural
// rather than advisory: reference material informs STRUCTURE and TONE, it
// never supplies PIXELS. `sources` are attribution handles for auditability,
// not fetch targets. Exemplars are typically third-party copyrighted work
// (for an art brand, emphatically so) — the contract makes republishing them
// impossible rather than merely discouraged.
// ---------------------------------------------------------------------------

/** Element kind a slot expects, mapped to the compose layer's element types. */
export type ArchetypeSlotKind = "image" | "text" | "band";

/**
 * One region of a layout archetype, in NORMALIZED coordinates: x/y/w/h are
 * fractions of the board (0..1), never pixels. That is what lets a single
 * archetype resolve to a 1080×1080 feed post, a 1080×1350 portrait and a
 * 1080×1920 story without redefinition — the abstraction scales across
 * formats instead of being restated per size.
 *
 * The spec requires in-bounds geometry (x + w <= 1, y + h <= 1), so a
 * validated archetype is structurally incapable of overflowing its board —
 * the fit-check's error tier can never fire on resolved archetype geometry.
 */
export interface ArchetypeSlot {
  /** Semantic role the compose layer fills, e.g. "work", "eyebrow", "headline", "cta". */
  role: string;
  kind: ArchetypeSlotKind;
  /** Left edge as a fraction of board width (0..1). */
  x: number;
  /** Top edge as a fraction of board height (0..1). */
  y: number;
  /** Width as a fraction of board width (0..1]. */
  w: number;
  /** Height as a fraction of board height (0..1]. */
  h: number;
}

/**
 * How well-evidenced an archetype is. Carried explicitly so weak archetypes
 * are filterable and a human can see WHY one is recommended — three
 * cherry-picked posts must not be able to present themselves as "what works".
 */
export interface ArchetypeEvidence {
  /** How many corpus exemplars this archetype was distilled from. */
  n: number;
  /**
   * Normalized performance signal (higher = stronger), comparable only WITHIN
   * one genome. Organic engagement is follower-confounded, so a raw like-count
   * belongs nowhere near this field — normalize before distilling, or omit it.
   */
  signal?: number;
}

/** A reusable structural layout distilled from the domain corpus. */
export interface LayoutArchetype {
  /** Stable slug, unique within the genome, e.g. "full-bleed-work". */
  id: string;
  name: string;
  /** What this layout is and when it's the right choice. */
  description: string;
  slots: ArchetypeSlot[];
  evidence: ArchetypeEvidence;
}

/** Editorial treatment guidance — the tonal half of the genome. */
export interface EditorialRegister {
  /** Prose: mood, treatment, styling conventions the domain reads as native. */
  treatment: string;
  /** Prose: type posture — scale, case, restraint, overlay conventions. */
  typographicPosture?: string;
  /** Domain anti-patterns: what reads as off-key or amateur in this market. */
  doNot?: string[];
}

/** A caption/copy structure observed in the domain. */
export interface CopyFormula {
  id: string;
  /** The structure itself, e.g. "artist + work title + medium, then one-line provenance". */
  structure: string;
  /** Optional illustrative shape — write a NEUTRAL paraphrase, never paste a competitor's caption. */
  example?: string;
}

/**
 * The distilled domain reference: `social/reference/genome.md` in the store
 * repo. Human-readable and human-editable on purpose — an owner can read what
 * the agent concluded the market grammar is, and correct it, BEFORE it
 * informs a single post. It is a reviewable artifact, not an opaque index.
 */
export interface SocialGenome {
  /** Opaque, store-owned domain key, e.g. "framed-art-retail". Never interpreted here. */
  domain: string;
  /** Narrows the genome to one channel when its grammar genuinely differs. */
  channel?: string;
  archetypes: LayoutArchetype[];
  register?: EditorialRegister;
  copyFormulas?: CopyFormula[];
  /** ISO datetime the distillation ran — trends decay, so staleness must be visible. */
  distilledAt: string;
  /** Attribution handles/refs for auditability. NOT fetch targets (see safety property). */
  sources?: string[];
  provenance: ProvenanceClaim[];
  /** Markdown body: the distillation's rationale prose. */
  body: string;
}
