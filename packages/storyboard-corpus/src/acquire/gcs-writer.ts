import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { DurableMediaWriter } from "./media-mirror";
import type { RawResponseWriter } from "./apify";

type ExecFile = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number }
) => Promise<unknown>;

export type GcsWritersOptions = {
  /** Fixed, private research prefix such as gs://bucket/research/storyboard. */
  prefix: string;
  /** Private directory where source bytes remain available to the local runner. */
  localCacheDir: string;
  /** Injectable for offline tests; production defaults to `gcloud storage cp`. */
  execFile?: ExecFile;
  tempDir?: string;
  timeoutMs?: number;
};

export type GcsWriters = {
  writeRawResponse: RawResponseWriter;
  writeBytes: DurableMediaWriter;
};

const runExecFile = promisify(nodeExecFile) as unknown as ExecFile;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

function validatePrefix(prefix: string): string {
  const match = /^gs:\/\/([a-z0-9][a-z0-9._-]{1,61}[a-z0-9])\/(.+)$/.exec(prefix.trim());
  if (!match) throw new Error("GCS prefix must be a bucket plus a non-empty object path");
  const path = match[2]!.replace(/\/+$/, "");
  const segments = path.split("/");
  if (segments.some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === "." || part === ".."))
    throw new Error("GCS prefix contains an unsafe path component");
  return `gs://${match[1]}/${path}`;
}

function safeShortcode(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value))
    throw new Error("Source shortcode is unsafe for a GCS object name");
  return value;
}

function safeChild(childId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(childId)) throw new Error("Media child id is unsafe");
  return childId;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function extensionFor(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  const extension = extensions[mimeType];
  if (!extension) throw new Error("Unsupported MIME type for durable media storage");
  return extension;
}

function compactTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Evidence capture time is invalid");
  return date.toISOString().replace(/[-:.]/g, "");
}

async function createPrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.chmod(0o600);
  } finally {
    await file.close();
  }
}

async function cachePrivateFile(
  cachePath: string,
  bytes: Uint8Array,
  checksum: string
): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
  try {
    await createPrivateFile(cachePath, bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const details = await lstat(cachePath);
    if (!details.isFile() || details.isSymbolicLink())
      throw new Error("Local media cache path is not a regular file");
    const existing = await readFile(cachePath);
    if (sha256(existing) !== checksum)
      throw new Error("Existing local media cache failed checksum validation");
  }
  await chmod(cachePath, 0o600);
}

/** Creates callback-compatible evidence and media writers rooted at one fixed GCS prefix. */
export function createGcsWriters(options: GcsWritersOptions): GcsWriters {
  const prefix = validatePrefix(options.prefix);
  if (!options.localCacheDir.trim()) throw new Error("A local media cache directory is required");
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
    throw new Error("GCS upload timeout must be between 1 and 600000 ms");
  const execFile = options.execFile ?? runExecFile;
  const localCacheRoot = resolve(options.localCacheDir);
  // The process-wide OS temp directory may be owned by another user. Keep
  // private upload staging under this run's caller-owned cache by default.
  const stagingRoot = resolve(options.tempDir ?? join(localCacheRoot, ".tmp"));

  async function upload(relativeName: string, bytes: Uint8Array): Promise<string> {
    if (
      !relativeName
        .split("/")
        .every((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..")
    )
      throw new Error("GCS object name contains an unsafe path component");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES)
      throw new Error("GCS upload payload is empty or exceeds the upload size cap");
    const destination = `${prefix}/${relativeName}`;
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    await chmod(stagingRoot, 0o700);
    const tempRoot = await mkdtemp(join(stagingRoot, "storyboard-upload-"));
    await chmod(tempRoot, 0o700);
    const tempFile = join(tempRoot, "payload");
    try {
      await createPrivateFile(tempFile, bytes);
      await execFile("gcloud", ["storage", "cp", tempFile, destination], {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });
    } catch {
      throw new Error("GCS upload failed");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
    return destination;
  }

  const writeRawResponse: RawResponseWriter = async ({ source, response, capturedAt }) => {
    const shortcode = safeShortcode(source.shortcode);
    const captured = compactTimestamp(capturedAt);
    let bytes: Uint8Array;
    try {
      bytes = Buffer.from(JSON.stringify({ source, capturedAt, response }), "utf8");
    } catch {
      throw new Error("Provider evidence could not be serialized");
    }
    if (!bytes.byteLength) throw new Error("Provider evidence payload is empty");
    const digest = sha256(bytes);
    return upload(`posts/${shortcode}/evidence/${captured}-${digest}.json`, bytes);
  };

  const writeBytes: DurableMediaWriter = async ({ child, bytes, mimeType, checksum }) => {
    safeChild(child.childId);
    const actualChecksum = sha256(bytes);
    if (!/^[a-f0-9]{64}$/.test(checksum) || checksum !== actualChecksum)
      throw new Error("Media checksum does not match bytes");
    const extension = extensionFor(mimeType);
    const name = `media/${checksum}.${extension}`;
    const cachePath = resolve(localCacheRoot, name);
    const rel = relative(localCacheRoot, cachePath);
    if (!rel || rel.startsWith(`..${sep}`) || rel === "..")
      throw new Error("Local media path escaped cache root");
    await mkdir(localCacheRoot, { recursive: true, mode: 0o700 });
    await chmod(localCacheRoot, 0o700);
    await cachePrivateFile(cachePath, bytes, checksum);
    const objectRef = await upload(name, bytes);
    return { objectRef, localPath: cachePath };
  };

  return { writeRawResponse, writeBytes };
}
