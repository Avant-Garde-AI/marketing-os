/**
 * Extract a work's dominant colours from its actual pixels.
 *
 * The half of the colour-claims guard that needs an image decoder. The pack
 * owns the CHECK (pure, testable, no I/O); this owns the measurement, because
 * a skill pack must not grow a dependency on libvips.
 *
 * ## Two choices that decide whether the guard is usable
 *
 * **Quantise to 12, not 5.** The bug this feeds is about ink-on-paper drawings
 * as much as colour fields, and a line drawing's ink is a small fraction of its
 * pixels. At 5 colours a black-ink-on-cream work quantises to five creams and
 * the guard then REFUSES the true sentence "black ink on cream paper" — a
 * false accusation against correct copy, which is the one failure mode that
 * would get this switched off. At 12 the ink survives as its own entry.
 *
 * **Downscale before counting, never after.** 256x256 is enough to hold a
 * minority colour that matters and small enough to count exhaustively. Scaling
 * further blends thin linework into its background, which is the same failure
 * as quantising too hard.
 */

import sharp from "sharp";
import type { PaletteColor } from "@/lib/social/palette";

const SAMPLE_EDGE = 256;
const PALETTE_SIZE = 12;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 24 * 1024 * 1024;

/** Dominant colours of an image, most-covering first. */
export async function extractPalette(image: Buffer): Promise<PaletteColor[]> {
  // Quantise with libimagequant, then count the result. A hand-rolled uniform
  // bucketing was tried first and is wrong in a way that matters: it splits one
  // perceptual colour across neighbouring buckets, so "Vent Stripe" came back
  // as a dozen 1.5% slivers, every one below the share floor. The guard then
  // had no dominant colour to compare against and refused TRUE copy. Proper
  // quantisation consolidates a hue into one entry, which is the number the
  // check actually needs.
  //
  // `fit: inside` keeps the aspect: squashing a portrait work would change the
  // proportion of each colour, which is the number the guard reads.
  const quantised = await sharp(image)
    .resize(SAMPLE_EDGE, SAMPLE_EDGE, { fit: "inside" })
    .removeAlpha()
    .png({ palette: true, colours: PALETTE_SIZE, dither: 0 })
    .toBuffer();

  const { data, info } = await sharp(quantised).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map<number, number>();
  const px = info.width * info.height;
  for (let i = 0; i < px; i++) {
    const o = i * info.channels;
    const key = (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = px || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PALETTE_SIZE)
    .map(([key, n]) => ({
      hex: "#" + key.toString(16).padStart(6, "0").toUpperCase(),
      share: Number((n / total).toFixed(4)),
    }));
}

/**
 * Fetch an https image and extract its palette.
 *
 * Returns an EMPTY palette on any failure rather than throwing. An unreachable
 * image means the colour claims go unchecked, and `checkPostClaims` reports
 * that honestly — but it must not take down a post write that has nothing to do
 * with imagery. The failure is logged so an always-empty palette is findable;
 * silently unchecked is how a guard becomes decorative.
 */
export async function paletteOf(imageUrl: string): Promise<PaletteColor[]> {
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:") throw new Error(`refusing ${url.protocol}//`);
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`fetch returned ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) throw new Error("fetched zero bytes");
    if (buf.byteLength > MAX_BYTES) throw new Error(`image is over ${MAX_BYTES / 1024 / 1024}MB`);
    return await extractPalette(buf);
  } catch (e) {
    console.error(`[palette] could not read ${imageUrl}:`, e instanceof Error ? e.message : e);
    return [];
  }
}
