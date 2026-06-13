/**
 * Client-side scrubbing + de-identification guard (PRD §5).
 *
 * The trace is generalizable by construction, but brand visual identity is
 * especially identifying, so the bar is high: before any trace leaves the client
 * environment we (1) redact any brand secret that slipped into a string field
 * and (2) assert no secret remains. A detected leak throws rather than emits —
 * fail closed.
 */
import { designTraceSchema, type DesignTrace } from "./types.js";

export interface ScrubSecrets {
  /** Brand identifier — never belongs in a shared trace. */
  brandId?: string;
  /** Brand token values (e.g. hex colors). */
  tokens?: string[];
  /** Verbatim brand copy snippets. */
  copy?: string[];
}

const REDACTION = "[redacted]";

export function scrubTrace(trace: DesignTrace, secrets: ScrubSecrets): DesignTrace {
  const terms = secretTerms(secrets);
  if (terms.length === 0) return trace;
  // Redact across all string fields, then re-validate the shape.
  const redacted = JSON.parse(redactJson(JSON.stringify(trace), terms)) as unknown;
  const out = designTraceSchema.parse(redacted);
  assertNoLeak(out, secrets);
  return out;
}

/** Throws if any brand secret appears anywhere in the serialized trace. */
export function assertNoLeak(trace: DesignTrace, secrets: ScrubSecrets): void {
  const haystack = JSON.stringify(trace).toLowerCase();
  for (const term of secretTerms(secrets)) {
    if (haystack.includes(term.toLowerCase())) {
      throw new Error(`Trace de-id boundary violation: brand secret leaked into trace ${trace.traceId}`);
    }
  }
}

function secretTerms(secrets: ScrubSecrets): string[] {
  return [secrets.brandId, ...(secrets.tokens ?? []), ...(secrets.copy ?? [])]
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

function redactJson(json: string, terms: string[]): string {
  let out = json;
  for (const term of terms) {
    out = out.split(term).join(REDACTION);
  }
  return out;
}
