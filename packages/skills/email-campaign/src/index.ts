/**
 * @avant-garde/skill-email-campaign — Email Campaign Agent skill pack
 * (docs/email-campaign-agent — Klaviyo-first, spec 24's sibling).
 *
 * Spec 20 §5 package shape. This version ships `metadata`, `requires`,
 * `tools` (as a repo+client-bound factory), and `instructions`. The four
 * Actions (email.approve_plan, klaviyo.create_campaign_draft,
 * klaviyo.schedule_campaign, klaviyo.cancel_send) are declared in
 * ./actions and exported once the drafting orchestration lands (WS3-R5);
 * they are inert until the spec 20 A0/A1 runtime gate exists.
 */

export * from "./types";
export {
  STRATEGY_PATH,
  REGISTRY_PATH,
  calendarPath,
  campaignPath,
  campaignHtmlPath,
  campaignAssetsPrefix,
  skeletonPath,
  skeletonHtmlPath,
  parseStrategy,
  serializeStrategy,
  parseCalendar,
  serializeCalendar,
  parseCampaign,
  serializeCampaign,
  parseSkeleton,
  serializeSkeleton,
  parseRegistry,
  serializeRegistry,
} from "./artifacts";
export {
  proposeEmailPlan,
  analyzeEmailCalendarGaps,
  rotateArchetypes,
  monthWeeks,
} from "./plan";
export type {
  EmailPlanProposal,
  ProposedEmailSlot,
  PlanContext,
  EmailGapAnalysis,
  ArchetypeBalance,
  AudienceContact,
} from "./plan";
export { createEmailTools, inlineUniversalContent } from "./tools";
export type { EmailTools } from "./tools";
export { instructions } from "./instructions";
export {
  // WS2-R2 — email compose templates (board vocabulary)
  hero,
  promoBanner,
  productFeature,
  editorialMoment,
  emailComposeTemplates,
  heroPayloadSchema,
  promoBannerPayloadSchema,
  productFeaturePayloadSchema,
  editorialMomentPayloadSchema,
  boardImageSchema,
  EMAIL_BOARD_WIDTH,
  EMAIL_BOARD_GEOMETRY,
} from "./compose-templates";
export type {
  EmailBoardSpec,
  EmailComposeElement,
  EmailFill,
  EmailImageMediaType,
  BoardImage,
  HeroPayload,
  PromoBannerPayload,
  ProductFeaturePayload,
  EditorialMomentPayload,
  EmailComposeTemplateName,
} from "./compose-templates";
export { resolveEmailBrandTheme, gfontId } from "./brand-tokens";
export type { EmailBrandTheme, DtcgLikeTokens } from "./brand-tokens";
// WS2-R6 — email design-system scaffold
export { scaffoldEmailSystem } from "./scaffold";
export type { ScaffoldEmailSystemOptions } from "./scaffold";
// WS3-R5 — the four spec 20 Actions (inert until the A0/A1 runtime gate;
// the hosted runtime registers them via createEmailActions)
export { createEmailActions, campaignTemplateSlug, slotCampaignId } from "./actions";
export type {
  EmailActionDeps,
  AssembledEmail,
  ApprovePlanParams,
  CreateDraftParams,
  ScheduleParams,
  CancelParams,
} from "./actions";

/** Spec 20 §5 metadata. */
export const metadata = {
  id: "email-campaign",
  name: "Email Campaign Agent",
  description:
    "Plan and draft Klaviyo email campaigns from the Brand Soul: email/ artifacts in the store repo, ungated planning + Klaviyo reads, gated draft/schedule/cancel Actions. Nothing sends without a human approval.",
  category: "campaign",
  version: "0.1.0",
  author: "Avant-Garde",
} as const;

/**
 * Spec 20 §5 `requires`. Enablement is gated on a live klaviyo
 * provider_connections row (05 H1.2); scopes are the least-privilege set the
 * unlisted OAuth app requests (02 §2 — no segments:write in v1).
 */
export const requires = {
  providers: ["klaviyo"],
  scopes: [
    "klaviyo:read",
    "klaviyo:write_campaigns",
    "klaviyo:write_templates",
    "klaviyo:write_images",
  ],
} as const;

/**
 * Spec 20 §5 `reports` — spec 19 saved-report prompts this pack contributes
 * (WS4-R5). The report cron runs these through the agent, whose merged email
 * tools do the reading; the card plumbing is spec 17's.
 */
export const reports = [
  {
    id: "email-recap",
    name: "Email Recap",
    description:
      "Per-campaign performance vs the store's trailing baseline, attribution basis stated.",
    prompt:
      "Produce this store's Email Recap. Use email_calendar_read for the current month and klaviyo_performance_read for every campaign that reached `sent` or `measured` in the reporting window (state the attribution basis it returns — never mix counting systems). For each campaign: subject, audience + size, delivered, open rate, click rate, CTOR, unsubscribes, conversions, revenue, revenue-per-recipient. Compare each metric to the store's trailing 90-day campaign averages from the same tool and call out material deltas (>20%) honestly, citing numbers. Close with what the next plan should repeat or drop, grounded in the readback (provenance: data).",
  },
] as const;
