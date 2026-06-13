/**
 * Measure-better trace (PRD §6) — the outcome signal emitted per design action
 * that feeds the network learning loop (§5).
 *
 * The trace is GENERALIZABLE BY CONSTRUCTION: it carries skill/pattern
 * provenance, loop health, conformance scores, gate booleans, owner signal, the
 * conversion anchor, and the version vector — and deliberately NOT brand copy,
 * brand tokens, the capture-bundle location, touched file paths, or any free
 * text. The de-identification boundary (PRD §5) is the schema itself, backed by
 * `assertNoLeak` as a mechanical client-side guard before egress.
 */
import { z } from "zod";
import { versionVectorSchema, workReportStatusSchema } from "../contract.js";

export const ownerSignalSchema = z.enum(["pending", "accepted", "rejected", "revised"]);
export type OwnerSignal = z.infer<typeof ownerSignalSchema>;

export const conversionAnchorSchema = z.object({
  experimentId: z.string(),
  metric: z.string(),
  /** Realized lift as a fraction (e.g. 0.07 = +7%). The ground-truth signal. */
  lift: z.number(),
});
export type ConversionAnchor = z.infer<typeof conversionAnchorSchema>;

export const TRACE_VERSION = "1.0.0";

export const designTraceSchema = z.object({
  traceVersion: z.string().default(TRACE_VERSION),
  traceId: z.string(),
  taskId: z.string(),
  ts: z.string(),
  status: workReportStatusSchema,
  provenance: z.object({
    skillsInvoked: z.array(z.string()).default([]),
    patternsInvoked: z.array(z.string()).default([]),
  }),
  loopHealth: z.object({
    iterations: z.number().int().nonnegative(),
    maxIterations: z.number().int().positive(),
    escalated: z.boolean(),
    firstPassConformance: z.boolean(),
  }),
  conformance: z.object({
    pre: z.number().min(0).max(1).optional(),
    post: z.number().min(0).max(1).optional(),
    passed: z.boolean(),
    darkPatternPassed: z.boolean(),
    a11yPassed: z.boolean(),
    tokenFidelityPassed: z.boolean(),
  }),
  visualOutcome: z.object({
    hasBundle: z.boolean(),
    mismatch: z.number().min(0).max(1).optional(),
    regression: z.boolean().optional(),
  }),
  ownerSignal: ownerSignalSchema,
  conversionAnchor: conversionAnchorSchema.optional(),
  versionVector: versionVectorSchema,
});
export type DesignTrace = z.infer<typeof designTraceSchema>;
