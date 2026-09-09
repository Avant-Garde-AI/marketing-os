/**
 * The seam between a genome archetype and a composed surface.
 *
 * `resolveArchetype` says WHERE things go. `resolveSlots` says WHAT goes in
 * them. `composeSurfaceFile` draws. Nothing joined the three, so every surface
 * so far was hand-placed element-by-element — which is why a store with seven
 * archetypes shipped ten posts that all looked like one archetype. The genome
 * was consulted for copy formulas and ignored for layout.
 *
 * This module is that join, and it is deliberately thin: no I/O, no clock, no
 * randomness. Same archetype + same bindings + same board → byte-identical
 * spec, so a surface can be recomposed and diffed.
 *
 * TWO PROPERTIES WORTH KEEPING:
 *
 * 1. IT REFUSES RATHER THAN IMPROVISES. An unfillable archetype throws with
 *    every unsatisfied role named (assertComplete). The alternative — drawing
 *    the slots we can and skipping the rest — produces a surface that passes
 *    the fit-check, exports cleanly, and is missing its subject. That failure
 *    is invisible in every check we have except a human looking at it.
 *
 * 2. BYTES ENTER ONLY HERE. Bindings carry `assetRef` strings (resolve.ts
 *    rule 1: the reference corpus is third-party material and must never
 *    become the work). `materialize` is the caller's, so the store decides
 *    what a ref means and this module never learns.
 *
 * Board size is the caller's too, and it matters more than it looks: AMS room
 * scenes are 928×1152 (0.806), so a 1080×1350 board is a ~0.7% scale and a
 * 1080×1080 board is a 24% vertical crush. Penpot image fills stretch to their
 * shape — there is no object-fit — so ASPECT IS CHOSEN, NEVER CORRECTED.
 */

import type { Board } from "./reference";
import { assertComplete, resolveSlots, type Resolution, type SlotBindings } from "./resolve";
import type { LayoutArchetype } from "./types";

// ---------------------------------------------------------------------------
// ComposeSpec-compatible local types
//
// Structural copies of @avant-garde/design-surfaces' `Fill`/`ComposeElement`/
// `ComposeSpec` (packages/design-surfaces/src/types.ts), deliberately NOT
// imported — spec 23's separation rule keeps design-surfaces domain-agnostic
// and packs dependency-free of it. Same convention, and same reason, as
// email-campaign's compose-templates. The hosted runtime passes the result to
// `composeSurfaceFile` verbatim; the shapes are type-compatible.
// ---------------------------------------------------------------------------

export interface SurfaceFill {
  fillColor: string;
  fillOpacity?: number;
}

export type SurfaceComposeElement =
  | {
      type: "text";
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      characters: string;
      fontId?: string;
      fontFamily?: string;
      fontSize?: string;
      fontWeight?: string;
      fontStyle?: string;
      lineHeight?: string;
      textAlign?: "left" | "center" | "right" | "justify";
      fills?: SurfaceFill[];
    }
  | {
      type: "rect";
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fills?: SurfaceFill[];
    }
  | {
      type: "image";
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      data: Uint8Array;
      mediaType: ImageMediaType;
    };

export interface SurfaceComposeSpec {
  fileName: string;
  pageName?: string;
  board?: { name: string; width: number; height: number; background?: SurfaceFill };
  elements?: SurfaceComposeElement[];
  tokens?: Record<string, unknown>;
  libraryColors?: { name: string; color: string; opacity?: number }[];
}

/**
 * design-surfaces' text metrics, mirrored for the same reason the types are.
 *
 * These MUST track `compose.ts`'s `AVG_CHAR_WIDTH_FACTOR`/`DEFAULT_LINE_HEIGHT`
 * — we size type with them and its fit-check judges the result with them, so a
 * drift shows up as text that overflows only in the warning tier nobody reads.
 * The canary test asserts a two-line pull quote still fits its slot, which is
 * what a drift would break first.
 */
const AVG_CHAR_WIDTH_FACTOR = 0.5;
const DEFAULT_LINE_HEIGHT = 1.2;


export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface MaterializedImage {
  data: Uint8Array;
  mediaType: ImageMediaType;
}

/**
 * Turn one binding's `assetRef` into bytes. Given the slot it is filling, so a
 * caller can fetch at the right size rather than shipping a 4000px master into
 * a 200px band.
 */
export type MaterializeImage = (
  assetRef: string,
  slot: { role: string; width: number; height: number },
) => Promise<MaterializedImage>;

export interface TextStyle {
  fontFamily?: string;
  fontId?: string;
  /** Omit to derive from the slot's height — see `deriveFontSize`. */
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  lineHeight?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  /** Hex, e.g. "#2D2D2D". */
  color?: string;
}

export interface SurfaceStyle {
  /** Board background; also what shows through where nothing is drawn. */
  background?: SurfaceFill;
  /** Fill for `band` and `ground` slots — per role, else `bandColor`. */
  bandColor: string;
  bandColorByRole?: Record<string, string>;
  /** Type per role (headline, subhead, eyebrow, body, statement…). */
  roles?: Record<string, TextStyle>;
  /** Applied where a role has no entry. */
  defaultText: TextStyle;
}

export interface ArchetypeComposeInput {
  archetype: LayoutArchetype;
  board: Board;
  bindings: SlotBindings;
  fileName: string;
  pageName?: string;
  boardName?: string;
  style: SurfaceStyle;
  materialize: MaterializeImage;
  tokens?: Record<string, unknown>;
  libraryColors?: { name: string; color: string; opacity?: number }[];
}

/**
 * Type scaled to the slot it sits in, so one archetype reads correctly at
 * 1080², 1080×1350 and 1080×1920 without a per-format stylesheet. That is the
 * whole point of normalized slots — a fixed px size would throw it away.
 *
 * Sized against the CONTENT, not the box. A first cut used a flat fraction of
 * slot height, which is right for a one-line band and catastrophic for a text
 * block: `editorial-statement`'s slot is 28% of the board, so a two-line pull
 * quote came out at 219px and lost half its words off the bottom edge. The
 * fit-check only warns on text overflow (a board-edge clip is the error tier),
 * so nothing stopped it — it composed, exported, and looked deliberate.
 *
 * Uses the estimator's own metrics (mirrored above) so the size we pick and
 * the size the fit-check judges agree.
 */
function deriveFontSize(characters: string, width: number, height: number, lineHeight: number): string {
  const fits = (size: number): boolean => {
    const lines = characters.split("\n").reduce((n, line) => {
      const lineWidth = line.length * size * AVG_CHAR_WIDTH_FACTOR;
      return n + Math.max(1, Math.ceil(lineWidth / Math.max(width, 1)));
    }, 0);
    return lines * size * lineHeight <= height;
  };
  // Descending so the answer is the largest size that fits, and bounded above
  // by the slot height: a single short word must not balloon to fill a block.
  for (let size = Math.round(height); size > 11; size--) {
    if (fits(size)) return String(size);
  }
  return "11";
}

/**
 * How far an image may be stretched to fill its slot before we refuse.
 *
 * Penpot image fills scale to the shape — there is no object-fit and no crop —
 * so a slot whose aspect differs from the asset's silently distorts. AMS room
 * scenes are 928×1152 (0.806): a 1080×1350 board is a 0.7% squeeze nobody can
 * see, and a 1080×1920 story board is a 30% vertical stretch that turns chair
 * legs into stilts. That second one composed happily and looked *almost* fine,
 * which is the dangerous kind of wrong.
 *
 * 8% is roughly where a stretch stops reading as "a slightly different lens"
 * and starts reading as a mistake.
 */
export const MAX_ASPECT_DISTORTION = 0.08;

/** Intrinsic pixel size from PNG/JPEG/GIF/WebP headers — no image dependency.
 * Returns null when the format is one we cannot measure, which is treated as
 * "unknown" (permitted) rather than "wrong". */
export function imageDimensions(data: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (o: number, le = false) => view.getUint16(o, le);

  // PNG: IHDR is always the first chunk, width/height at bytes 16..24.
  if (data.length > 24 && data[0] === 0x89 && data[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF: logical screen descriptor, little-endian, at bytes 6..10.
  if (data.length > 10 && data[0] === 0x47 && data[1] === 0x49) {
    return { width: u16(6, true), height: u16(8, true) };
  }
  // JPEG: walk the segment chain to a start-of-frame marker.
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let o = 2;
    while (o + 9 < data.length) {
      if (data[o] !== 0xff) break;
      const marker = data[o + 1] ?? 0;
      const len = u16(o + 2);
      // SOF0-SOF15, excluding the non-frame markers DHT/JPG/DAC (c4,c8,cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16(o + 5), width: u16(o + 7) };
      }
      o += 2 + len;
    }
    return null;
  }
  // WebP (VP8X only — VP8/VP8L bit-pack their dimensions differently).
  if (data.length > 30 && data[0] === 0x52 && data[8] === 0x57 && data[12] === 0x56 && data[15] === 0x58) {
    const at = (i: number) => data[i] ?? 0;
    const w = 1 + (at(24) | (at(25) << 8) | (at(26) << 16));
    const h = 1 + (at(27) | (at(28) << 8) | (at(29) << 16));
    return { width: w, height: h };
  }
  return null;
}

/**
 * Build a ComposeSpec from an archetype and its bindings.
 *
 * Elements come out in archetype slot order, which is the genome's own
 * declaration order — grounds and rooms first, bands over them, type last.
 * That ordering is load-bearing (Penpot paints in document order), so it is
 * the archetype author's call, not this module's.
 */
export async function specFromArchetype(
  input: ArchetypeComposeInput,
): Promise<{ spec: SurfaceComposeSpec; resolution: Resolution }> {
  const resolution = resolveSlots(input.archetype, input.board, input.bindings);
  const filled = assertComplete(resolution);

  const elements: SurfaceComposeElement[] = [];
  for (const slot of filled) {
    const base = { name: slot.role, x: slot.x, y: slot.y, width: slot.width, height: slot.height };

    if (slot.fill.kind === "band") {
      elements.push({ type: "rect", ...base, fills: [{ fillColor: slot.fill.color, fillOpacity: 1 }] });
      continue;
    }

    if (slot.fill.kind === "text") {
      const style = input.style.roles?.[slot.role] ?? input.style.defaultText;
      const lineHeight = Number(style.lineHeight) || DEFAULT_LINE_HEIGHT;
      elements.push({
        type: "text",
        ...base,
        characters: slot.fill.characters,
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
        ...(style.fontId ? { fontId: style.fontId } : {}),
        fontSize:
          style.fontSize ?? deriveFontSize(slot.fill.characters, slot.width, slot.height, lineHeight),
        ...(style.fontWeight ? { fontWeight: style.fontWeight } : {}),
        ...(style.fontStyle ? { fontStyle: style.fontStyle } : {}),
        ...(style.lineHeight ? { lineHeight: style.lineHeight } : {}),
        ...(style.textAlign ? { textAlign: style.textAlign } : {}),
        fills: [{ fillColor: style.color ?? "#000000", fillOpacity: 1 }],
      });
      continue;
    }

    // Images last, and sequentially: a parallel fetch that fails reports the
    // rejection without saying WHICH role could not be materialized, and
    // "one of your five images failed" is not an actionable error.
    let image: MaterializedImage;
    try {
      image = await input.materialize(slot.fill.assetRef, {
        role: slot.role,
        width: slot.width,
        height: slot.height,
      });
    } catch (e) {
      throw new Error(
        `role "${slot.role}" could not be materialized from assetRef "${slot.fill.assetRef}": ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (image.data.byteLength === 0) {
      throw new Error(
        `role "${slot.role}" materialized to zero bytes from assetRef "${slot.fill.assetRef}" — ` +
          `an empty image composes as a blank rect that passes every downstream check`,
      );
    }
    const intrinsic = imageDimensions(image.data);
    if (intrinsic && intrinsic.width > 0 && intrinsic.height > 0) {
      const assetAspect = intrinsic.width / intrinsic.height;
      const slotAspect = slot.width / slot.height;
      const distortion = Math.abs(slotAspect - assetAspect) / assetAspect;
      if (distortion > MAX_ASPECT_DISTORTION) {
        throw new Error(
          `role "${slot.role}" would be stretched ${Math.round(distortion * 100)}% to fill its slot: ` +
            `the asset is ${intrinsic.width}×${intrinsic.height} (${assetAspect.toFixed(3)}) and the slot is ` +
            `${slot.width}×${slot.height} (${slotAspect.toFixed(3)}). Penpot image fills have no object-fit, ` +
            `so this would distort rather than crop. Compose on a board matching the asset's aspect, or ` +
            `supply an asset cut for this slot.`,
        );
      }
    }
    elements.push({ type: "image", ...base, data: image.data, mediaType: image.mediaType });
  }

  const spec: SurfaceComposeSpec = {
    fileName: input.fileName,
    ...(input.pageName ? { pageName: input.pageName } : {}),
    board: {
      name: input.boardName ?? input.archetype.id,
      width: input.board.width,
      height: input.board.height,
      ...(input.style.background ? { background: input.style.background } : {}),
    },
    elements,
    ...(input.tokens ? { tokens: input.tokens } : {}),
    ...(input.libraryColors ? { libraryColors: input.libraryColors } : {}),
  };

  return { spec, resolution };
}

// ---------------------------------------------------------------------------
// The default materializer
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_TYPES = new Set<ImageMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch an https URL as image bytes.
 *
 * https only — an http asset ref would let a compose step be redirected in
 * transit into a surface a human then approves, and the approval is what makes
 * that dangerous rather than merely wrong.
 */
export const fetchImageAsset: MaterializeImage = async (assetRef, slot) => {
  let url: URL;
  try {
    url = new URL(assetRef);
  } catch {
    throw new Error(`not a URL (role "${slot.role}" needs an https image URL or a store-specific ref its own materializer understands)`);
  }
  if (url.protocol !== "https:") throw new Error(`refusing ${url.protocol}// — image refs must be https`);

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`fetch returned ${res.status}`);

  const declared = ((res.headers.get("content-type") ?? "").split(";")[0] ?? "").trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(declared as ImageMediaType)) {
    throw new Error(`content-type "${declared || "none"}" is not a supported image type`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`image is ${Math.round(buf.byteLength / 1024 / 1024)}MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit`);
  }
  return { data: buf, mediaType: declared as ImageMediaType };
};
