/**
 * The bounded refine loop — the core mechanic (PRD §1 Phase B).
 *
 *   propose → implement → render → capture → conform → refine
 *
 * Capped at maxIterations (default 4). Keeps the best-scoring candidate. On the
 * cap it escalates with that best candidate + critique rather than spinning. A
 * guardrail/asset-boundary refusal from the implementer ends the loop as
 * `rejected` — the intended success path, not a failure.
 */
import { evaluateConformance } from "./conformance.js";
import type {
  BrandContext,
  CaptureManifest,
  ConformanceResult,
  DesignLoopProviders,
  LoopCandidate,
  LoopResult,
  VisualDiff,
} from "./types.js";
import type { ProgressEvent } from "./contract.js";

export interface RefineLoopInput {
  taskId: string;
  subTask: string;
  page: string;
  intent: string;
  brand: BrandContext;
  scope: { pages: string[]; sections: string[]; files: string[] };
  wcag: "A" | "AA" | "AAA";
  maxIterations: number;
  acceptThreshold: number;
  workspaceDir: string;
  outDir: string;
  themeRef: string;
  versionVector: CaptureManifest["versionVector"];
  providers: DesignLoopProviders;
  onProgress?: (e: ProgressEvent) => void;
  now: () => string;
}

export async function runRefineLoop(input: RefineLoopInput): Promise<LoopResult> {
  const { providers, maxIterations, acceptThreshold } = input;
  const history: LoopCandidate[] = [];
  let best: LoopCandidate | null = null;
  let priorCritique: ConformanceResult | undefined;
  let baseline: LoopCandidate | null = null;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    emit(input, { phase: "implementing", iteration, note: `Implementing (iteration ${iteration})` });

    const impl = await providers.implementer.implement({
      intent: input.intent,
      brand: input.brand,
      scope: input.scope,
      iteration,
      priorCritique,
      workspaceDir: input.workspaceDir,
    });

    if (impl.refusal) {
      return {
        accepted: false,
        escalated: false,
        rejected: true,
        rejectionReason: impl.refusal.reason,
        iterations: iteration - 1,
        maxIterations,
        best,
        history,
      };
    }

    emit(input, { phase: "rendering", iteration, note: "Rendering preview" });
    const baseUrl = providers.themeServer.baseUrl();
    const manifest: CaptureManifest = {
      page: input.page,
      themeRef: input.themeRef,
      commit: null,
      capturedAt: input.now(),
      versionVector: input.versionVector,
    };
    const bundle = await providers.capture.capture({
      page: input.page,
      baseUrl,
      manifest,
      outDir: `${input.outDir}/iter-${iteration}`,
    });

    emit(input, { phase: "critiquing", iteration, note: "Evaluating conformance" });
    let visualDiff: VisualDiff | undefined;
    if (providers.diff && baseline) {
      visualDiff = await providers.diff.compare({ baseline: baseline.bundle, candidate: bundle });
    }

    const conformance = await evaluateConformance({
      bundle,
      brand: input.brand,
      intent: input.intent,
      wcag: input.wcag,
      critic: providers.critic,
      visualDiff,
    });

    const candidate: LoopCandidate = {
      iteration,
      bundle,
      conformance,
      touchedFiles: impl.touchedFiles,
      note: impl.note,
    };
    history.push(candidate);
    if (best === null || conformance.score > best.conformance.score) best = candidate;
    if (baseline === null) baseline = candidate;

    emit(input, {
      phase: "critiquing",
      iteration,
      note: `Conformance ${conformance.score.toFixed(2)} (${conformance.passed ? "pass" : "fail"})`,
      partialConformance: conformance.score,
    });

    if (conformance.passed && conformance.score >= acceptThreshold) {
      return {
        accepted: true,
        escalated: false,
        rejected: false,
        iterations: iteration,
        maxIterations,
        best,
        history,
      };
    }

    priorCritique = conformance;
    if (iteration < maxIterations) {
      emit(input, { phase: "refining", iteration, note: "Refining toward target" });
    }
  }

  // Cap hit — escalate with the best candidate + critique (PRD §1 Phase B).
  return {
    accepted: false,
    escalated: true,
    rejected: false,
    iterations: maxIterations,
    maxIterations,
    best,
    history,
    critique: best ? summarizeCritique(best.conformance) : "No candidate produced.",
  };
}

function summarizeCritique(c: ConformanceResult): string {
  const parts: string[] = [`score ${c.score.toFixed(2)}`];
  if (!c.gates.darkPattern.passed) parts.push(`${c.gates.darkPattern.findings.length} dark-pattern hit(s)`);
  if (!c.gates.a11y.passed) parts.push(`${c.gates.a11y.findings.length} a11y violation(s)`);
  const errs = c.flags.filter((f) => f.severity === "error").map((f) => f.message);
  if (errs.length) parts.push(`flags: ${errs.slice(0, 3).join("; ")}`);
  if (c.personaFit.notes.length) parts.push(`persona: ${c.personaFit.notes.slice(0, 2).join("; ")}`);
  return parts.join(" · ");
}

function emit(
  input: RefineLoopInput,
  e: { phase: ProgressEvent["phase"]; iteration?: number; note: string; partialConformance?: number },
): void {
  input.onProgress?.({
    contractVersion: "1.0.0",
    taskId: input.taskId,
    ts: input.now(),
    phase: e.phase,
    subTask: input.subTask,
    iteration: e.iteration,
    note: e.note,
    partialConformance: e.partialConformance,
  });
}
