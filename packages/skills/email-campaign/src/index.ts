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
