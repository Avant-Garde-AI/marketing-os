/**
 * Turn an image URL into bytes CUT TO THE SLOT it will fill.
 *
 * The archetype bridge refuses an asset whose aspect does not match its slot,
 * because Penpot image fills have no object-fit: a mismatch distorts rather
 * than crops, and a 30%-stretched room reads as a bad photograph rather than a
 * bug. That refusal is correct, and it is also why this module has to exist —
 * without a cut, most of the genome is uncomposable. AMS room scenes are
 * 928×1152, and only one archetype (a full-bleed room on a 1080×1350 board)
 * happens to match that; every band, wall or story slot needs its own crop.
 *
 * Cover, then centre. Cover because letterboxing a room scene puts bars inside
 * a feed post; centre because these are staged interiors whose subject is
 * roughly middle-weighted, and a smarter crop (saliency, face detection) would
 * be a guess we cannot review at compose time. Attention-based cropping is a
 * later refinement, not a default — a confidently wrong crop of somebody's
 * artwork is worse than an obvious one.
 *
 * Output is always PNG: the bridge re-reads dimensions from the header to
 * verify the cut landed, and one format keeps that check honest.
 */

import sharp from "sharp";
import type { MaterializeImage } from "@/lib/social/archetype-surface";

const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const ALLOWED_SOURCE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
]);

/**
 * A materializer that fetches `assetRef` as an https URL and resizes it to
 * cover the slot exactly.
 *
 * Accepts a broader input set than the compose lane emits (avif, tiff) because
 * this is a decode step, not a placement step — what matters downstream is the
 * PNG it produces. Still https-only and still capped: an asset ref reaches the
 * network, so it gets the same narrow treatment as every other fetch here.
 */
export const croppingMaterializer: MaterializeImage = async (assetRef, slot) => {
  let url: URL;
  try {
    url = new URL(assetRef);
  } catch {
    throw new Error(`"${assetRef}" is not a URL — this materializer takes https image URLs`);
  }
  if (url.protocol !== "https:") throw new Error(`refusing ${url.protocol}// — image refs must be https`);

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`fetch returned ${res.status}`);

  const declared = ((res.headers.get("content-type") ?? "").split(";")[0] ?? "").trim().toLowerCase();
  if (!ALLOWED_SOURCE_TYPES.has(declared)) {
    throw new Error(`content-type "${declared || "none"}" is not a supported image type`);
  }

  const source = Buffer.from(await res.arrayBuffer());
  if (source.byteLength === 0) throw new Error("fetched zero bytes");
  if (source.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(
      `source image is ${Math.round(source.byteLength / 1024 / 1024)}MB, over the ` +
        `${MAX_SOURCE_BYTES / 1024 / 1024}MB decode limit`,
    );
  }

  // `fit: cover` + `position: centre` fills the slot and crops the overflow;
  // withoutEnlargement is deliberately NOT set, because a slot must be filled
  // even when the source is smaller — a short asset is a quality problem, and
  // a half-empty slot is a correctness one.
  const data = await sharp(source)
    .resize(slot.width, slot.height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  return { data: new Uint8Array(data), mediaType: "image/png" };
};
