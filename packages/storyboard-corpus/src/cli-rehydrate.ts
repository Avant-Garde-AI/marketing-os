#!/usr/bin/env node

import { execFile as nodeExecFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { rehydrateCandidates, type RehydratedCandidate } from "./acquire/rehydrate";

const execFile = promisify(nodeExecFile);
const gcsPrefix = /^gs:\/\/[a-z0-9][a-z0-9._-]{1,61}[a-z0-9](?:\/[A-Za-z0-9._-]+)+$/;
const shortcode = /^[A-Za-z0-9_-]{1,64}$/;

export type RehydrateCliOptions = {
  prefix: string;
  shortcodes: string[];
  cacheDir: string;
  out: string;
  maxBytes: number;
  execute: boolean;
};

function value(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1]!.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return args[index + 1]!;
}

export function parseRehydrateArgs(args: string[]): RehydrateCliOptions {
  const allowed = new Set(["--prefix", "--shortcodes", "--cache-dir", "--out", "--max-bytes", "--execute"]);
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i]!)) throw new Error(`unknown rehydration option: ${args[i]}`);
    if (seen.has(args[i]!)) throw new Error(`duplicate rehydration option: ${args[i]}`);
    seen.add(args[i]!);
    if (args[i] !== "--execute") i++;
  }
  const prefix = value(args, "--prefix").replace(/\/+$/, "");
  const shortcodes = value(args, "--shortcodes").split(",");
  const maxBytes = Number(value(args, "--max-bytes"));
  if (!gcsPrefix.test(prefix) || prefix.split("/").some((part) => part === "." || part === ".."))
    throw new Error("--prefix must be a private GCS object prefix");
  if (shortcodes.length < 1 || shortcodes.length > 3 || shortcodes.some((item) => !shortcode.test(item)) || new Set(shortcodes).size !== shortcodes.length)
    throw new Error("--shortcodes must contain 1–3 unique post shortcodes");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1024 * 1024)
    throw new Error("--max-bytes must be between 1 and 536870912");
  const cacheDir = resolve(value(args, "--cache-dir"));
  const out = resolve(value(args, "--out"));
  if (out === cacheDir || out.startsWith(`${cacheDir}/storyboard-rehydration/media/`))
    throw new Error("--out may not overwrite cached media");
  return { prefix, shortcodes, cacheDir, out, maxBytes, execute: args.includes("--execute") };
}

export type RehydrateCliDependencies = {
  readCandidate?: (objectRef: string) => Promise<unknown>;
  rehydrate?: typeof rehydrateCandidates;
  print?: (line: string) => void;
};

async function readCandidate(objectRef: string): Promise<unknown> {
  const { stdout } = await execFile("gcloud", ["storage", "cat", objectRef], {
    encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** Reconstructs a local v2 manifest from private stored candidates, without a provider or model call. */
export async function mainRehydrate(
  args: string[] = process.argv.slice(2),
  dependencies: RehydrateCliDependencies = {}
): Promise<{ mode: "dry-run" | "execute"; selected: number; ready: number; out?: string }> {
  const options = parseRehydrateArgs(args);
  const print = dependencies.print ?? console.log;
  const mode = options.execute ? "execute" : "dry-run";
  print(`${mode}: ${options.shortcodes.length} stored candidates; local media ceiling ${options.maxBytes} bytes`);
  if (!options.execute) return { mode, selected: options.shortcodes.length, ready: 0 };

  const candidates: unknown[] = [];
  for (const code of options.shortcodes) {
    const objectRef = `${options.prefix}/posts/${code}/candidate.json`;
    const candidate = await (dependencies.readCandidate ?? readCandidate)(objectRef);
    if (!candidate || typeof candidate !== "object" || (candidate as { snapshotRef?: unknown }).snapshotRef !== `${options.prefix}/posts/${code}/snapshot.json`)
      throw new Error(`Stored candidate identity mismatch for ${code}`);
    candidates.push(candidate);
  }
  const hydrated: RehydratedCandidate[] = await (dependencies.rehydrate ?? rehydrateCandidates)(candidates, {
    localCacheDir: options.cacheDir, maxPosts: options.shortcodes.length, maxBytes: options.maxBytes,
  });
  await mkdir(dirname(options.out), { recursive: true, mode: 0o700 });
  const tempDir = await mkdtemp(join(dirname(options.out), ".storyboard-manifest-"));
  try {
    await chmod(tempDir, 0o700);
    const temp = join(tempDir, "manifest.json");
    await writeFile(temp, JSON.stringify(hydrated, null, 2) + "\n", { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, options.out);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  print(`local v2 manifest: ${options.out}; ready=${hydrated.length}`);
  return { mode, selected: options.shortcodes.length, ready: hydrated.length, out: options.out };
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked)
  mainRehydrate().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
