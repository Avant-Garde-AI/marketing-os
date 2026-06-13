import { describe, expect, it } from "vitest";
import { runBench } from "../src/bench/runner.js";
import { BENCH_CASES } from "../src/bench/cases.js";

describe("bench (smoke tier — Phase 0 exit gate)", () => {
  it("passes every case", async () => {
    const run = await runBench();
    const failed = run.results.filter((r) => !r.passed);
    expect(failed, failed.map((f) => `${f.name}: ${f.reason}`).join("\n")).toEqual([]);
    expect(run.passed).toBe(true);
    expect(run.total).toBe(BENCH_CASES.length);
  });
});
