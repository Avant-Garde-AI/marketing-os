#!/usr/bin/env node
/**
 * Bench CLI — `design-loop-bench`. Runs the smoke suite and exits non-zero on
 * any failure, so it can gate CI / releases (PRD §4.6, §7).
 */
import { formatBench, runBench } from "./runner.js";

runBench()
  .then((run) => {
    process.stdout.write(`\nMarketing OS — design-loop bench (smoke tier)\n${formatBench(run)}\n`);
    process.exit(run.passed ? 0 : 1);
  })
  .catch((err) => {
    process.stderr.write(`bench failed to run: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
