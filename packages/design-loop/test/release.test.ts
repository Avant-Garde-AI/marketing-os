import { describe, expect, it } from "vitest";
import { evaluateGate, runReleaseGate, baselineFrom, type GateBaseline } from "../src/release/gate.js";
import type { BenchRunResult } from "../src/bench/runner.js";

function bench(results: { name: string; passed: boolean }[]): BenchRunResult {
  const full = results.map((r) => ({ name: r.name, passed: r.passed, reason: r.passed ? null : "boom", status: "x" }));
  const failures = full.filter((r) => !r.passed).length;
  return { passed: failures === 0, total: full.length, failures, results: full };
}

describe("release gate policy", () => {
  it("passes when the bench is all green", () => {
    const g = evaluateGate(bench([{ name: "converge", passed: true }, { name: "a11y-violation-caught", passed: true }]));
    expect(g.pass).toBe(true);
  });

  it("blocks unconditionally on a previously-fixed case re-failing", () => {
    const baseline: GateBaseline = { version: "0.1.0", passedCases: ["converge", "dark-pattern-hard-fails"] };
    const g = evaluateGate(bench([{ name: "converge", passed: true }, { name: "dark-pattern-hard-fails", passed: false }]), baseline);
    expect(g.pass).toBe(false);
    expect(g.regressions).toContain("dark-pattern-hard-fails");
  });

  it("blocks unconditionally on an a11y failure (zero-tolerance)", () => {
    const g = evaluateGate(bench([{ name: "converge", passed: true }, { name: "a11y-violation-caught", passed: false }]));
    expect(g.pass).toBe(false);
    expect(g.a11yFailures).toContain("a11y-violation-caught");
  });

  it("blocks on a new failure over the default zero threshold", () => {
    const g = evaluateGate(bench([{ name: "converge", passed: false }]));
    expect(g.pass).toBe(false);
    expect(g.newFailures).toContain("converge");
  });

  it("tolerates a new non-a11y failure under an explicit threshold", () => {
    const g = evaluateGate(bench([{ name: "converge", passed: true }, { name: "flaky-new", passed: false }]), undefined, {
      maxAllowedFailures: 1,
    });
    expect(g.pass).toBe(true);
  });

  it("still blocks a regression even under a raised threshold", () => {
    const baseline: GateBaseline = { version: "0.1.0", passedCases: ["converge"] };
    const g = evaluateGate(bench([{ name: "converge", passed: false }]), baseline, { maxAllowedFailures: 5 });
    expect(g.pass).toBe(false);
    expect(g.regressions).toContain("converge");
  });
});

describe("runReleaseGate (live smoke tier)", () => {
  it("passes the real bench and produces a report + baseline", async () => {
    const gate = await runReleaseGate({ version: "0.1.0" });
    expect(gate.pass).toBe(true);
    expect(gate.bench.passed).toBe(true);
    expect(gate.report).toMatch(/Release gate/);
    const base = baselineFrom("0.1.0", gate.bench);
    expect(base.passedCases.length).toBe(gate.bench.total);
  });

  it("flags a regression against a baseline that claims a now-failing case", async () => {
    // Baseline claims a case that does not exist in the current suite -> not a
    // regression (can't regress a case we no longer run); real run stays green.
    const gate = await runReleaseGate({ version: "0.2.0", baseline: { version: "0.1.0", passedCases: ["ghost-case"] } });
    expect(gate.pass).toBe(true);
    expect(gate.regressions).toEqual([]);
  });
});
