/**
 * Durable campaign assets — because a review link outlives the images in it.
 *
 * THE BUG THIS EXISTS FOR. `imagery_resolve` composites a room or leaning
 * mockup and hands back a **signed** GCS URL with `X-Goog-Expires=86400`. The
 * imagery tool says so plainly, and the draft Action honours it by re-uploading
 * to the ESP before anything sends. But the REVIEW path was never considered:
 * a shareable review link lives 30 days, so from day two every reviewer opened
 * a page of broken images. The bucket is private (403 unsigned), so a longer
 * signature only moves the cliff — the URL has to stop being ephemeral.
 *
 * So an artifact may not carry an ephemeral URL at all. On write, bytes are
 * pulled once, while the signature is still good, and stored beside the
 * campaign; the artifact records a stable path that this deployment serves.
 *
 * WHERE THE BYTES GO. Through the same StoreRepo seam as the markdown, so in
 * mirror/git mode a campaign's imagery is versioned in the store repo next to
 * the campaign that uses it — the artifact becomes genuinely self-contained,
 * which is most of the argument for putting artifacts in git in the first
 * place. Binary rides as base64 (the GitHub contents API is base64 either way);
 * a `.b64` suffix keeps it obvious to anyone reading a diff that the blob is
 * not meant to be read as text.
 *
 * WHAT THIS IS NOT. Not the send path. Email images must be ESP-hosted to
 * survive in a recipient's inbox, and the draft Action still uploads them.
 * This is the review and preview lane only.
 */

import type { StoreRepo } from "../skill-kit";

/** Assets live beside the campaign that uses them. */
export function assetPath(campaignId: string, name: string): string {
  return `email/campaigns/${campaignId}/assets/${name}.b64`;
}

/**
 * Is this URL going to stop working?
 *
 * Deliberately a positive test for known-ephemeral shapes rather than a
 * negative test for known-durable ones: a new signing scheme should be treated
 * as ephemeral until someone says otherwise, and the cost of re-hosting a URL
 * that would have survived is one copied file.
 */
export function isEphemeralUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  return (
    /[?&]X-Goog-(Expires|Signature)=/i.test(url) || // GCS signed
    /[?&]X-Amz-(Expires|Signature)=/i.test(url) || // S3 signed
    /[?&](se|sig)=/i.test(url) || // Azure SAS
    /^https:\/\/storage\.googleapis\.com\//i.test(url) // private bucket by default
  );
}

/** Extension implied by a content type, for a filename that stays honest. */
function extFor(contentType: string | null): string {
  const t = (contentType ?? "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  if (t.includes("avif")) return "avif";
  return "jpg";
}

export interface PersistedAsset {
  /** Repo-relative path of the stored bytes. */
  path: string;
  /** Filename (without the .b64 suffix) — what the asset route addresses. */
  name: string;
  bytes: number;
  contentType: string;
}

/**
 * Fetch an ephemeral image once and store it durably.
 *
 * Returns null — rather than throwing — when the source cannot be fetched,
 * because a campaign whose hero failed to copy is still a campaign worth
 * saving. The caller keeps the original URL and says so, which is honest:
 * a working-but-expiring image beats no campaign, and the warning tells
 * somebody to look.
 */
export async function persistAsset(
  repo: StoreRepo,
  campaignId: string,
  slot: string,
  url: string,
): Promise<PersistedAsset | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;

    // Content-addressed: re-resolving the same artwork twice produces the same
    // bytes and therefore the same name, so the store repo does not accumulate
    // a new blob every time a campaign is re-saved.
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(buf).digest("hex").slice(0, 12);
    const name = `${slot}-${digest}.${extFor(contentType)}`;
    const path = assetPath(campaignId, name);

    await repo.writeFile(path, buf.toString("base64"));
    return { path, name, bytes: buf.length, contentType };
  } catch {
    return null;
  }
}

/** Read a stored asset back as bytes. */
export async function readAsset(
  repo: StoreRepo,
  campaignId: string,
  name: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const b64 = await repo.readFile(assetPath(campaignId, name));
  if (b64 === null) return null;
  const ext = name.split(".").pop()?.toLowerCase() ?? "jpg";
  const contentType =
    ext === "png" ? "image/png"
    : ext === "webp" ? "image/webp"
    : ext === "gif" ? "image/gif"
    : ext === "avif" ? "image/avif"
    : "image/jpeg";
  return { bytes: Buffer.from(b64, "base64"), contentType };
}
