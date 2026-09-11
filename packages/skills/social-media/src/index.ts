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
export {
  GENOME_PATH,
  CORPUS_DIR,
  SEEDS_PATH,
  genomeFrontMatterSchema,
  parseGenome,
  serializeGenome,
  resolveArchetype,
  rankArchetypes,
  findArchetype,
  repoReferenceCorpus,
  emptyReferenceCorpus,
} from "./reference";
export type {
  ReferenceCorpus,
  GenomeQuery,
  ResolvedSlot,
  Board,
  RankOptions,
} from "./reference";
export { resolveSlots, assertComplete, chooseArchetype, missingRoles } from "./resolve";
export {
  CONCEPTS_DIR, conceptPath, parseConcept, serializeConcept, validateConcept,
  assertConceptValid, assessFit, selectSubjects, beatInstruction,
  type PostConcept, type ConceptNeed, type ConceptBeat, type ConceptEvidence,
  type ConceptExpressions, type ConceptFormat, type ConceptProblem, type ConceptVoice,
  type FitVerdict, type NeedAssessment, type SceneConstants, type SelectionResult,
  type SequenceExpression, type SingleExpression, type SubjectFit,
} from "./concepts";
export {
  specFromArchetype,
  fetchImageAsset,
  imageDimensions,
  MAX_ASPECT_DISTORTION,
  type ArchetypeComposeInput,
  type MaterializeImage,
  type MaterializedImage,
  type SurfaceStyle,
  type SurfaceComposeSpec,
  type SurfaceComposeElement,
  type SurfaceFill,
  type TextStyle,
} from "./archetype-surface";
export type {
  SlotFill,
  SlotBindings,
  FilledSlot,
  SlotMiss,
  Resolution,
  ChooseOptions,
  Choice,
} from "./resolve";
export {
  groupKey,
  groupPosts,
  postMonth,
  postThumbnailUrl,
  postDetailPath,
  postCalendarProjection,
  postIndexRow,
  UNSCHEDULED_MONTH,
} from "./projection";
export type { SocialCalendarProjection, SocialPostIndexRow } from "./projection";
export {
  upsertPost,
  nextPost,
  schedulingGaps,
  upsertCalendar,
  linkPostToCalendarSlot,
} from "./authoring";
export { checkPostClaims, claimRefusal } from "./claims";
export type { BoundFacts, ClaimProblem, ClaimReport } from "./claims";
export { scaffoldSocialSystem } from "./scaffold";
export type { ScaffoldSocialOptions } from "./scaffold";
export type {
  SocialPostUpsertInput,
  SocialPostUpsertResult,
  SocialCalendarUpsertInput,
  SocialCalendarUpsertResult,
} from "./authoring";
export { createSocialActions, publishMaterial, approvalHash, verifyScheduleConsent } from "./actions";
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
