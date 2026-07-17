/**
 * @avant-garde/skill-kit — shared library for Marketing OS skill packs
 * (05-AGENT-LIBRARY-HARDENING H6).
 *
 * One creative-channel pack is an implementation; two are a library. This
 * package holds exactly what the social + email pair proved is shared:
 * the store-repo seam, the plain tool-definition shape, front-matter document
 * helpers, provenance types, and the spec 20 Action contract. It deliberately
 * contains NO domain logic and NO runtime (Mastra) dependency.
 */

export type { StoreRepo } from "./repo";
export { createMemoryRepo } from "./repo";
export type { SkillToolDefinition } from "./tool";
export type { ProvenanceOrigin, ProvenanceClaim } from "./provenance";
export { splitFrontMatter, frontMatterDocument, validateFrontMatter } from "./front-matter";
export type {
  Action,
  AnyAction,
  ActionPreview,
  ActionResult,
  ActionRisk,
  ActionRow,
} from "./action";
