#!/usr/bin/env node
/**
 * CLI fallback for the Design Work Contract — for runners without MCP wiring.
 *
 *   design-code-agent run --task task.json [--report report.json] [--stub]
 *
 * Reads a TaskSpec, runs the deep agent to completion, prints/writes the
 * WorkReport. Same schemas as the MCP server.
 */
import { readFile, writeFile } from "node:fs/promises";
import { DelegationService } from "./handlers.js";
import { createStubProviders } from "../providers/stub.js";

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd !== "run") {
    process.stderr.write("usage: design-code-agent run --task <task.json> [--report <out.json>] [--stub]\n");
    return 2;
  }
  const args = parseFlags(argv.slice(1));
  const taskPath = args["task"];
  if (!taskPath) {
    process.stderr.write("error: --task <task.json> is required\n");
    return 2;
  }

  const specInput = JSON.parse(await readFile(taskPath, "utf-8"));
  const useStub = "stub" in args;
  const service = new DelegationService(
    useStub ? { buildProviders: async () => createStubProviders() } : {},
  );

  const { taskId } = await service.implement(specInput, { async: false });
  const envelope = service.getReport(taskId);
  const out = JSON.stringify(envelope.report, null, 2);

  if (args["report"]) {
    await writeFile(args["report"], out);
    process.stderr.write(`Wrote ${args["report"]} (status: ${envelope.status})\n`);
  } else {
    process.stdout.write(out + "\n");
  }
  return envelope.status === "completed" || envelope.status === "escalated" ? 0 : 1;
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
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
