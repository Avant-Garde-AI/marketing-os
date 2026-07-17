// VENDORED from packages/skills/email-campaign — do not edit here; swap for the
// published package on next touch (H8.3).

/**
 * Email Campaign Agent — type definitions (docs/email-campaign-agent/02 §3).
 *
 * Spec 22 D1 pattern: files are truth, DB is the index. These types model the
 * repo artifacts under `email/` (alongside `social/` and `agents/brand/`):
 *
 *   email/strategy.md                          — the standing email strategy
 *   email/templates/skeletons/{id}/skeleton.md — ingested skeleton provenance
 *   email/templates/skeletons/{id}/skeleton.html
 *   email/calendar/{YYYY-MM}.md                — the month's plan
 *   email/campaigns/{id}/campaign.md           — the campaign spec
 *   email/campaigns/{id}/assets/               — design-surface exports
 *   email/campaigns/{id}/email.html            — the assembled artifact
 *
 * All markdown artifacts are YAML-front-matter documents (the brand.md
 * physical format), parsed/serialized via @avant-garde/skill-kit's helpers.
 *
 * This file also defines the `KlaviyoClient` interface (WS1-R3): the pack
 * OWNS the interface; the hosted runtime supplies the broker-backed
 * implementation and tests supply fakes. The pack never sees a credential.
 */

import type { ProvenanceClaim, StoreRepo } from "../skill-kit";

// ---------------------------------------------------------------------------
// Repo seam — the shared StoreRepo, aliased for symmetry with SocialRepo
// ---------------------------------------------------------------------------

export type EmailRepo = StoreRepo;

// ---------------------------------------------------------------------------
// email/strategy.md
// ---------------------------------------------------------------------------

/** A Klaviyo audience reference — the strategy names them once; campaigns
 * point at roster keys so a re-connect doesn't rewrite every campaign. */
export interface StrategyAudience {
  /** Stable roster key, e.g. "engaged-30d", "full-list". */
  key: string;
  klaviyoRef: { type: "list" | "segment"; id: string };
  description: string;
  /** Max campaigns per month that may target this audience (guardrail). */
  cadenceCap: number;
}

/** Campaign archetypes are the email pack's pillars (02 §3): new-arrivals,
 * editorial-story, promotion, replenishment, … mapped to brand.md messaging. */
export interface StrategyArchetype {
  name: string;
  /** Pointer into brand.md's messaging framework (section / claim ref). */
  messagingRef: string;
  /** Relative weight for archetype rotation (share of slots). */
  weight: number;
}

export interface SeasonalArc {
  name: string;
  /** Months the arc covers, as YYYY-MM strings. */
  months?: string[];
  description?: string;
}

export interface QuietPeriod {
  /** ISO dates, inclusive. */
  start: string;
  end: string;
  reason?: string;
}

export interface EmailStrategy {
  audiences: StrategyAudience[];
  archetypes: StrategyArchetype[];
  /** Planned campaigns per month (the scaffold's slot count). */
  campaignsPerMonth: number;
  /** Preferred send days (lowercase weekday names) + local send time. */
  sendDays: string[];
  sendTime: string;
  seasonalArcs?: SeasonalArc[];
  guardrails?: {
    maxCampaignsPerWeek?: number;
    quietPeriods?: QuietPeriod[];
  };
  /** Markdown body: the prose rationale for the strategy. */
  body: string;
}

// ---------------------------------------------------------------------------
// email/registry.json — slug → Klaviyo template id (06 §4)
// ---------------------------------------------------------------------------

/**
 * The committed slug → Klaviyo template id map (Arthaus klaviyo-registry.json
 * precedent): first push creates, subsequent pushes PATCH the same id — the
 * draft Action's idempotency substrate. Campaign templates use slug
 * `campaign-{id}`; lifecycle templates keep human slugs.
 */
export type EmailTemplateRegistry = Record<string, string>;

// ---------------------------------------------------------------------------
// email/templates/skeletons/{id}/skeleton.md (+ sibling skeleton.html)
// ---------------------------------------------------------------------------

/** A named slot the skeleton exposes, with the constraints the board composer
 * and copy renderer must match (04 §3). */
export interface SkeletonSlot {
  name: string;
  maxWidth?: number;
  backgroundContext?: string;
  paddingContext?: string;
}

export interface EmailSkeleton {
  id: string;
  /** Which Klaviyo template it came from. */
  sourceTemplateId: string;
  sourceTemplateName?: string;
  /** ISO datetime of ingestion. */
  ingestedAt: string;
  /** Human-readable record of every transform the sanitizer applied. */
  transforms: string[];
  slots: SkeletonSlot[];
  /** Monotonic version — re-ingestion bumps it (and invalidates nonces). */
  version: number;
  /** Owner approval record; absent while proposed. */
  approvedBy?: string;
  /** Markdown body: provenance/rationale prose. */
  body: string;
}

// ---------------------------------------------------------------------------
// email/calendar/{YYYY-MM}.md
// ---------------------------------------------------------------------------

export interface EmailCalendarSlot {
  /** ISO date (YYYY-MM-DD) the campaign is planned to send. */
  slot: string;
  /** Strategy audience roster key; "—" (null) while unassigned. */
  audience: string | null;
  /** Archetype name (matches strategy.md archetypes). */
  archetype: string;
  /** The slot's commercial/editorial intent — every slot carries its why. */
  intent: string;
  /** Campaign id once a campaign.md exists for the slot. */
  campaignId: string | null;
  /** Slot status (mirrors the campaign lifecycle; "planned" while unassigned). */
  status: string;
}

export interface EmailCalendar {
  /** YYYY-MM. */
  month: string;
  /** Calendar-level status: proposed | approved | archived. */
  status: string;
  slots: EmailCalendarSlot[];
  /** Prose in the body outside the table (rationale, notes). Optional. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// email/campaigns/{id}/campaign.md
// ---------------------------------------------------------------------------

/** Campaign lifecycle (02 §3). `drafted` replaces social's `asset_ready`:
 * the gate-worthy milestone for email is "exists in Klaviyo as a draft". */
export const CAMPAIGN_STATUSES = [
  "proposed",
  "approved",
  "drafted",
  "scheduled",
  "sent",
  "measured",
  "declined",
  "cancelled",
  "failed",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** A resolved audience on a campaign: the roster key plus the Klaviyo ref and
 * the human-readable snapshot taken at draft time. */
export interface CampaignAudienceRef {
  key?: string;
  type: "list" | "segment";
  id: string;
  name?: string;
  estimatedSize?: number;
}

export interface CampaignAudience {
  included: CampaignAudienceRef[];
  excluded?: CampaignAudienceRef[];
}

/**
 * A campaign section (02 §3 / 04 §0's dividing rule): `surface` sections are
 * visual brand expression composed as design-surface boards and slotted as
 * images; `html` sections are everything textual, rendered by the assembly
 * package's fixed vocabulary. `blocks` is validated loosely here — the
 * authoritative block schema lives in @avant-garde/email-assembly, which the
 * hosted runtime feeds these sections into (a conformance test guards drift
 * at that seam).
 */
export type CampaignSection =
  | {
      slot: string;
      type: "surface";
      /** Alt text describing the MESSAGE, not the pixels (04 §5). Mandatory. */
      alt: string;
      /** The design surface the board lives on (multi-board, kind email.campaign). */
      surfaceId?: string;
      /** Board name on the surface (= slot name by convention). */
      boardName?: string;
      /** Repo-relative export path once exported (campaigns/{id}/assets/…). */
      assetPath?: string;
      /** Klaviyo-hosted image URL once uploaded (draft Action records it). */
      imageUrl?: string;
      /** Compose-template payload used to author the board (WS2-R2 schema). */
      payload?: Record<string, unknown>;
    }
  | {
      slot: string;
      type: "html";
      /** email-assembly renderer-vocabulary blocks (paragraph/heading/button/productRow/spacer). */
      blocks: Array<Record<string, unknown>>;
    };

export interface CampaignUtm {
  campaign: string;
  source: string;
  medium: string;
}

/** Ids recorded as the draft Action's 3-step execute lands each Klaviyo
 * object — re-execution resumes from what exists (03 §4 idempotency). */
export interface CampaignKlaviyoIds {
  templateId?: string;
  campaignId?: string;
  messageId?: string;
  sendJobStatus?: string;
}

export interface EmailCampaign {
  id: string;
  archetype: string;
  audience: CampaignAudience;
  subjectCandidates: string[];
  subject?: string;
  previewText?: string;
  /** The brand.md copy formula the copy instantiated. */
  copyFormulaRef?: string;
  /** Skeleton id (email/templates/skeletons/{skeletonRef}/). */
  skeletonRef: string;
  sections: CampaignSection[];
  /** ISO datetime once scheduled (approval = consent to send at this T). */
  scheduledAt?: string;
  utm: CampaignUtm;
  klaviyo?: CampaignKlaviyoIds;
  provenance: ProvenanceClaim[];
  status: CampaignStatus;
  /** Markdown body: the agent's rationale prose. */
  body: string;
}

// ---------------------------------------------------------------------------
// KlaviyoClient — the pack-owned interface (WS1-R3)
// ---------------------------------------------------------------------------

export interface KlaviyoAudience {
  type: "list" | "segment";
  id: string;
  name: string;
  profileCount?: number;
}

export interface KlaviyoTemplateSummary {
  id: string;
  name: string;
  /** CODE | USER_DRAGGABLE | SYSTEM_DRAGGABLE (03 §3). */
  editorType: string;
  updated?: string;
}

export interface KlaviyoTemplate extends KlaviyoTemplateSummary {
  html?: string;
  text?: string;
}

export interface KlaviyoUniversalContentBlock {
  id: string;
  name: string;
  html?: string;
}

export interface CreateCampaignInput {
  name: string;
  audiences: { included: string[]; excluded?: string[] };
  subject: string;
  previewText?: string;
  fromEmail?: string;
  fromLabel?: string;
  /** Klaviyo native UTM decoration (03 §4) — readback rides this. */
  utmParams?: { name: string; value: string }[];
  useSmartSending?: boolean;
}

export interface CampaignValuesQuery {
  campaignIds?: string[];
  /** ISO start/end; ≤ 1 year (API limit — enforced client-side). */
  timeframe: { start: string; end: string };
  conversionMetricId: string;
}

export interface CampaignValuesRow {
  campaignId: string;
  delivered?: number;
  bounced?: number;
  deliveryRate?: number;
  opens?: number;
  opensUnique?: number;
  openRate?: number;
  clicks?: number;
  clicksUnique?: number;
  clickRate?: number;
  clickToOpenRate?: number;
  unsubscribes?: number;
  unsubscribeRate?: number;
  spamComplaints?: number;
  conversions?: number;
  conversionUniques?: number;
  conversionValue?: number;
  revenuePerRecipient?: number;
  averageOrderValue?: number;
}

export interface KlaviyoMetric {
  id: string;
  name: string;
  integration?: string;
}

/**
 * The Klaviyo adapter interface — defined HERE (the pack), implemented in the
 * hosted runtime against broker-issued credentials with revision 2026-07-15
 * pinned and per-tenant rate budgets (03 §9). Tests supply fakes. Every
 * method maps to the GA surfaces inventoried in 03-KLAVIYO-PLATFORM.md.
 */
export interface KlaviyoClient {
  // Reads
  listAudiences(): Promise<KlaviyoAudience[]>;
  listTemplates(): Promise<KlaviyoTemplateSummary[]>;
  getTemplate(id: string): Promise<KlaviyoTemplate>;
  listUniversalContent(): Promise<KlaviyoUniversalContentBlock[]>;
  listMetrics(): Promise<KlaviyoMetric[]>;
  campaignValuesReport(query: CampaignValuesQuery): Promise<CampaignValuesRow[]>;
  estimateRecipients(campaignId: string): Promise<{ estimatedCount: number }>;
  getSendJob(campaignId: string): Promise<{ status: string }>;
  getCampaignStatus(campaignId: string): Promise<{ status: string; scheduledAt?: string }>;
  renderTemplate(id: string, context?: Record<string, unknown>): Promise<{ html: string; text?: string }>;

  // Writes — called ONLY from Action execute() paths behind the spec 20 gate.
  createTemplate(input: { name: string; html: string }): Promise<{ id: string }>;
  /** PATCH an existing CODE template's HTML — the registry's PATCH-not-duplicate
   * discipline (06 §4: Arthaus klaviyo-push.js precedent). */
  updateTemplate(id: string, input: { html: string; name?: string }): Promise<void>;
  createCampaign(input: CreateCampaignInput): Promise<{ campaignId: string; messageId: string }>;
  assignTemplate(messageId: string, templateId: string): Promise<void>;
  updateCampaignSendStrategy(campaignId: string, strategy: { datetime: string }): Promise<void>;
  createSendJob(campaignId: string): Promise<{ status: string }>;
  cancelSendJob(campaignId: string, opts?: { revertToDraft?: boolean }): Promise<void>;
  uploadImage(input: { name: string; data: Uint8Array; mediaType: string }): Promise<{ id: string; imageUrl: string }>;
}

// ---------------------------------------------------------------------------
// Re-exports for consumers
// ---------------------------------------------------------------------------

export type { ProvenanceClaim, ProvenanceOrigin, SkillToolDefinition, StoreRepo } from "../skill-kit";
