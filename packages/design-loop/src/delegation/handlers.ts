/**
 * Delegation handlers — the Design Work Contract, transport-agnostic.
 *
 * These back both the MCP server and the CLI. The contract is implemented over
 * an in-process task registry with the async idiom used across this stack
 * (NeuroGraph / Store MCP): `implement` returns fast with a task_id; the planner
 * polls `getReport`; `revise` re-enters the loop with corrections.
 */
import { runDesignAgent } from "../deep-agent.js";
import { loadConfig, type DesignLoopConfig } from "../config.js";
import { buildProviders } from "../providers/index.js";
import type { DesignLoopProviders } from "../types.js";
import {
  CONTRACT_VERSION,
  revisionSpecSchema,
  taskSpecSchema,
  type ProgressEvent,
  type RevisionSpec,
  type TaskSpec,
  type WorkReport,
  type WorkReportStatus,
} from "../contract.js";

export interface StartResult {
  taskId: string;
  status: "running" | WorkReportStatus;
}

export interface ReportEnvelope {
  taskId: string;
  status: "running" | "unknown" | WorkReportStatus;
  report: WorkReport | null;
  progress: ProgressEvent[];
}

interface TaskRecord {
  spec: TaskSpec;
  status: "running" | WorkReportStatus;
  report: WorkReport | null;
  progress: ProgressEvent[];
  done: Promise<void>;
}

export interface DelegationServiceOptions {
  config?: Partial<DesignLoopConfig>;
  /** Override provider construction (tests inject stub providers). */
  buildProviders?: (config: DesignLoopConfig) => Promise<DesignLoopProviders>;
  now?: () => string;
}

export class DelegationService {
  private readonly config: DesignLoopConfig;
  private readonly makeProviders: (config: DesignLoopConfig) => Promise<DesignLoopProviders>;
  private readonly now: () => string;
  private readonly tasks = new Map<string, TaskRecord>();

  constructor(options: DelegationServiceOptions = {}) {
    this.config = loadConfig(options.config);
    this.makeProviders = options.buildProviders ?? ((c) => buildProviders(c));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** `implement_design_change`. With async=false, resolves only when complete. */
  async implement(specInput: unknown, opts: { async?: boolean } = {}): Promise<StartResult> {
    const spec = taskSpecSchema.parse(specInput);
    const record = this.launch(spec);
    if (opts.async === false) {
      await record.done;
      return { taskId: spec.taskId, status: record.status };
    }
    return { taskId: spec.taskId, status: "running" };
  }

  /** `get_work_report`. */
  getReport(taskId: string): ReportEnvelope {
    const record = this.tasks.get(taskId);
    if (!record) return { taskId, status: "unknown", report: null, progress: [] };
    return { taskId, status: record.status, report: record.report, progress: record.progress };
  }

  /** Await completion (convenience for the CLI / sync callers). */
  async wait(taskId: string): Promise<ReportEnvelope> {
    const record = this.tasks.get(taskId);
    if (!record) return { taskId, status: "unknown", report: null, progress: [] };
    await record.done;
    return this.getReport(taskId);
  }

  /** `revise_design_change` — re-enter the loop with corrections. */
  async revise(revisionInput: unknown): Promise<StartResult> {
    const revision: RevisionSpec = revisionSpecSchema.parse(revisionInput);
    const prior = this.tasks.get(revision.taskId);
    if (!prior) throw new Error(`Unknown task ${revision.taskId}`);
    const revisedSpec = applyRevision(prior.spec, revision);
    this.launch(revisedSpec);
    return { taskId: revisedSpec.taskId, status: "running" };
  }

  private launch(spec: TaskSpec): TaskRecord {
    const record: TaskRecord = {
      spec,
      status: "running",
      report: null,
      progress: [],
      done: Promise.resolve(),
    };
    this.tasks.set(spec.taskId, record);

    record.done = (async () => {
      try {
        const providers = await this.makeProviders(this.config);
        const report = await runDesignAgent(spec, {
          providers,
          config: this.config,
          now: this.now,
          onProgress: (e) => record.progress.push(e),
        });
        record.report = report;
        record.status = report.status;
      } catch (err) {
        record.report = errorReport(spec, this.config, err);
        record.status = "blocked";
      }
    })();

    return record;
  }
}

function applyRevision(spec: TaskSpec, revision: RevisionSpec): TaskSpec {
  return {
    ...spec,
    intent: `${spec.intent}\n\n[REVISION] ${revision.feedback}\nFailed criteria: ${revision.failedCriteria.join("; ")}`,
    constraints: {
      ...spec.constraints,
      maxIterations: revision.adjust?.maxIterations ?? spec.constraints.maxIterations,
      tokenBudget: revision.adjust?.tokenBudget ?? spec.constraints.tokenBudget,
    },
  };
}

function errorReport(spec: TaskSpec, config: DesignLoopConfig, err: unknown): WorkReport {
  const message = err instanceof Error ? err.message : String(err);
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: spec.taskId,
    status: "blocked",
    summary: `Task failed: ${message}`,
    changes: { commits: [], touchedFiles: [], diffStat: { files: 0, insertions: 0, deletions: 0 } },
    loopHealth: { iterations: 0, maxIterations: spec.constraints.maxIterations, escalated: false, firstPassConformance: false },
    gates: {
      darkPattern: { passed: true, hits: [] },
      a11y: { passed: true, violations: [] },
      tokenFidelity: { passed: true, drift: [] },
    },
    unresolved: [{ subTask: spec.intent, reason: message, suggestedNext: "inspect runner logs / configuration" }],
    recommendations: [],
    subTasks: [],
    provenance: { skillsInvoked: [], patternsInvoked: [] },
    versionVector: config.versionVector,
  };
}
