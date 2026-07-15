/**
 * @avant-garde/skill-social-media — Social Media Agent skill pack, SM0
 * (spec 24 §7: model + planning reads).
 *
 * Spec 20 §5 package shape. This version ships `metadata`, `tools` (as a
 * repo-bound factory), and `instructions`. `actions` is intentionally empty:
 * approve/schedule/publish/cancel land in SM2 on the Action framework.
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
export { instructions } from "./instructions";

/** Spec 20 §5 metadata. */
export const metadata = {
  id: "social-media",
  name: "Social Media Agent (planning)",
  description:
    "Plan organic social from the Brand Soul: strategy/calendar/post artifacts in the store repo plus ungated planning reads. Publishing Actions arrive in SM2.",
  category: "campaign",
  version: "0.1.0",
  author: "Avant-Garde",
} as const;

/**
 * Spec 20 §5 `requires`. SM0 needs no provider scopes of its own — the tools
 * read the store repo through the runtime-bound SocialRepo accessor.
 * (SM2 adds per-channel provider connections: pinterest, meta.)
 */
export const requires = { providers: [], scopes: [] } as const;

/** Spec 20 §5 `actions` — none in SM0 by design (writes narrow through the gate, SM2). */
export const actions = [] as const;
