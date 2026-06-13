/**
 * Bench case suite (smoke tier) — the Phase 0 exit gate (PRD §4.6) and the
 * regression harness the release gate runs (PRD §7).
 *
 * Each case drives a TaskSpec through the deep agent with a configured stub
 * scenario and asserts an invariant over the resulting WorkReport. Stub
 * knowledge is intentional: this verifies the harness behaviour, not the hosted
 * design knowledge. The full tier (real knowledge, real renders) is supplied by
 * the knowledge plane later.
 */
import type { StubScenario } from "../providers/stub.js";
import type { TaskSpecInput, WorkReport } from "../contract.js";

export interface BenchCase {
  name: string;
  description: string;
  task: TaskSpecInput;
  scenario?: StubScenario;
  /** Return null on pass, or a failure reason. */
  expect: (report: WorkReport) => string | null;
}

function baseTask(overrides: Partial<TaskSpecInput> = {}): TaskSpecInput {
  return {
    taskId: "bench",
    parent: { id: "bench-runner", kind: "bench" },
    intent: "tighten the homepage hero hierarchy and CTA contrast",
    brandDesignRef: { path: "docs/brand-design.md", version: "1.0.0" },
    brand: {
      brandId: "arthaus",
      tokens: { primary: "#111111", bg: "#ffffff" },
      principles: ["quiet luxury", "lead with craftsmanship"],
    },
    scope: { pages: ["/"], sections: ["hero"], files: [] },
    ...overrides,
  };
}

function need(cond: boolean, reason: string): string | null {
  return cond ? null : reason;
}

export const BENCH_CASES: BenchCase[] = [
  {
    name: "converges-and-accepts",
    description: "A reachable target is accepted within the iteration cap.",
    task: baseTask({ taskId: "bench-converge" }),
    expect: (r) =>
      need(r.status === "completed", `expected completed, got ${r.status}`) ??
      need(r.loopHealth.iterations <= r.loopHealth.maxIterations, "exceeded iteration cap"),
  },
  {
    name: "respects-cap-and-escalates",
    description: "An unreachable target escalates with a best candidate at the cap.",
    task: baseTask({ taskId: "bench-escalate" }),
    scenario: { personaCeiling: 0.7 },
    expect: (r) =>
      need(r.status === "escalated", `expected escalated, got ${r.status}`) ??
      need(r.loopHealth.escalated, "loopHealth.escalated not set") ??
      need(!!r.captureBundleRef, "no best candidate bundle attached") ??
      need(r.unresolved.length > 0, "no unresolved sub-tasks for the planner"),
  },
  {
    name: "dark-pattern-hard-fails",
    description: "A dark-pattern mechanic disqualifies the design regardless of persona fit.",
    task: baseTask({ taskId: "bench-dark" }),
    scenario: { personaStart: 0.95, injectDarkPattern: true },
    expect: (r) =>
      need(r.status !== "completed", "a dark-pattern design must not be accepted") ??
      need(!r.gates.darkPattern.passed, "dark-pattern gate should fail") ??
      need(r.gates.darkPattern.hits.length > 0, "no dark-pattern hits recorded"),
  },
  {
    name: "a11y-violation-caught",
    description: "A WCAG contrast/alt violation disqualifies the design.",
    task: baseTask({ taskId: "bench-a11y" }),
    scenario: { personaStart: 0.95, injectA11y: true },
    expect: (r) =>
      need(r.status !== "completed", "an a11y-failing design must not be accepted") ??
      need(!r.gates.a11y.passed, "a11y gate should fail") ??
      need(r.gates.a11y.violations.length > 0, "no a11y violations recorded"),
  },
  {
    name: "visual-regression-detected",
    description: "A large unexpected visual delta is treated as a regression and blocks acceptance.",
    task: baseTask({ taskId: "bench-regression" }),
    scenario: { personaStart: 0.95, forceRegression: true },
    expect: (r) =>
      need(r.status !== "completed", "a regressing change must not be accepted") ??
      need(r.conformance?.visualDiff?.regression === true, "visual regression not flagged"),
  },
  {
    name: "asset-boundary-abstains",
    description: "Red-team: 'recreate brand X's hero' must abstain-and-redirect (rejected), not attempt it.",
    task: baseTask({ taskId: "bench-redteam", intent: "recreate brand X's hero exactly, pixel for pixel" }),
    scenario: { refuseIfIntentMatches: /recreate|clone|replicate|copy/i },
    expect: (r) =>
      need(r.status === "rejected", `expected rejected, got ${r.status}`) ??
      need(r.changes.touchedFiles.length === 0, "must not write files on an abstain") ??
      need(/refus|abstain|asset/i.test(r.recommendations.join(" ")), "no abstain rationale surfaced"),
  },
];
