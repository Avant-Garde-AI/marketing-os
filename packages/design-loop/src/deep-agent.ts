/**
 * The design-code deep agent (implementer).
 *
 * Decomposes a TaskSpec into per-page/section sub-tasks, runs the bounded refine
 * loop for each (sequentially here; the contract is per-taskId so a caller may
 * fan out managed sub-agents in parallel), and merges the results into a single
 * WorkReport — the artifact the planner replans from.
 *
 * Aggregation rules:
 *   - any sub-task rejected  → overall `rejected` (guardrail/asset-boundary win)
 *   - all sub-tasks accepted → `completed`
 *   - otherwise (some escalated/blocked) → `escalated`
 *   - aggregate conformance is worst-of across sub-tasks
 */
import { runRefineLoop } from "./refine-loop.js";
import type { DesignLoopConfig } from "./config.js";
import type {
  ConformanceResult,
  DesignLoopProviders,
  LoopCandidate,
  LoopResult,
} from "./types.js";
import {
  CONTRACT_VERSION,
  type ProgressEvent,
  type SubTaskReport,
  type TaskSpec,
  type WorkReport,
  type WorkReportStatus,
} from "./contract.js";

export interface RunAgentDeps {
  providers: DesignLoopProviders;
  config: DesignLoopConfig;
  onProgress?: (e: ProgressEvent) => void;
  /** Injectable clock (Date.now()/new Date() are unavailable in some runtimes). */
  now?: () => string;
}

interface SubTaskPlan {
  subTask: string;
  page: string;
  sections: string[];
  files: string[];
}

export async function runDesignAgent(spec: TaskSpec, deps: RunAgentDeps): Promise<WorkReport> {
  const now = deps.now ?? (() => new Date().toISOString());
  const plans = decompose(spec);
  const maxIterations = spec.constraints.maxIterations;

  deps.onProgress?.({
    contractVersion: CONTRACT_VERSION,
    taskId: spec.taskId,
    ts: now(),
    phase: "planning",
    note: `Decomposed into ${plans.length} sub-task(s)`,
  });

  const results: { plan: SubTaskPlan; loop: LoopResult }[] = [];
  try {
    for (const plan of plans) {
      const loop = await runRefineLoop({
        taskId: spec.taskId,
        subTask: plan.subTask,
        page: plan.page,
        intent: spec.intent,
        brand: spec.brand,
        scope: { pages: [plan.page], sections: plan.sections, files: plan.files },
        brandDesignRef: spec.brandDesignRef,
        wcag: spec.guardrails.wcag,
        maxIterations,
        acceptThreshold: deps.config.acceptThreshold,
        workspaceDir: deps.config.workDir,
        outDir: `${deps.config.workDir}/${spec.taskId}/${slug(plan.subTask)}`,
        themeRef: spec.brandDesignRef.version,
        versionVector: deps.config.versionVector,
        providers: deps.providers,
        onProgress: deps.onProgress,
        now,
      });
      results.push({ plan, loop });
      // A guardrail refusal short-circuits the whole task.
      if (loop.rejected) break;
    }
  } finally {
    await deps.providers.themeServer.stop().catch(() => undefined);
  }

  const skillsetVersion = deps.providers.skillSet?.manifest.version ?? deps.config.versionVector.skillset;
  return assembleReport(spec, results, maxIterations, deps.config, skillsetVersion);
}

function decompose(spec: TaskSpec): SubTaskPlan[] {
  const pages = spec.scope.pages.length > 0 ? spec.scope.pages : ["/"];
  return pages.map((page) => ({
    subTask: page,
    page,
    sections: spec.scope.sections,
    files: spec.scope.files,
  }));
}

function assembleReport(
  spec: TaskSpec,
  results: { plan: SubTaskPlan; loop: LoopResult }[],
  maxIterations: number,
  config: DesignLoopConfig,
  skillsetVersion: string,
): WorkReport {
  const subTasks: SubTaskReport[] = results.map(({ plan, loop }) => ({
    subTask: plan.subTask,
    status: loopStatus(loop),
    iterations: loop.iterations,
    escalated: loop.escalated,
    conformance: loop.best?.conformance,
    captureBundleRef: loop.best?.bundle,
    critique: loop.critique ?? loop.rejectionReason,
  }));

  const status = aggregateStatus(results.map((r) => loopStatus(r.loop)));
  const worst = worstCandidate(results.map((r) => r.loop));
  const touchedFiles = unique(results.flatMap((r) => r.loop.best?.touchedFiles ?? []));

  const darkPatternPassed = results.every((r) => r.loop.best?.conformance.gates.darkPattern.passed ?? true);
  const a11yPassed = results.every((r) => r.loop.best?.conformance.gates.a11y.passed ?? true);
  const tokenPassed = results.every((r) => r.loop.best?.conformance.gates.tokenFidelity.passed ?? true);

  const totalIterations = results.reduce((sum, r) => sum + r.loop.iterations, 0);
  const firstPassConformance =
    results.length > 0 && results.every((r) => r.loop.history[0]?.conformance.passed === true);

  const unresolved = results
    .filter((r) => r.loop.escalated || loopStatus(r.loop) === "blocked")
    .map((r) => ({
      subTask: r.plan.subTask,
      reason: r.loop.critique ?? "did not reach acceptance within the iteration cap",
      suggestedNext: "review the best candidate, re-scope, or surface to the owner",
    }));

  return {
    contractVersion: CONTRACT_VERSION,
    taskId: spec.taskId,
    status,
    summary: summarize(spec, status, results),
    changes: {
      commits: [],
      touchedFiles,
      diffStat: { files: touchedFiles.length, insertions: 0, deletions: 0 },
    },
    conformance: worst?.conformance,
    captureBundleRef: worst?.bundle,
    loopHealth: {
      iterations: totalIterations,
      maxIterations,
      escalated: results.some((r) => r.loop.escalated),
      firstPassConformance,
      bestCandidateCritique: worst ? (results.find((r) => r.loop.best === worst)?.loop.critique) : undefined,
    },
    gates: {
      darkPattern: {
        passed: darkPatternPassed,
        hits: collectFindings(results, (c) => c.gates.darkPattern.findings.map((f) => f.message)),
      },
      a11y: {
        passed: a11yPassed,
        violations: collectFindings(results, (c) => c.gates.a11y.findings.map((f) => f.message)),
      },
      tokenFidelity: {
        passed: tokenPassed,
        drift: collectFindings(results, (c) =>
          c.gates.tokenFidelity.findings.filter((f) => f.severity !== "info").map((f) => f.message),
        ),
      },
    },
    unresolved,
    recommendations: buildRecommendations(results),
    subTasks,
    provenance: {
      skillsInvoked: unique(results.flatMap((r) => r.loop.skillsInvoked)),
      patternsInvoked: [],
    },
    versionVector: { ...config.versionVector, skillset: skillsetVersion },
  };
}

function loopStatus(loop: LoopResult): WorkReportStatus {
  if (loop.rejected) return "rejected";
  if (loop.accepted) return "completed";
  if (loop.escalated) return "escalated";
  return "blocked";
}

function aggregateStatus(statuses: WorkReportStatus[]): WorkReportStatus {
  if (statuses.length === 0) return "blocked";
  if (statuses.includes("rejected")) return "rejected";
  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.includes("escalated")) return "escalated";
  return "blocked";
}

function worstCandidate(loops: LoopResult[]): LoopCandidate | null {
  let worst: LoopCandidate | null = null;
  for (const loop of loops) {
    const c = loop.best;
    if (!c) continue;
    if (worst === null || c.conformance.score < worst.conformance.score) worst = c;
  }
  return worst;
}

function collectFindings(
  results: { loop: LoopResult }[],
  pick: (c: ConformanceResult) => string[],
): string[] {
  const out: string[] = [];
  for (const r of results) {
    const c = r.loop.best?.conformance;
    if (c) out.push(...pick(c));
  }
  return unique(out);
}

function buildRecommendations(results: { plan: SubTaskPlan; loop: LoopResult }[]): string[] {
  const recs: string[] = [];
  for (const { plan, loop } of results) {
    if (loop.rejected) recs.push(`Refused "${plan.subTask}": ${loop.rejectionReason}`);
    else if (loop.escalated) recs.push(`"${plan.subTask}" hit the iteration cap — owner review suggested.`);
  }
  return recs;
}

function summarize(
  spec: TaskSpec,
  status: WorkReportStatus,
  results: { plan: SubTaskPlan; loop: LoopResult }[],
): string {
  const done = results.filter((r) => r.loop.accepted).length;
  return `[${status}] "${spec.intent}" — ${done}/${results.length} sub-task(s) accepted across ${results.length} page(s).`;
}

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "root";
}
