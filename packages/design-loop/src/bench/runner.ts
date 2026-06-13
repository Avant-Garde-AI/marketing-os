/**
 * Bench runner — executes the case suite and reports pass/fail. Used by the
 * Phase 0 exit gate and by the release gate (where a previously-passing case
 * re-failing must block unconditionally, PRD §7).
 */
import { DelegationService } from "../delegation/handlers.js";
import { createStubProviders } from "../providers/stub.js";
import { BENCH_CASES, type BenchCase } from "./cases.js";

export interface BenchCaseResult {
  name: string;
  passed: boolean;
  reason: string | null;
  status: string;
}

export interface BenchRunResult {
  passed: boolean;
  total: number;
  failures: number;
  results: BenchCaseResult[];
}

export async function runBench(cases: BenchCase[] = BENCH_CASES): Promise<BenchRunResult> {
  const results: BenchCaseResult[] = [];

  for (const c of cases) {
    const service = new DelegationService({
      now: () => "2026-06-13T00:00:00Z",
      buildProviders: async () => createStubProviders(c.scenario),
    });
    let reason: string | null;
    let status = "error";
    try {
      const { taskId } = await service.implement(c.task, { async: false });
      const { report } = service.getReport(taskId);
      if (!report) {
        reason = "no report produced";
      } else {
        status = report.status;
        reason = c.expect(report);
      }
    } catch (err) {
      reason = `threw: ${err instanceof Error ? err.message : String(err)}`;
    }
    results.push({ name: c.name, passed: reason === null, reason, status });
  }

  const failures = results.filter((r) => !r.passed).length;
  return { passed: failures === 0, total: results.length, failures, results };
}

/** Human-readable report for the CLI / release log. */
export function formatBench(run: BenchRunResult): string {
  const lines = run.results.map((r) => {
    const mark = r.passed ? "✓" : "✗";
    const tail = r.passed ? `(${r.status})` : `(${r.status}) — ${r.reason}`;
    return `  ${mark} ${r.name} ${tail}`;
  });
  lines.push("");
  lines.push(`  ${run.passed ? "PASS" : "FAIL"} — ${run.total - run.failures}/${run.total} cases passed`);
  return lines.join("\n");
}
