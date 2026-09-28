/**
 * @avant-garde/skill-offers — Offer Agent skill pack (spec 32 OF0/OF2,
 * spec 34 manifest v2 + design harness + incumbent audit).
 *
 * Spec 20 §5 package shape: `tools`, `actions`, `instructions` all present.
 * `metadata`/`requires`/the console enable-gate wiring live in each binding
 * (mirrors how email/social wire theirs), not in this package.
 */

export * from "./types";
export { compileOfferManifest, OFFER_IMAGE_ORIGIN } from "./manifest";
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
export {
  createReviewOfferExperimentTool,
  createChartOfferPerformanceTool,
  createAuditCurrentOfferTool,
  createDesignOfferChallengersTool,
  createGetOfferJobTool,
  OfferQuotaError,
  offerJobPhase,
} from "./tools";
export type { CreateOfferToolsDeps, CreateOfferJobToolsDeps } from "./tools";
export {
  compileOfferManifestV2,
  checkManifestV2Structure,
  isStoreRelativePath,
  resolveArmKind,
  percentCapFor,
  DEFAULT_STYLE_V2,
  DEFAULT_PERCENT_CAP,
  HEAD_TO_HEAD_VENDORS,
  IMAGE_COMPOSITIONS,
  MAX_STEPS,
} from "./manifest-v2";
export type {
  CompileOfferManifestV2Input,
  ManifestV2Problem,
  MarginPolicy,
  StructureCheckOptions,
} from "./manifest-v2";
export {
  gateOfferManifestV2,
  validateOfferManifest,
  scanOfferCopy,
  scanDeclineCopy,
  collectVariantCopy,
} from "./gates-v2";
export type {
  CopyFinding,
  OfferV2Finding,
  OfferGateV2Result,
  GateOfferManifestV2Options,
  OfferManifestValidation,
} from "./gates-v2";
export {
  OfferConceptSchema,
  offerManifestV2Schema,
  blockSchema,
  stepSchema,
  incentiveSchema,
  triggerSpecSchema,
  PLACEMENTS,
  COMPOSITIONS,
  ARCHETYPE_IDS,
  INCENTIVE_TYPES,
  ANSWER_KEY_RE,
  CELL_KEY_RE,
} from "./schema-v2";
export type { OfferConcept } from "./schema-v2";
export {
  ARCHETYPES,
  checkConceptDiversity,
  aggregateCriticScores,
  selectArms,
  CRITIC_WEIGHTS,
  HARD_GATE_CRITICS,
} from "./harness";
export type {
  ArchetypeInfo,
  ConceptDiversityResult,
  CriticId,
  CriticScore,
  AggregateCriticResult,
  ScoredConcept,
} from "./harness";
export {
  VENDOR_FINGERPRINTS,
  VENDOR_LABELS,
  UNKNOWN_VENDOR_RULE,
  matchVendorFingerprint,
  gradeOfferAudit,
  gradeFromScore,
  RUBRIC_WEIGHTS,
  NO_OFFER_SUMMARY,
  DARK_PATTERN_SCORE_CAP,
} from "./audit";
export type { VendorFingerprint } from "./audit";
export {
  STRATEGY_PATH,
  offerPath,
  resultsPath,
  offerManifestSchema,
  offerManifestV1Schema,
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
export { instructions, harnessInstructions } from "./instructions";
