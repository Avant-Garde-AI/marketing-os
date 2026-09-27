/**
 * @avant-garde/skill-offers — Offer Agent skill pack (spec 32 OF0/OF2).
 *
 * Spec 20 §5 package shape: `tools`, `actions`, `instructions` all present.
 * `metadata`/`requires`/the console enable-gate wiring live in each binding
 * (mirrors how email/social wire theirs), not in this package.
 */

export * from "./types";
export { compileOfferManifest } from "./manifest";
export type { CompileOfferManifestInput } from "./manifest";
export { gateOfferContent } from "./gates";
export type { OfferGateResult } from "./gates";
export {
  decideOfferExperiment,
  MIN_IMPRESSIONS,
  MIN_CAPTURES,
  PROMOTE_AT,
  FUTILITY_AT,
  FUTILITY_N,
} from "./decision";
export type { OfferDecision, OfferDecisionKind } from "./decision";
export { createReviewOfferExperimentTool, createChartOfferPerformanceTool } from "./tools";
export type { CreateOfferToolsDeps } from "./tools";
export {
  STRATEGY_PATH,
  offerPath,
  resultsPath,
  offerManifestSchema,
  parseStrategy,
  serializeStrategy,
  parseOffer,
  serializeOffer,
  parseResults,
  serializeResults,
  appendResultEntry,
} from "./artifacts";
export { createOfferActions } from "./actions";
export type {
  OfferActionDeps,
  ActivateOfferParams,
  PauseOfferParams,
  RetireOfferParams,
  ReallocateOfferParams,
} from "./actions";
export { instructions } from "./instructions";
