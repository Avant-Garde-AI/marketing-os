/**
 * Build a measure-better trace from a WorkReport (PRD §6). Owner signal and the
 * conversion anchor arrive from outside the loop (the planner/owner reacts
 * later), so they're passed in.
 */
import type { WorkReport } from "../contract.js";
import { designTraceSchema, type ConversionAnchor, type DesignTrace, type OwnerSignal, TRACE_VERSION } from "./types.js";

export interface BuildTraceInput {
  ownerSignal?: OwnerSignal;
  conversionAnchor?: ConversionAnchor;
  now: () => string;
  traceId?: string;
}

export function buildTrace(report: WorkReport, input: BuildTraceInput): DesignTrace {
  const ts = input.now();
  const conformance = report.conformance;
  return designTraceSchema.parse({
    traceVersion: TRACE_VERSION,
    traceId: input.traceId ?? `${report.taskId}@${ts}`,
    taskId: report.taskId,
    ts,
    status: report.status,
    provenance: {
      skillsInvoked: report.provenance.skillsInvoked,
      patternsInvoked: report.provenance.patternsInvoked,
    },
    loopHealth: {
      iterations: report.loopHealth.iterations,
      maxIterations: report.loopHealth.maxIterations,
      escalated: report.loopHealth.escalated,
      firstPassConformance: report.loopHealth.firstPassConformance,
    },
    conformance: {
      pre: report.loopHealth.firstPassScore,
      post: conformance?.score,
      passed: conformance?.passed ?? false,
      darkPatternPassed: report.gates.darkPattern.passed,
      a11yPassed: report.gates.a11y.passed,
      tokenFidelityPassed: report.gates.tokenFidelity.passed,
    },
    visualOutcome: {
      hasBundle: report.captureBundleRef !== undefined,
      mismatch: conformance?.visualDiff?.mismatch,
      regression: conformance?.visualDiff?.regression,
    },
    ownerSignal: input.ownerSignal ?? "pending",
    conversionAnchor: input.conversionAnchor,
    versionVector: report.versionVector,
  });
}
