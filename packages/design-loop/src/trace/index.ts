/**
 * Measure-better instrumentation (PRD §6) — emit de-identified outcome traces
 * that feed the network learning loop (§5).
 */
export {
  designTraceSchema,
  ownerSignalSchema,
  conversionAnchorSchema,
  TRACE_VERSION,
  type DesignTrace,
  type OwnerSignal,
  type ConversionAnchor,
} from "./types.js";
export { buildTrace, type BuildTraceInput } from "./build.js";
export { scrubTrace, assertNoLeak, type ScrubSecrets } from "./scrub.js";
export { collectingSink, jsonlSink, nullSink, type TraceSink } from "./emit.js";
