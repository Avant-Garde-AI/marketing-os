import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { assessSnapshot, corpusSnapshotSchema, type CorpusSnapshot } from "./manifest";

type ExecFile = (command: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<unknown>;
const runExecFile = promisify(nodeExecFile) as unknown as ExecFile;
const candidateSchema = z.object({ snapshotRef: z.string().trim().min(1), snapshot: z.unknown(), caption: z.string().optional() }).strict();
const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "avif"]);

export type RehydratedCandidate = { snapshotRef: string; snapshot: CorpusSnapshot; caption?: string };
export type RehydrateOptions = {
  /** Private caller-owned cache directory. */
  localCacheDir: string;
  /** Required run limits. */
  maxPosts: number;
  maxBytes: number;
  /** Injectable for offline tests; production defaults to `gcloud storage cp`. */
  execFile?: ExecFile;
  timeoutMs?: number;
};

function parseSnapshotRef(ref: string): { bucket: string; prefix: string } {
  const match = /^gs:\/\/([a-z0-9][a-z0-9._-]{1,61}[a-z0-9])\/(.+)\/posts\/([A-Za-z0-9_-]{1,64})\/snapshot\.json$/.exec(ref);
  if (!match || match[2]!.split("/").some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === "." || part === ".."))
    throw new Error("Candidate snapshot reference is outside an allowed GCS posts path");
  return { bucket: match[1]!, prefix: match[2]! };
}

function mediaObjectPath(ref: string, bucket: string, prefix: string, checksum: string): string {
  const match = /^gs:\/\/([a-z0-9][a-z0-9._-]{1,61}[a-z0-9])\/(.+)$/.exec(ref);
  if (!match || match[1] !== bucket) throw new Error("Media reference escapes candidate bucket");
  const objectPath = match[2]!;
  const objectPrefix = `${prefix}/media/`;
  const filename = objectPath.startsWith(objectPrefix) ? objectPath.slice(objectPrefix.length) : "";
  const objectMatch = /^([a-f0-9]{64})\.([a-z0-9]+)$/.exec(filename);
  if (!objectMatch || objectMatch[1] !== checksum || !imageExtensions.has(objectMatch[2]!)) throw new Error("Media reference is not an expected content-addressed object");
  return ref;
}

function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

/** Downloads and verifies private GCS candidates for local analysis. This function never calls a model/provider. */
export async function rehydrateCandidates(rawCandidates: unknown[], options: RehydrateOptions): Promise<RehydratedCandidate[]> {
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) throw new Error("At least one candidate is required");
  if (!Number.isSafeInteger(options.maxPosts) || options.maxPosts < 1 || rawCandidates.length > options.maxPosts)
    throw new Error("Candidate count exceeds the explicit maxPosts limit");
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) throw new Error("A positive maxBytes limit is required");
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error("GCS download timeout is invalid");
  if (!options.localCacheDir.trim()) throw new Error("A private local cache directory is required");
  const callerRoot = resolve(options.localCacheDir);
  const root = join(callerRoot, "storyboard-rehydration");
  const execFile = options.execFile ?? runExecFile;
  await mkdir(callerRoot, { recursive: true });
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  let totalBytes = 0;
  const result: RehydratedCandidate[] = [];

  for (const raw of rawCandidates) {
    const candidate = candidateSchema.parse(raw);
    const { bucket, prefix } = parseSnapshotRef(candidate.snapshotRef);
    const parsedSnapshot = corpusSnapshotSchema.parse(candidate.snapshot);
    const postMatch = /\/posts\/([A-Za-z0-9_-]{1,64})\/snapshot\.json$/.exec(candidate.snapshotRef);
    if (!postMatch || parsedSnapshot.source.postId !== `instagram:${postMatch[1]}` || parsedSnapshot.identity.canonicalPostId !== parsedSnapshot.source.postId)
      throw new Error("Snapshot identity does not match its GCS post path");
    if (parsedSnapshot.media.expected.some((child) => child.modality !== "image") || parsedSnapshot.media.actual.some((child) => child.modality !== "image"))
      throw new Error("Rehydration accepts image-only snapshots");
    const snapshot = structuredClone(parsedSnapshot);
    const seen = new Set<string>();
    for (const child of snapshot.media.actual) {
      if (!child.objectRef || !child.checksum || !/^[a-f0-9]{64}$/.test(child.checksum)) throw new Error("Snapshot media is missing a valid object reference or checksum");
      const objectRef = mediaObjectPath(child.objectRef, bucket, prefix, child.checksum);
      const duplicateObject = seen.has(objectRef);
      seen.add(objectRef);
      const extension = objectRef.slice(objectRef.lastIndexOf(".") + 1);
      const target = join(root, "media", `${child.checksum}.${extension}`);
      if (duplicateObject) {
        child.localPath = target;
        continue;
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await chmod(dirname(target), 0o700);
      let tempRoot: string | undefined;
      try {
        const existing = await lstat(target).catch(() => undefined);
        if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("Cache entry is not a regular file");
        if (!existing || digest(await readFile(target)) !== child.checksum) {
          tempRoot = await mkdtemp(join(dirname(target), ".download-"));
          await chmod(tempRoot, 0o700);
          const temp = join(tempRoot, "payload");
          await execFile("gcloud", ["storage", "cp", objectRef, temp], { timeout: timeoutMs, maxBuffer: 1024 * 1024 });
          const details = await lstat(temp);
          if (!details.isFile() || details.isSymbolicLink()) throw new Error("GCS download did not produce a regular file");
          const size = (await stat(temp)).size;
          if (size < 1 || totalBytes + size > options.maxBytes) throw new Error("Rehydrated media exceeds the explicit maxBytes limit");
          const bytes = await readFile(temp);
          if (digest(bytes) !== child.checksum) throw new Error("Downloaded media checksum mismatch");
          totalBytes += size;
          await chmod(temp, 0o600);
          await rm(target, { force: true });
          await rename(temp, target);
        } else {
          const size = existing.size;
          if (size < 1 || totalBytes + size > options.maxBytes) throw new Error("Rehydrated media exceeds the explicit maxBytes limit");
          totalBytes += size;
          await chmod(target, 0o600);
        }
      } catch (error) {
        throw error;
      } finally {
        if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
      }
      child.localPath = target;
    }
    const assessment = assessSnapshot(snapshot);
    if (assessment.status !== "ready" || !assessment.complete) throw new Error(`Candidate is not ready for analysis: ${assessment.reasons.join(",") || assessment.status}`);
    result.push({ snapshotRef: candidate.snapshotRef, snapshot, ...(candidate.caption === undefined ? {} : { caption: candidate.caption }) });
  }
  return result;
}
