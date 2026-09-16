/**
 * @avant-garde/skill-offers — Offer Agent skill pack (spec 32 OF0).
 *
 * Spec 20 §5 package shape. `metadata`/`requires` land with the console
 * enable-gate wiring; `actions` (offer.activate/pause/retire/reallocate as
 * pack-owned Action<P> declarations) land in spec 32 OF2 once the artifact
 * model and the git-first write lane exist for them to write through. This
 * version ships the canonical logic that was duplicated across three repos:
 * manifest compilation, the dark-pattern gate, the experiment decision
 * engine, the two fully-shared tools, and instructions.
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
export { instructions } from "./instructions";
