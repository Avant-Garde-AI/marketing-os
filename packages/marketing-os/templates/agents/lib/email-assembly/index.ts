/**
 * @avant-garde/email-assembly — the Email Campaign Agent's HTML seam
 * (docs/email-campaign-agent/04, workstreams WS2-R3/R4).
 *
 * Pure and deterministic throughout: no Klaviyo, no Penpot, no filesystem,
 * no clock, no randomness. Same input → byte-identical output.
 *
 *   composePartials  — store-repo template authoring from shared partials
 *   extractSkeleton  — reference template → frame + {{slot:NAME}} markers
 *   assembleEmail    — skeleton + sections + DTCG tokens → email.html + report
 */

export {
  // Types + schemas
  type DtcgToken,
  type DtcgGroup,
  type DtcgTokensFile,
  type SkeletonSlot,
  type SkeletonFinding,
  type SkeletonFindingType,
  type ExtractedSkeleton,
  type ExtractOptions,
  type ProductItem,
  type EmailBlock,
  type SurfaceSection,
  type HtmlSection,
  type EmailSection,
  type CampaignMeta,
  type AssembleOptions,
  type AssembleEmailInput,
  type AssemblyErrorCode,
  type AssemblyWarningCode,
  type AssemblyIssue,
  type AssemblyReport,
  type AssembledEmail,
  type ComposePartialsReport,
  type ComposedTemplate,
  emailBlockSchema,
  emailSectionSchema,
  surfaceSectionSchema,
  htmlSectionSchema,
  productItemSchema,
  campaignMetaSchema,
  assembleOptionsSchema,
  assembleEmailInputSchema,
  skeletonInputSchema,
} from "./types";

export { extractSkeleton, SkeletonExtractionError } from "./extract";
export { assembleEmail } from "./assemble";
export { composePartials, PARTIAL_MARKER_RE } from "./compose";
export { renderBlock, renderSurface, escapeHtml, escapeAttr } from "./renderers";
export {
  resolveEmailTheme,
  emitEmailStyles,
  toCssFontStack,
  approxLuminance,
  COLOR_SCHEME_META,
  type EmailTheme,
} from "./css";
export {
  checkAssembledEmail,
  checkColumnWidths,
  findUnsubscribeTags,
  findMergeTags,
  hostAllowed,
  DEFAULT_ALLOWED_IMAGE_HOSTS,
  HTML_FAIL_BYTES,
  HTML_WARN_BYTES,
  IMAGE_WEIGHT_WARN_BYTES,
  NON_TRIVIAL_TEXT_CHARS,
  type InvariantContext,
  type InvariantResult,
} from "./invariants";
