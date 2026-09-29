/** Read-only platform metadata for signed social review pages. Never proposes or generates. */
import { HOSTED, getTenant } from "../tenant-context";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MAX_BODY_BYTES = 1024 * 1024;

export interface GenerationReview {
  id: string;
  artifactId: string;
  postId: string;
  state: string;
  caption: string;
  prompt: string;
  inputHash: string;
  sourcePreviewUrl: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  estimatedCredits: number;
  maximumCredits: number;
  errorCode: string | null;
  createdAt: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeUrl(value: unknown, shop: string, inputHash?: string, providerAsset = false): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
        !url.hostname.includes(".") || url.hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(url.hostname)) return null;
    if (providerAsset && url.hostname.toLowerCase() !== "cdn.higgsfield.ai") return null;
    if (inputHash && (url.searchParams.get("shop") !== shop || url.searchParams.get("hash") !== inputHash)) return null;
    return url.toString();
  } catch { return null; }
}

function parseJob(value: unknown, shop: string): GenerationReview {
  const job = record(value);
  if (!job || typeof job.id !== "string" || typeof job.artifactId !== "string" || !ID.test(job.artifactId) ||
      typeof job.postId !== "string" || !POST_ID.test(job.postId) || typeof job.state !== "string" || !job.state ||
      typeof job.caption !== "string" || typeof job.prompt !== "string" ||
      typeof job.inputHash !== "string" || !/^[a-f0-9]{64}$/.test(job.inputHash) ||
      typeof job.estimatedCredits !== "number" || !Number.isFinite(job.estimatedCredits) || job.estimatedCredits < 0 ||
      typeof job.maximumCredits !== "number" || !Number.isFinite(job.maximumCredits) || job.maximumCredits <= 0 ||
      typeof job.createdAt !== "string" || !Number.isFinite(Date.parse(job.createdAt))) {
    throw new Error("Invalid social generation review metadata");
  }
  const sourcePreviewUrl = safeUrl(job.sourcePreviewUrl, shop, job.inputHash);
  if (!sourcePreviewUrl || (job.videoUrl !== null && !safeUrl(job.videoUrl, shop, undefined, true)) ||
      (job.thumbnailUrl !== null && !safeUrl(job.thumbnailUrl, shop, undefined, true)) ||
      (job.durationSec !== null && (typeof job.durationSec !== "number" || !Number.isFinite(job.durationSec) || job.durationSec <= 0)) ||
      (job.errorCode !== null && typeof job.errorCode !== "string")) {
    throw new Error("Invalid social generation review media");
  }
  return { id: job.id, artifactId: job.artifactId, postId: job.postId, state: job.state,
    caption: job.caption, prompt: job.prompt, inputHash: job.inputHash, sourcePreviewUrl,
    videoUrl: job.videoUrl === null ? null : safeUrl(job.videoUrl, shop, undefined, true),
    thumbnailUrl: job.thumbnailUrl === null ? null : safeUrl(job.thumbnailUrl, shop, undefined, true),
    durationSec: job.durationSec as number | null, estimatedCredits: job.estimatedCredits,
    maximumCredits: job.maximumCredits, errorCode: job.errorCode as string | null, createdAt: job.createdAt };
}

async function brokerRead(query: URLSearchParams): Promise<unknown> {
  const tenant = getTenant();
  const api = process.env.MARKETING_OS_API_URL;
  const key = HOSTED ? process.env.MOS_PLATFORM_SERVICE_KEY : process.env.MARKETING_OS_DEPLOYMENT_KEY;
  if (!api || !key) throw new Error("Social generation review broker unavailable");
  const base = new URL(api);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Invalid platform URL");
  const url = new URL("/api/broker/social-generation", base);
  url.search = query.toString();
  const response = await fetch(url, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${key}`, ...(HOSTED ? { "x-mos-tenant-shop": tenant.shop } : {}) } });
  if (!response.ok) throw new Error(`Social generation review unavailable (${response.status})`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("Social generation review response too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Social generation review response missing");
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > MAX_BODY_BYTES) throw new Error("Social generation review response too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Invalid social generation review response"); }
}

export async function loadGenerationJobsForMonth(month: string): Promise<GenerationReview[]> {
  if (!MONTH.test(month)) throw new Error("Invalid social review month");
  const shop = getTenant().shop;
  const body = record(await brokerRead(new URLSearchParams({ month })));
  if (!body || !Array.isArray(body.jobs) || body.jobs.length > 100) throw new Error("Invalid social generation month response");
  const seen = new Set<string>();
  return body.jobs.map((item) => parseJob(item, shop)).filter((job) => {
    if (!job.postId.startsWith(`${month}-`)) throw new Error("Social generation job belongs to another month");
    if (seen.has(job.postId)) return false;
    seen.add(job.postId); return true;
  });
}

export async function loadGenerationJobForPost(postId: string): Promise<GenerationReview | null> {
  if (!POST_ID.test(postId)) throw new Error("Invalid social review post ID");
  const shop = getTenant().shop;
  const body = record(await brokerRead(new URLSearchParams({ postId })));
  if (!body || !("job" in body)) throw new Error("Invalid social generation post response");
  if (body.job === null) return null;
  const job = parseJob(body.job, shop);
  if (job.postId !== postId) throw new Error("Social generation post mismatch");
  return job;
}
