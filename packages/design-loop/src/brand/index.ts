/**
 * Brand Conversion Document (`brand-design.md`) — the brand definition the
 * design-code agent adheres to (PRD §2). Authoring (draft), persona fork,
 * (de)serialization, the design-loop bridge, and commit.
 */
export * from "./schema.js";
export { serializeBrandDesign, parseBrandDesign } from "./serialize.js";
export { draftBrandDesign, type DraftInput } from "./draft.js";
export {
  elicitedPersona,
  neurographPersonaStub,
  type PersonaSource,
  type PersonaInput,
  type ResolvedPersona,
} from "./persona.js";
export { toBrandContext } from "./bridge.js";
export {
  commitBrandDesign,
  memoryCommitter,
  DEFAULT_BRAND_DESIGN_PATH,
  type Committer,
  type CommitResult,
} from "./commit.js";
