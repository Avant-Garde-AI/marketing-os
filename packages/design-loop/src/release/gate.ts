/**
 * Bench-gated release gate (PRD §7).
 *
 * Gate policy:
 *   - previously-fixed cases re-failing → block UNCONDITIONALLY (regression)
 *   - any a11y case failing → block UNCONDITIONALLY (zero-tolerance)
 *   - other new failures → blocked once over the allowed threshold (default 0)
 *
 * The full bench tier is supplied by the knowledge plane later; this gates on
 * the local smoke tier today. `evaluateGate` is pure so the policy is testable
 * against synthetic bench results.
 */
import { runBench, type BenchRunResult } from "../bench/runner.js";
import type { BenchCase } from "../bench/cases.js";

export interface GatePolicy {
  /** Non-regression, non-a11y failures tolerated. Default 0 (all-green). */
  maxAllowedFailures?: number;
  /** Block on any a11y case failing. Default true. */
  a11yZeroTolerance?: boolean;
}

export interface GateBaseline {
  version: string;
  /** Case names that passed in the last released version. */
  passedCases: string[];
}

export interface GateEvaluation {
  pass: boolean;
  failing: string[];
  /** Cases that passed in the baseline but fail now — unconditional block. */
  regressions: string[];
  /** Failing a11y cases — unconditional block. */
  a11yFailures: string[];
  /** Failures not present in the baseline (and not a11y). */
  newFailures: string[];
  reason: string;
}

const A11Y_RE = /a11y|accessib/i;

export function evaluateGate(
  bench: BenchRunResult,
  baseline?: GateBaseline,
  policy: GatePolicy = {},
): GateEvaluation {
  const a11yZero = policy.a11yZeroTolerance ?? true;
  const maxAllowed = policy.maxAllowedFailures ?? 0;

  const failing = bench.results.filter((r) => !r.passed).map((r) => r.name);
  const baselinePassed = new Set(baseline?.passedCases ?? []);

  const regressions = failing.filter((n) => baselinePassed.has(n));
  const a11yFailures = a11yZero ? failing.filter((n) => A11Y_RE.test(n)) : [];
  const newFailures = failing.filter((n) => !baselinePassed.has(n) && !A11Y_RE.test(n));

  const blockedUnconditionally = regressions.length > 0 || a11yFailures.length > 0;
  const overThreshold = failing.length > maxAllowed;
  const pass = !blockedUnconditionally && !overThreshold;

  const reason = pass
    ? `All ${bench.total} cases within policy.`
    : [
        regressions.length ? `${regressions.length} regression(s): ${regressions.join(", ")}` : "",
        a11yFailures.length ? `${a11yFailures.length} a11y failure(s): ${a11yFailures.join(", ")}` : "",
        overThreshold ? `${failing.length} failure(s) over threshold ${maxAllowed}` : "",
      ]
        .filter(Boolean)
        .join("; ");

  return { pass, failing, regressions, a11yFailures, newFailures, reason };
}

export interface GateResult extends GateEvaluation {
  bench: BenchRunResult;
  report: string;
}

export async function runReleaseGate(input: {
  baseline?: GateBaseline;
  policy?: GatePolicy;
  version?: string;
  cases?: BenchCase[];
}): Promise<GateResult> {
  const bench = await runBench(input.cases);
  const evaluation = evaluateGate(bench, input.baseline, input.policy);
  const report = formatGateReport({ ...evaluation, bench, report: "" }, input.baseline, input.version);
  return { ...evaluation, bench, report };
}

/** A passing release's case list becomes the next baseline. */
export function baselineFrom(version: string, bench: BenchRunResult): GateBaseline {
  return { version, passedCases: bench.results.filter((r) => r.passed).map((r) => r.name) };
}

export function formatGateReport(gate: GateResult, baseline?: GateBaseline, version?: string): string {
  const lines: string[] = [];
  lines.push(`# Release gate — ${version ?? "(unversioned)"}`);
  lines.push("");
  lines.push(`**${gate.pass ? "PASS" : "BLOCK"}** — ${gate.reason}`);
  if (baseline) lines.push(`Baseline: ${baseline.version}`);
  lines.push("");
  lines.push("## Bench (smoke tier)");
  for (const r of gate.bench.results) {
    lines.push(`- ${r.passed ? "✓" : "✗"} ${r.name} (${r.status})${r.passed ? "" : ` — ${r.reason ?? ""}`}`);
  }
  if (gate.regressions.length) lines.push("", `## Regressions (unconditional block)`, ...gate.regressions.map((r) => `- ${r}`));
  if (gate.a11yFailures.length) lines.push("", `## a11y failures (zero-tolerance)`, ...gate.a11yFailures.map((r) => `- ${r}`));
  if (baseline) {
    const nowPassing = new Set(gate.bench.results.filter((r) => r.passed).map((r) => r.name));
    const newlyFixed = baseline.passedCases.filter((n) => !nowPassing.has(n)).length === 0;
    lines.push("", `_Previously-fixed cases preserved: ${newlyFixed ? "yes" : "NO"}_`);
  }
  return lines.join("\n");
}
