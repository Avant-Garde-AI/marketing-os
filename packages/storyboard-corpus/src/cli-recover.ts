#!/usr/bin/env node

import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { createApifyRecoveryProvider } from "./acquire/apify";
import { createGcsWriters } from "./acquire/gcs-writer";
import { createInstagramMediaMirror } from "./acquire/media-mirror";
import { recoverCarousel, type RecoverySource } from "./acquire/recover";

const execFile = promisify(nodeExecFile);
const sourceSchema = z.object({
  shortcode: z.string().regex(/^[A-Za-z0-9_-]+$/),
  accountHandle: z.string().min(1),
  postUrl: z.string().url(),
  expectedChildren: z.number().int().min(2).max(20),
  metadataCapturedAt: z.string().datetime(),
  publishedAt: z.string().datetime().optional(),
  likes: z.number().int().nonnegative().nullable().optional(),
  comments: z.number().int().nonnegative().nullable().optional(),
});

export type RecoveryCliOptions = {
  source: string;
  prefix: string;
  cacheDir: string;
  out: string;
  startIndex: number;
  maxPosts: number;
  maxChargeUsd: number;
  execute: boolean;
};

function value(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1]!.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return args[index + 1]!;
}

function number(args: string[], name: string): number {
  const parsed = Number(value(args, name));
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}

export function parseRecoveryArgs(args: string[]): RecoveryCliOptions {
  const allowed = new Set([
    "--source",
    "--prefix",
    "--cache-dir",
    "--out",
    "--start-index",
    "--max-posts",
    "--max-charge-usd",
    "--execute",
  ]);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i]!)) throw new Error(`unknown recovery option: ${args[i]}`);
    if (args[i] !== "--execute") i++;
  }
  const options = {
    source: value(args, "--source"),
    prefix: value(args, "--prefix"),
    cacheDir: value(args, "--cache-dir"),
    out: value(args, "--out"),
    startIndex: number(args, "--start-index"),
    maxPosts: number(args, "--max-posts"),
    maxChargeUsd: number(args, "--max-charge-usd"),
    execute: args.includes("--execute"),
  };
  if (!Number.isSafeInteger(options.startIndex) || options.startIndex < 0)
    throw new Error("--start-index must be a nonnegative integer");
  if (!Number.isSafeInteger(options.maxPosts) || options.maxPosts < 1 || options.maxPosts > 3)
    throw new Error("--max-posts must be between 1 and 3");
  if (options.maxChargeUsd <= 0 || options.maxChargeUsd > 1)
    throw new Error("--max-charge-usd must be above 0 and at most 1 per post");
  return options;
}

export type RecoveryCliDependencies = {
  readSources?: (path: string) => Promise<unknown>;
  token?: () => string | undefined;
  print?: (message: string) => void;
};

async function readSources(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Bounded acquisition of frozen sources; only --execute calls a paid provider or writes GCS. */
export async function mainRecover(
  args: string[] = process.argv.slice(2),
  dependencies: RecoveryCliDependencies = {}
): Promise<{
  selected: number;
  ready: number;
  incomplete: number;
  expired: number;
  excluded: number;
  failed: number;
}> {
  const options = parseRecoveryArgs(args);
  const inventory = await (dependencies.readSources ?? readSources)(options.source);
  if (!Array.isArray(inventory)) throw new Error("recovery source must be a JSON array");
  const selected = inventory
    .slice(options.startIndex, options.startIndex + options.maxPosts)
    .map((source) => sourceSchema.parse(source) as RecoverySource);
  if (selected.length === 0) throw new Error("selected source slice is empty");
  if (new Set(selected.map((source) => source.shortcode)).size !== selected.length)
    throw new Error("selected source shortcodes are duplicated");
  const print = dependencies.print ?? console.log;
  print(
    `${options.execute ? "execute" : "dry-run"}: ${selected.length} frozen carousel sources, ${selected.reduce((sum, source) => sum + source.expectedChildren, 0)} expected children, charge ceiling $${(options.maxChargeUsd * selected.length).toFixed(2)}`
  );
  if (!options.execute)
    return {
      selected: selected.length,
      ready: 0,
      incomplete: 0,
      expired: 0,
      excluded: 0,
      failed: 0,
    };

  const token = (dependencies.token ?? (() => process.env.APIFY_API_TOKEN))();
  if (!token?.trim()) throw new Error("APIFY_API_TOKEN is required for --execute");
  const writers = createGcsWriters({ prefix: options.prefix, localCacheDir: options.cacheDir });
  const provider = createApifyRecoveryProvider({
    token,
    maxItems: 1,
    maxTotalChargeUsd: options.maxChargeUsd,
    writeRawResponse: writers.writeRawResponse,
  });
  const mirror = createInstagramMediaMirror({
    writeBytes: writers.writeBytes,
    maxBytes: 32 * 1024 * 1024,
  });
  const candidates: Array<{
    snapshotRef: string;
    snapshot: Awaited<ReturnType<typeof recoverCarousel>>["snapshot"];
    caption?: string;
  }> = [];
  const counts = {
    selected: selected.length,
    ready: 0,
    incomplete: 0,
    expired: 0,
    excluded: 0,
    failed: 0,
  };
  for (const source of selected) {
    const result = await recoverCarousel(source, provider, mirror);
    const snapshotRef = `${options.prefix.replace(/\/+$/, "")}/posts/${source.shortcode}/snapshot.json`;
    const snapshot = result.snapshot;
    const durableSnapshot = structuredClone(snapshot);
    for (const child of durableSnapshot.media.actual) delete child.localPath;
    const localSnapshotPath = `${options.cacheDir}/snapshots/${source.shortcode}.json`;
    await mkdir(dirname(localSnapshotPath), { recursive: true, mode: 0o700 });
    await writeFile(localSnapshotPath, JSON.stringify(durableSnapshot, null, 2) + "\n", {
      mode: 0o600,
    });
    await execFile("gcloud", ["storage", "cp", localSnapshotPath, snapshotRef], {
      timeout: 120_000,
    });
    const durableCandidatePath = `${options.cacheDir}/snapshots/${source.shortcode}-candidate.json`;
    await writeFile(
      durableCandidatePath,
      JSON.stringify({ snapshotRef, snapshot: durableSnapshot, caption: result.caption }, null, 2) +
        "\n",
      { mode: 0o600 }
    );
    await execFile(
      "gcloud",
      [
        "storage",
        "cp",
        durableCandidatePath,
        `${options.prefix.replace(/\/+$/, "")}/posts/${source.shortcode}/candidate.json`,
      ],
      { timeout: 120_000 }
    );
    candidates.push({ snapshotRef, snapshot, caption: result.caption });
    counts[result.assessment.status]++;
    print(
      `${source.shortcode}: ${result.assessment.status}, ${snapshot.coverage.acquiredCount}/${snapshot.coverage.expectedCount} children`
    );
  }
  await mkdir(dirname(options.out), { recursive: true, mode: 0o700 });
  await writeFile(options.out, JSON.stringify(candidates, null, 2) + "\n", { mode: 0o600 });
  print(`local v2 manifest: ${options.out}`);
  return counts;
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked)
  mainRecover().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
