/**
 * WS2-R2 — Email compose templates: the v1 board vocabulary (04 §7).
 *
 * Each template is a pure function `(tokens, payload) → EmailBoardSpec`: the
 * brand-expression sections of a campaign email, composed as email-width
 * Penpot boards from DTCG tokens. Spec 23 §4's rule — templates absorb
 * complexity, composition fills slots: WS3's drafting flow authors ONLY the
 * payloads (validated by the exported zod schemas); geometry, type scale and
 * token wiring live here.
 *
 * ## The board contract (04 §0/§5, enforced by construction)
 *
 * - **600px logical width** everywhere (exported @2x → 1200px, rendered at
 *   `width="600"`).
 * - **Backgrounds extend to the board edges** — every template sets a
 *   board-level background fill, so an exported PNG never floats as a white
 *   slab on a dark-mode client (04 §5b: boards carry their own background).
 * - **Display type only.** Boards carry headlines, eyebrows, lockups —
 *   never body copy, never information that must reflow, be read by screen
 *   readers, or be edited without a re-export. That content is an `html`
 *   section rendered by @avant-garde/email-assembly below the board.
 * - **Explicit `fillOpacity: 1` on every fill** — Penpot renders text fills
 *   without an explicit opacity as default black (see design-surfaces
 *   compose.ts `textStyle`); templates never rely on that normalization.
 * - **Deterministic**: same tokens + payload → deep-equal board spec. No
 *   clocks, no randomness.
 *
 * ## Why the types are local
 *
 * `EmailBoardSpec`/`EmailComposeElement`/`EmailFill` are STRUCTURAL copies of
 * @avant-garde/design-surfaces' `BoardSpec`/`ComposeElement`/`Fill`
 * (packages/design-surfaces/src/types.ts). They are deliberately not
 * imported: spec 23's separation rule keeps design-surfaces domain-agnostic
 * and packs dependency-free of it — the pack describes boards, the hosted
 * runtime passes them to `composeSurfaceFile({ boards })` verbatim (they are
 * type-compatible by shape; element coordinates are BOARD-RELATIVE, exactly
 * as BoardSpec documents).
 *
 * ## Token fallbacks
 *
 * Token resolution (and the full fallback table) lives in ./brand-tokens —
 * sparse tokens degrade to email-safe defaults (white surface, near-black
 * ink, ink-as-accent, Georgia/Helvetica stacks); templates never throw on a
 * missing token. Invalid PAYLOADS do throw (zod) — a payload is authored,
 * not inherited.
 */

import { z } from "zod";
import { approxLuminance } from "@avant-garde/email-assembly";
import {
  resolveEmailBrandTheme,
  type DtcgLikeTokens,
  type EmailBrandTheme,
} from "./brand-tokens";

// ---------------------------------------------------------------------------
// BoardSpec-compatible local types (see module JSDoc for why they're local).
// ---------------------------------------------------------------------------

/** Structural copy of design-surfaces `Fill`. */
export interface EmailFill {
  fillColor: string;
  fillOpacity?: number;
}

export type EmailImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** Structural copy of design-surfaces `ComposeElement`. */
export type EmailComposeElement =
  | {
      type: "text";
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      characters: string;
      /** Penpot font id (`gfont-*`), derived from the typography token's
       * first family — see brand-tokens `gfontId`. */
      fontId?: string;
      fontFamily?: string;
      fontSize?: string;
      fontWeight?: string;
      fontStyle?: string;
      lineHeight?: string;
      textAlign?: "left" | "center" | "right" | "justify";
      fills?: EmailFill[];
    }
  | {
      type: "rect";
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fills?: EmailFill[];
      rx?: number;
      ry?: number;
    }
  | {
      type: "image";
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      /** Raw image bytes — passed through verbatim (the pack never decodes). */
      data: Uint8Array;
      mediaType: EmailImageMediaType;
    };

/** Structural copy of design-surfaces `BoardSpec` (multi-board form; element
 * coordinates are board-relative, (0,0) = the board's own top-left). */
export interface EmailBoardSpec {
  name: string;
  width: number;
  height: number;
  background?: EmailFill;
  elements: EmailComposeElement[];
}

// ---------------------------------------------------------------------------
// Shared payload pieces + geometry.
// ---------------------------------------------------------------------------

/** Raw image bytes + media type, passed through to the board verbatim. */
export const boardImageSchema = z.object({
  data: z.instanceof(Uint8Array),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
});

export type BoardImage = z.infer<typeof boardImageSchema>;

/** The email-safe logical board width (04 §2). */
export const EMAIL_BOARD_WIDTH = 600;

/** Section-appropriate board heights, fixed per template (04 §2). */
export const EMAIL_BOARD_GEOMETRY = {
  hero: { width: EMAIL_BOARD_WIDTH, height: 750 },
  promoBanner: { width: EMAIL_BOARD_WIDTH, height: 200 },
  productFeature: { width: EMAIL_BOARD_WIDTH, height: 740 },
  editorialMoment: { width: EMAIL_BOARD_WIDTH, height: 600 },
} as const;

/** Horizontal text gutter inside boards. */
const TEXT_X = 40;
const TEXT_WIDTH = EMAIL_BOARD_WIDTH - TEXT_X * 2;

function fill(color: string): EmailFill {
  // Explicit fillOpacity — Penpot's text-fill quirk (module JSDoc).
  return { fillColor: color, fillOpacity: 1 };
}

/**
 * Display tracking, simulated: compose elements carry no letterSpacing
 * attribute (design-surfaces `ComposeElement` has none), so eyebrow/label
 * tracking is spaced characters — legitimate for DISPLAY type only, which is
 * all a board may carry. "New Arrivals" → "N E W   A R R I V A L S".
 */
function trackedCaps(s: string): string {
  return s.toUpperCase().split("").join(" ");
}

// ---------------------------------------------------------------------------
// hero — 600×750 (04 §7: image + display line).
// ---------------------------------------------------------------------------

export const heroPayloadSchema = z.object({
  /** Board name = the campaign slot this board fills (defaults to "hero"). */
  slot: z.string().min(1).default("hero"),
  /** The display headline — brand serif, board-rasterized. Display type
   * only: body copy belongs in an html section below the board. */
  headline: z.string().min(1),
  /** Optional eyebrow above the headline — accent color, uppercase, tracked. */
  eyebrow: z.string().min(1).optional(),
  /** Optional full-bleed hero image (top ~61% of the board). */
  image: boardImageSchema.optional(),
});

export type HeroPayload = z.input<typeof heroPayloadSchema>;

/**
 * Full-bleed hero: token surface color to the board edges, optional imagery,
 * display headline (brand serif) + optional tracked eyebrow (accent).
 * Defaults on sparse tokens: white surface, near-black ink, Georgia-family
 * display stack (see ./brand-tokens fallback policy).
 */
export function hero(tokens: DtcgLikeTokens | undefined, payload: HeroPayload): EmailBoardSpec {
  const p = heroPayloadSchema.parse(payload);
  const t = resolveEmailBrandTheme(tokens);
  const { width, height } = EMAIL_BOARD_GEOMETRY.hero;
  const hasImage = p.image !== undefined;

  const elements: EmailComposeElement[] = [];
  if (p.image) {
    elements.push({
      type: "image",
      name: "hero-image",
      x: 0,
      y: 0,
      width,
      height: 460,
      data: p.image.data,
      mediaType: p.image.mediaType,
    });
  }
  if (p.eyebrow) {
    elements.push({
      type: "text",
      name: "eyebrow",
      x: TEXT_X,
      y: hasImage ? 505 : 280,
      width: TEXT_WIDTH,
      height: 24,
      characters: trackedCaps(p.eyebrow),
      fontId: t.bodyFontId,
      fontFamily: t.bodyFamily,
      fontSize: "13",
      fontWeight: "500",
      textAlign: "center",
      fills: [fill(t.accent)],
    });
  }
  elements.push({
    type: "text",
    name: "headline",
    x: TEXT_X,
    y: hasImage ? (p.eyebrow ? 545 : 525) : p.eyebrow ? 330 : 300,
    width: TEXT_WIDTH,
    height: hasImage ? 170 : 240,
    characters: p.headline,
    fontId: t.displayFontId,
    fontFamily: t.displayFamily,
    fontSize: "44",
    fontWeight: String(t.displayWeight),
    lineHeight: "1.15",
    textAlign: "center",
    fills: [fill(t.ink)],
  });

  return { name: p.slot, width, height, background: fill(t.surface), elements };
}

// ---------------------------------------------------------------------------
// promoBanner — 600×200.
// ---------------------------------------------------------------------------

export const promoBannerPayloadSchema = z.object({
  slot: z.string().min(1).default("promo-banner"),
  /** The single display line. */
  headline: z.string().min(1),
  /** Optional sub-line (tracked caps, accent where legible). */
  subline: z.string().min(1).optional(),
  /**
   * Which token color carries the band: "ink" (charcoal band, the winback
   * gift-band feel — default), "surface" (quiet parchment band), or
   * "accent" (loud; text ink is picked by luminance).
   */
  background: z.enum(["ink", "surface", "accent"]).default("ink"),
});

export type PromoBannerPayload = z.input<typeof promoBannerPayloadSchema>;

/**
 * Token background band with one display line + optional sub-line. The band
 * color reaches the board edges (dark-mode rule); text color is chosen for
 * legibility against the chosen band (ink band → surface text, surface band
 * → ink text, accent band → by luminance).
 */
export function promoBanner(
  tokens: DtcgLikeTokens | undefined,
  payload: PromoBannerPayload,
): EmailBoardSpec {
  const p = promoBannerPayloadSchema.parse(payload);
  const t = resolveEmailBrandTheme(tokens);
  const { width, height } = EMAIL_BOARD_GEOMETRY.promoBanner;

  const band = p.background === "ink" ? t.ink : p.background === "surface" ? t.surface : t.accent;
  const textColor =
    p.background === "ink"
      ? t.surface
      : p.background === "surface"
        ? t.ink
        : (approxLuminance(t.accent) ?? 0) > 0.6
          ? t.ink
          : t.surface;
  // Sub-line: accent pops on ink/surface bands; on an accent band it would
  // vanish, so it inherits the headline's ink.
  const sublineColor = p.background === "accent" ? textColor : t.accent;

  const elements: EmailComposeElement[] = [
    {
      type: "text",
      name: "headline",
      x: TEXT_X,
      y: p.subline ? 58 : 78,
      width: TEXT_WIDTH,
      height: 44,
      characters: p.headline,
      fontId: t.displayFontId,
      fontFamily: t.displayFamily,
      fontSize: "28",
      fontWeight: String(t.displayWeight),
      lineHeight: "1.2",
      textAlign: "center",
      fills: [fill(textColor)],
    },
  ];
  if (p.subline) {
    elements.push({
      type: "text",
      name: "subline",
      x: TEXT_X,
      y: 118,
      width: TEXT_WIDTH,
      height: 22,
      characters: trackedCaps(p.subline),
      fontId: t.bodyFontId,
      fontFamily: t.bodyFamily,
      fontSize: "12",
      fontWeight: "500",
      textAlign: "center",
      fills: [fill(sublineColor)],
    });
  }

  return { name: p.slot, width, height, background: fill(band), elements };
}

// ---------------------------------------------------------------------------
// productFeature — 600×740.
// ---------------------------------------------------------------------------

export const productFeaturePayloadSchema = z.object({
  slot: z.string().min(1).default("product-feature"),
  /** The product shot — required; it IS the section. */
  image: boardImageSchema,
  /** Optional display-name lockup under the shot (brand serif). A NAME
   * MOMENT, not product data — see the function JSDoc. */
  displayName: z.string().min(1).optional(),
});

export type ProductFeaturePayload = z.input<typeof productFeaturePayloadSchema>;

/**
 * Product shot matted on the token surface + optional display-name lockup.
 *
 * **Product name and price for the EMAIL stay OUT of this board** — they
 * render as an `html` `productRow` section below it (email-assembly's block
 * vocabulary), where they stay data-accurate at send time, readable by
 * screen readers, and editable without a re-export (04 §0/§7). The optional
 * `displayName` here is a brand lockup (display type), not the product data.
 */
export function productFeature(
  tokens: DtcgLikeTokens | undefined,
  payload: ProductFeaturePayload,
): EmailBoardSpec {
  const p = productFeaturePayloadSchema.parse(payload);
  const t = resolveEmailBrandTheme(tokens);
  const { width, height } = EMAIL_BOARD_GEOMETRY.productFeature;

  const elements: EmailComposeElement[] = [
    {
      type: "image",
      name: "product-image",
      x: 60,
      y: 56,
      width: width - 120,
      height: 520,
      data: p.image.data,
      mediaType: p.image.mediaType,
    },
  ];
  if (p.displayName) {
    elements.push({
      type: "text",
      name: "display-name",
      x: TEXT_X,
      y: 616,
      width: TEXT_WIDTH,
      height: 76,
      characters: p.displayName,
      fontId: t.displayFontId,
      fontFamily: t.displayFamily,
      fontSize: "28",
      fontWeight: String(t.displayWeight),
      lineHeight: "1.2",
      textAlign: "center",
      fills: [fill(t.ink)],
    });
  }

  return { name: p.slot, width, height, background: fill(t.surface), elements };
}

// ---------------------------------------------------------------------------
// editorialMoment — 600×600.
// ---------------------------------------------------------------------------

export const editorialMomentPayloadSchema = z.object({
  slot: z.string().min(1).default("editorial-moment"),
  /** The editorial image — required; the matting is the composition. */
  image: boardImageSchema,
});

export type EditorialMomentPayload = z.input<typeof editorialMomentPayloadSchema>;

/**
 * An image with generous token-colored matting — the Arthaus editorial
 * framing feel (art floated on parchment). No type at all: the mat and the
 * image are the whole statement.
 */
export function editorialMoment(
  tokens: DtcgLikeTokens | undefined,
  payload: EditorialMomentPayload,
): EmailBoardSpec {
  const p = editorialMomentPayloadSchema.parse(payload);
  const t = resolveEmailBrandTheme(tokens);
  const { width, height } = EMAIL_BOARD_GEOMETRY.editorialMoment;
  const mat = 72;

  return {
    name: p.slot,
    width,
    height,
    background: fill(t.surface),
    elements: [
      {
        type: "image",
        name: "editorial-image",
        x: mat,
        y: mat,
        width: width - mat * 2,
        height: height - mat * 2,
        data: p.image.data,
        mediaType: p.image.mediaType,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The vocabulary, addressable by section type.
// ---------------------------------------------------------------------------

/** The v1 template vocabulary keyed by section type (04 §7). */
export const emailComposeTemplates = {
  hero,
  promoBanner,
  productFeature,
  editorialMoment,
} as const;

export type EmailComposeTemplateName = keyof typeof emailComposeTemplates;

export type { DtcgLikeTokens, EmailBrandTheme };
