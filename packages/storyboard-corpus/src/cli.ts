#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  JsonlLedger,
  LocalOrReferenceAcquisition,
  postSchema,
  runExtraction,
  type Extractor,
  type LedgerRow,
  type PostInput,
} from "./index";
import { createVertexExtractor, type VertexOptions } from "./vertex";

const execFile = promisify(nodeExecFile);

export interface CliOptions {
  manifest: string;
  out: string;
  runId: string;
  project: string;
  model: string;
  maxPosts: number;
  execute: boolean;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface CliResult {
  mode: "dry-run" | "execute";
  selectedPosts: number;
  selectedMedia: number;
  validPosts: number;
  readyPosts: number;
  readyMedia: number;
  rows?: LedgerRow[];
}

export interface CliDependencies {
  readManifest?: (path: string) => Promise<unknown>;
  mediaReady?: (media: PostInput["media"][number]) => Promise<boolean>;
  runExtraction?: typeof runExtraction;
  createExtractor?: (options: VertexOptions) => Extractor;
  accessToken?: () => Promise<string>;
  print?: (line: string) => void;
  error?: (line: string) => void;
}

function usage(message?: string): never {
  throw new Error(
    `${message ? `${message}\n` : ""}Usage: corpus-pilot --manifest PATH --out PATH --run-id ID --project PROJECT --model MODEL --max-posts N [--execute] [--max-output-tokens N] [--timeout-ms N]`
  );
}

function value(args: string[], index: number, flag: string): string {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) usage(`${flag} requires a value`);
  return next;
}

function positiveInteger(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) usage(`${flag} must be a positive safe integer`);
  return n;
}

function boundedInteger(raw: string, flag: string, min: number, max: number): number {
  const n = positiveInteger(raw, flag);
  if (n < min || n > max) usage(`${flag} must be ${min}–${max}`);
  return n;
}

export function parseArgs(args: string[]): CliOptions {
  const values: Partial<CliOptions> = { execute: false, maxOutputTokens: 4096, timeoutMs: 180000 };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--execute") {
      values.execute = true;
      continue;
    }
    if (
      ![
        "--manifest",
        "--out",
        "--run-id",
        "--project",
        "--model",
        "--max-posts",
        "--max-output-tokens",
        "--timeout-ms",
      ].includes(flag!)
    )
      usage(`unknown flag ${flag}`);
    const raw = value(args, i, flag!);
    i += 1;
    if (flag === "--manifest") values.manifest = raw;
    else if (flag === "--out") values.out = raw;
    else if (flag === "--run-id") values.runId = raw;
    else if (flag === "--project") values.project = raw;
    else if (flag === "--model") values.model = raw;
    else if (flag === "--max-posts") values.maxPosts = positiveInteger(raw, flag!);
    else if (flag === "--max-output-tokens")
      values.maxOutputTokens = boundedInteger(raw, flag!, 256, 8192);
    else values.timeoutMs = boundedInteger(raw, flag!, 1000, 180000);
  }
  for (const flag of ["manifest", "out", "runId", "project", "model", "maxPosts"] as const)
    if (!values[flag])
      usage(`--${flag.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} is required`);
  return values as CliOptions;
}

async function defaultManifest(path: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new Error("unable to read manifest");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("manifest must contain valid JSON");
  }
}

async function defaultMediaReady(media: PostInput["media"][number]): Promise<boolean> {
  if (!media.localPath) return false;
  try {
    const info = await stat(media.localPath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function defaultAccessToken(): Promise<string> {
  try {
    const result = await execFile("gcloud", ["auth", "print-access-token"], { encoding: "utf8" });
    const token = String(result.stdout).trim();
    if (!token) throw new Error("gcloud returned no access token");
    return token;
  } catch (error) {
    if (error instanceof Error && error.message.includes("gcloud returned no access token"))
      throw error;
    throw new Error("unable to acquire Google access token via gcloud auth print-access-token");
  }
}

export async function main(
  args: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {}
): Promise<CliResult> {
  const options = parseArgs(args);
  const manifest = await (dependencies.readManifest ?? defaultManifest)(options.manifest);
  if (!Array.isArray(manifest)) throw new Error("manifest must be a JSON array");
  const selected = manifest.slice(0, options.maxPosts);
  const mediaCount = selected.reduce(
    (n, post) =>
      n +
      (post && typeof post === "object" && Array.isArray((post as { media?: unknown }).media)
        ? (post as { media: unknown[] }).media.length
        : 0),
    0
  );
  const valid: PostInput[] = [];
  for (const raw of selected) {
    const parsed = postSchema.safeParse(raw);
    if (parsed.success) valid.push(parsed.data);
  }
  const readyCheck = dependencies.mediaReady ?? defaultMediaReady;
  const readiness = await Promise.all(
    valid.map(async (post) => ({ post, media: await Promise.all(post.media.map(readyCheck)) }))
  );
  const readyPosts = readiness.filter((x) => x.media.every(Boolean));
  const result: CliResult = {
    mode: options.execute ? "execute" : "dry-run",
    selectedPosts: selected.length,
    selectedMedia: mediaCount,
    validPosts: valid.length,
    readyPosts: readyPosts.length,
    readyMedia: readiness.reduce((n, x) => n + x.media.filter(Boolean).length, 0),
  };
  const print = dependencies.print ?? console.log;
  print(
    `${result.mode}: ${result.selectedPosts} posts, ${result.selectedMedia} media; ${result.validPosts} valid, ${result.readyPosts} ready (${result.readyMedia} media)`
  );
  if (!options.execute) return result;

  const extractor = (dependencies.createExtractor ?? createVertexExtractor)({
    project: options.project,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
    accessToken: dependencies.accessToken ?? defaultAccessToken,
  });
  const runner = dependencies.runExtraction ?? runExtraction;
  result.rows = await runner(selected, {
    runId: options.runId,
    ledger: new JsonlLedger(options.out),
    acquisition: new LocalOrReferenceAcquisition(),
    extractor,
    maxPosts: options.maxPosts,
    concurrency: 1,
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
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
