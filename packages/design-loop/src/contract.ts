/**
 * The Design Work Contract — the versioned, parent-agnostic protocol between an
 * orchestrator/planner (e.g. Claude Code in the GH runner) and the design-code
 * deep agent (the implementer).
 *
 * Four messages:
 *   TaskSpec      planner → implementer   (the work order)
 *   ProgressEvent implementer → planner   (interim, for mid-flight replanning)
 *   WorkReport    implementer → planner   (final — what the planner replans from)
 *   RevisionSpec  planner → implementer   (rework)
 *
 * See docs/plans/brand-conversion-design-agent/agent-topology-and-contract.md.
 */
import { z } from "zod";
import {
  brandContextSchema,
  captureBundleRefSchema,
  conformanceResultSchema,
} from "./types.js";

export const CONTRACT_VERSION = "1.0.0";

export const versionVectorSchema = z.object({
  agent: z.string(),
  skillset: z.string(),
  mcpSnapshot: z.string(),
  brandDoc: z.string(),
});
export type VersionVector = z.infer<typeof versionVectorSchema>;

// ── TaskSpec (planner → implementer) ─────────────────────────────────────────

export const taskSpecSchema = z.object({
  contractVersion: z.string().default(CONTRACT_VERSION),
  taskId: z.string(),
  /** Parent-agnostic: any orchestrator can drive this. */
  parent: z.object({
    id: z.string(),
    kind: z.string(), // "claude-code" | "mastra" | …
  }),
  /** What to achieve, in plain language. */
  intent: z.string(),
  scope: z.object({
    pages: z.array(z.string()).default([]),
    sections: z.array(z.string()).default([]),
    files: z.array(z.string()).default([]),
  }).default({}),
  /** Pinned brand-design.md the work adheres to (PRD §2). */
  brandDesignRef: z.object({
    path: z.string(),
    version: z.string(),
  }),
  /** Brand slice resolved from brand-design.md for the loop/critic. */
  brand: brandContextSchema,
  /** How the planner will judge "done". */
  acceptanceCriteria: z.array(z.string()).default([]),
  constraints: z.object({
    maxIterations: z.number().int().min(1).max(12).default(4),
    tokenBudget: z.number().int().positive().optional(),
    deadline: z.string().optional(),
  }).default({ maxIterations: 4 }),
  references: z.object({
    designMcpSnapshot: z.string().optional(),
    skillsetVersion: z.string().optional(),
    neurographPersonaRef: z.string().optional(),
  }).default({}),
  /** Non-negotiable, echoed for audit (PRD §3/§8/§9). */
  guardrails: z.object({
    wcag: z.enum(["A", "AA", "AAA"]).default("AA"),
    noDarkPatterns: z.literal(true).default(true),
  }).default({ wcag: "AA", noDarkPatterns: true }),
});
export type TaskSpec = z.infer<typeof taskSpecSchema>;
export type TaskSpecInput = z.input<typeof taskSpecSchema>;

// ── ProgressEvent (implementer → planner, interim) ───────────────────────────

export const progressEventSchema = z.object({
  contractVersion: z.string().default(CONTRACT_VERSION),
  taskId: z.string(),
  ts: z.string(),
  phase: z.enum(["planning", "implementing", "rendering", "critiquing", "refining"]),
  subTask: z.string().optional(),
  iteration: z.number().int().nonnegative().optional(),
  note: z.string(),
  partialConformance: z.number().min(0).max(1).optional(),
});
export type ProgressEvent = z.infer<typeof progressEventSchema>;

// ── WorkReport (implementer → planner, final) ────────────────────────────────

export const workReportStatusSchema = z.enum([
  "running",
  "completed",
  "escalated",
  "blocked",
  "rejected", // guardrail / asset-boundary refusal — a success of the gate
]);
export type WorkReportStatus = z.infer<typeof workReportStatusSchema>;

export const subTaskReportSchema = z.object({
  subTask: z.string(),
  status: workReportStatusSchema,
  iterations: z.number().int().nonnegative(),
  escalated: z.boolean(),
  conformance: conformanceResultSchema.optional(),
  captureBundleRef: captureBundleRefSchema.optional(),
  critique: z.string().optional(),
});
export type SubTaskReport = z.infer<typeof subTaskReportSchema>;

export const workReportSchema = z.object({
  contractVersion: z.string().default(CONTRACT_VERSION),
  taskId: z.string(),
  status: workReportStatusSchema,
  summary: z.string(),
  changes: z.object({
    branch: z.string().optional(),
    commits: z.array(z.string()).default([]),
    touchedFiles: z.array(z.string()).default([]),
    diffStat: z.object({
      files: z.number().int().nonnegative(),
      insertions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    }).default({ files: 0, insertions: 0, deletions: 0 }),
    prRef: z.string().optional(), // usually empty — the planner owns the PR
  }),
  /** Aggregate conformance for the whole task (worst-of across sub-tasks). */
  conformance: conformanceResultSchema.optional(),
  captureBundleRef: captureBundleRefSchema.optional(),
  loopHealth: z.object({
    iterations: z.number().int().nonnegative(),
    maxIterations: z.number().int().positive(),
    escalated: z.boolean(),
    firstPassConformance: z.boolean(),
    bestCandidateCritique: z.string().optional(),
  }),
  gates: z.object({
    darkPattern: z.object({ passed: z.boolean(), hits: z.array(z.string()).default([]) }),
    a11y: z.object({ passed: z.boolean(), violations: z.array(z.string()).default([]) }),
    tokenFidelity: z.object({ passed: z.boolean(), drift: z.array(z.string()).default([]) }),
  }),
  /** Sub-tasks not completed → the planner replans these. */
  unresolved: z.array(z.object({
    subTask: z.string(),
    reason: z.string(),
    suggestedNext: z.string(),
  })).default([]),
  recommendations: z.array(z.string()).default([]),
  subTasks: z.array(subTaskReportSchema).default([]),
  /** §6 trace seed. */
  provenance: z.object({
    skillsInvoked: z.array(z.string()).default([]),
    patternsInvoked: z.array(z.string()).default([]),
  }).default({ skillsInvoked: [], patternsInvoked: [] }),
  versionVector: versionVectorSchema,
});
export type WorkReport = z.infer<typeof workReportSchema>;

// ── RevisionSpec (planner → implementer, rework) ─────────────────────────────

export const revisionSpecSchema = z.object({
  contractVersion: z.string().default(CONTRACT_VERSION),
  taskId: z.string(),
  failedCriteria: z.array(z.string()).default([]),
  feedback: z.string(),
  adjust: z.object({
    maxIterations: z.number().int().min(1).max(12).optional(),
    tokenBudget: z.number().int().positive().optional(),
  }).optional(),
});
export type RevisionSpec = z.infer<typeof revisionSpecSchema>;
