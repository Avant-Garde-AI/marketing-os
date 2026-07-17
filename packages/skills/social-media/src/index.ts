/**
 * @avant-garde/skill-social-media — Social Media Agent skill pack
 * (spec 24: SM0 model + planning reads, SM2 publish Actions).
 *
 * Spec 20 §5 package shape: `metadata`, `tools` (as a repo-bound factory),
 * `instructions`, and `actions` — the publish lane (schedule/publish/cancel)
 * declared as Action factories the hosted runtime registers with the gate.
 */

export * from "./types";
export {
  STRATEGY_PATH,
  calendarPath,
  postPath,
  parseStrategy,
  serializeStrategy,
  parseCalendar,
  serializeCalendar,
  parsePost,
  serializePost,
  linkDesignToPost,
} from "./artifacts";
export {
  createSocialTools,
  proposePlan,
  analyzeCalendarGaps,
  monthWeeks,
  pickEvenly,
  rotatePillars,
} from "./tools";
export type {
  SocialTools,
  PlanProposal,
  ProposedSlot,
  PlanContext,
  GapAnalysis,
  PillarBalance,
} from "./tools";
export { createSocialActions, publishMaterial, approvalHash } from "./actions";
export type {
  SocialActionDeps,
  SchedulePostParams,
  PublishPostParams,
  CancelPostParams,
} from "./actions";
export { instructions } from "./instructions";

/** Spec 20 §5 metadata. */
export const metadata = {
  id: "social-media",
  name: "Social Media Agent (planning + publishing)",
  description:
    "Plan organic social from the Brand Soul: strategy/calendar/post artifacts in the store repo, ungated planning reads, and governed publish Actions (approve-at-schedule) over channel adapters.",
  category: "campaign",
  version: "0.2.0",
  author: "Avant-Garde",
} as const;

/**
 * Spec 20 §5 `requires`. The planning reads need no provider scopes — they
 * read the store repo through the runtime-bound SocialRepo accessor. The SM2
 * publish Actions require the per-channel connections the runtime's channel
 * adapters resolve (v1: single-tenant env-token bootstrap for
 * instagram/threads; spec 12 Vault/provider_connections rows later).
 */
export const requires = { providers: [], scopes: ["social:publish"] } as const;

/** Spec 20 §5 `actions` — the SM2 publish lane (writes narrow through the gate). */
export const actions = ["social.schedule_post", "social.publish_post", "social.cancel_post"] as const;
