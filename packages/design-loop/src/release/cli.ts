#!/usr/bin/env node
/**
 * Release-gate CLI — `design-loop-release-gate`. Runs the bench gate, writes a
 * bench report, exits non-zero on a block. On pass with --update-baseline it
 * records the new baseline (PRD §7). Used by the release workflow.
 *
 *   design-loop-release-gate --version 0.2.0 --baseline release/baseline.json \
 *     --report release/bench-report.md --update-baseline
 */
import { runReleaseGate, baselineFrom } from "./gate.js";
import { readBaseline, writeBaseline } from "./baseline.js";
import { writeFile } from "node:fs/promises";

async function main(argv: string[]): Promise<number> {
  const args = parseFlags(argv);
  const version = args["version"] ?? "0.0.0";
  const baseline = args["baseline"] ? await readBaseline(args["baseline"]) : null;

  const gate = await runReleaseGate({ baseline: baseline ?? undefined, version });
  process.stdout.write(gate.report + "\n");
  if (args["report"]) await writeFile(args["report"], gate.report + "\n");

  if (!gate.pass) {
    process.stderr.write(`\nRelease BLOCKED: ${gate.reason}\n`);
    return 1;
  }
  if ("update-baseline" in args && args["baseline"]) {
    await writeBaseline(args["baseline"], baselineFrom(version, gate.bench));
    process.stderr.write(`Baseline updated → ${args["baseline"]} (${version})\n`);
  }
  return 0;
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`release gate failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
