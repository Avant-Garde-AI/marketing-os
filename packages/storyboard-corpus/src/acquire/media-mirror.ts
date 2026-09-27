import { createHash } from "node:crypto";

import type { MediaMirror, ProviderChild } from "./recover";

export type MediaFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type DurableMediaWriter = (record: {
  child: ProviderChild;
  bytes: Uint8Array;
  mimeType: string;
  checksum: string;
}) => Promise<{ objectRef: string; localPath?: string }>;

export type InstagramMediaMirrorOptions = {
  writeBytes: DurableMediaWriter;
  fetch?: MediaFetch;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 3;
const ALLOWED_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];

function allowedUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Instagram media source URL is invalid");
  }
  const hostname = url.hostname.toLowerCase();
  const allowed =
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (hostname === "cdninstagram.com" ||
      hostname === "fbcdn.net" ||
      ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) &&
    (url.port === "" || url.port === "443");
  if (!allowed) throw new Error("Instagram media host is not allowlisted");
  return url;
}

function detectMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a"))
    return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP")
    return "image/webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (["heic", "heix", "hevc", "mif1", "msf1", "avif", "avis"].includes(brand))
      return brand.startsWith("avi") ? "image/avif" : "image/heic";
    return "video/mp4";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "video/webm";
  throw new Error("Instagram media bytes have an unsupported file signature");
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes)
    throw new Error("Instagram media exceeds the configured byte cap");
  if (!response.body) throw new Error("Instagram media response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Instagram media exceeds the configured byte cap");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Fetches ephemeral Instagram CDN media, validates its bytes, then durably stores them. */
export function createInstagramMediaMirror(options: InstagramMediaMirrorOptions): MediaMirror {
  if (typeof options.writeBytes !== "function")
    throw new Error("A durable media writer is required");
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0)
    throw new Error("A positive media byte cap is required");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("Media timeout must be positive");
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5)
    throw new Error("Media redirect cap must be between 0 and 5");
  const fetcher = options.fetch ?? fetch;

  return {
    async mirror(child) {
      if (child.modality !== "image" && child.modality !== "video")
        throw new Error("Unknown child modality cannot be mirrored");
      let url = allowedUrl(child.sourceRef);
      const signal = AbortSignal.timeout(timeoutMs);
      let response: Response | undefined;
      for (let redirect = 0; redirect <= maxRedirects; redirect++) {
        try {
          response = await fetcher(url, { method: "GET", redirect: "manual", signal });
        } catch {
          throw new Error("Instagram media request failed or timed out");
        }
        if (!isRedirect(response.status)) break;
        if (redirect === maxRedirects) throw new Error("Instagram media redirect limit exceeded");
        const location = response.headers.get("location");
        if (!location) throw new Error("Instagram media redirect has no location");
        url = allowedUrl(new URL(location, url));
      }
      if (!response || !response.ok) throw new Error("Instagram media request failed");

      const bytes = await readBounded(response, options.maxBytes);
      const mimeType = detectMime(bytes);
      if (child.modality === "image" && !mimeType.startsWith("image/"))
        throw new Error("Instagram image child returned non-image bytes");
      if (child.modality === "video" && !mimeType.startsWith("video/"))
        throw new Error("Instagram video child returned non-video bytes");
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const stored = await options.writeBytes({ child, bytes, mimeType, checksum });
      if (!stored || typeof stored.objectRef !== "string" || !stored.objectRef.trim())
        throw new Error("Durable media writer did not return an object reference");
      const objectRef = stored.objectRef.trim();
      if (!objectRef.startsWith("gs://"))
        throw new Error("Media writer must return a durable GCS object reference");
      return { objectRef, checksum, localPath: stored.localPath };
    },
  };
}
