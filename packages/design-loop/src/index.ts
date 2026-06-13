/**
 * @marketing-os/design-loop
 *
 * The design-code deep agent: the render → see → refine engine plus the Design
 * Work Contract for orchestrator delegation. See
 * docs/plans/brand-conversion-design-agent/.
 */
export * from "./types.js";
export * from "./contract.js";
export { loadConfig, type DesignLoopConfig } from "./config.js";
export { checkDarkPatterns, checkA11y, checkTokenFidelity } from "./gates.js";
export { evaluateConformance, type EvaluateInput } from "./conformance.js";
export { runRefineLoop, type RefineLoopInput } from "./refine-loop.js";
export { runDesignAgent, type RunAgentDeps } from "./deep-agent.js";
export {
  DelegationService,
  type DelegationServiceOptions,
  type StartResult,
  type ReportEnvelope,
} from "./delegation/handlers.js";
export {
  buildProviders,
  createStubProviders,
  type BuildProvidersOptions,
  type StubScenario,
} from "./providers/index.js";
export { runBench, formatBench, type BenchRunResult, type BenchCaseResult } from "./bench/runner.js";
export { BENCH_CASES, type BenchCase } from "./bench/cases.js";
export {
  assertAbstracted,
  type DesignKnowledge,
  type CategoryConventions,
  type DesignPrinciple,
  type ReferencePattern,
  type TokenRecommendation,
  type ValidateConformanceInput,
} from "./design-mcp/types.js";
export { MockDesignKnowledge } from "./design-mcp/mock.js";
export { localUploader, mockSignedUrlUploader, type BundleUploader } from "./upload.js";
export * from "./brand/index.js";
export {
  loadLocalSkillSet,
  LOCAL_SKILLSET,
  selectSkills,
  LocalSkillSetSource,
  pullSkillSet,
  type DesignSkill,
  type SkillSet,
  type SkillManifest,
  type SkillSetPin,
  type SkillSetSource,
} from "./skills/index.js";
