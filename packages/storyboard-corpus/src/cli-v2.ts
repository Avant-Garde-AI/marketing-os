#!/usr/bin/env node

import { execFile as nodeExecFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { assessSnapshot, corpusSnapshotSchema } from "./acquire/manifest";
import { runV2Extraction, type V2Candidate } from "./analysis/run-v2";
import { createVertexV2Stages, type VertexV2Options } from "./analysis/vertex-v2";
import { type V2Stages } from "./analysis/v2";
import { parseArgs, type CliOptions } from "./cli";
import { JsonlLedger, type LedgerRow } from "./index";

const execFile = promisify(nodeExecFile);
const candidateSchema = z
  .object({
    snapshotRef: z.string().trim().min(1),
    snapshot: corpusSnapshotSchema,
    caption: z.string().optional(),
  })
  .strict();

export type V2CliResult = {
  mode: "dry-run" | "execute";
  selectedPosts: number;
  eligibleSnapshots: number;
  locallyAvailablePosts: number;
  rows?: LedgerRow[];
};

export type V2CliDependencies = {
  readManifest?: (path: string) => Promise<unknown>;
  mediaReady?: (localPath: string) => Promise<boolean>;
  accessToken?: () => Promise<string>;
  createStages?: (options: VertexV2Options) => V2Stages;
  run?: typeof runV2Extraction;
  print?: (line: string) => void;
};

async function defaultManifest(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("unable to read valid JSON snapshot manifest");
  }
}

async function defaultMediaReady(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function defaultAccessToken(): Promise<string> {
  try {
    const result = await execFile("gcloud", ["auth", "print-access-token"], { encoding: "utf8" });
    const token = String(result.stdout).trim();
    if (!token) throw new Error("empty token");
    return token;
  } catch {
    throw new Error("unable to acquire Google access token via gcloud");
  }
}

/** CLI facade over the durable v2 ledger; dry run makes no model or auth calls. */
export async function mainV2(
  args: string[] = process.argv.slice(2),
  dependencies: V2CliDependencies = {}
): Promise<V2CliResult> {
  const options: CliOptions = parseArgs(args);
  const raw = await (dependencies.readManifest ?? defaultManifest)(options.manifest);
  if (!Array.isArray(raw)) throw new Error("snapshot manifest must be a JSON array");
  const selected: V2Candidate[] = raw
    .slice(0, options.maxPosts)
    .map((row) => candidateSchema.parse(row));
  const assessments = selected.map((candidate) => assessSnapshot(candidate.snapshot));
  const mediaReady = dependencies.mediaReady ?? defaultMediaReady;
  const available = await Promise.all(
    selected.map(
      async (candidate, index) =>
        assessments[index]?.complete === true &&
        (
          await Promise.all(
            candidate.snapshot.media.actual.map((child) =>
              child.localPath ? mediaReady(child.localPath) : Promise.resolve(false)
            )
          )
        ).every(Boolean)
    )
  );
  const result: V2CliResult = {
    mode: options.execute ? "execute" : "dry-run",
    selectedPosts: selected.length,
    eligibleSnapshots: assessments.filter((assessment) => assessment.complete).length,
    locallyAvailablePosts: available.filter(Boolean).length,
  };
  const print = dependencies.print ?? console.log;
  print(
    `${result.mode}: ${result.selectedPosts} selected, ${result.eligibleSnapshots} source-complete, ${result.locallyAvailablePosts} locally available${options.execute ? "" : "; dry run does not verify checksums"}`
  );
  if (!options.execute) return result;
  const stages = (dependencies.createStages ?? createVertexV2Stages)({
    project: options.project,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
    accessToken: dependencies.accessToken ?? defaultAccessToken,
  });
  result.rows = await (dependencies.run ?? runV2Extraction)(selected, {
    runId: options.runId,
    ledger: new JsonlLedger(options.out),
    stages,
    maxPosts: options.maxPosts,
  });
  const counts = result.rows.reduce<Record<string, number>>((all, row) => {
    all[row.status] = (all[row.status] ?? 0) + 1;
    return all;
  }, {});
  print(
    `ledger: ${options.out}; rows: ${Object.entries(counts)
      .map(([status, count]) => `${status}=${count}`)
      .join(", ")}`
  );
  return result;
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked)
  mainV2().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
