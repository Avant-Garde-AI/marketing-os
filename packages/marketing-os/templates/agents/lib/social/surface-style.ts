/**
 * DESIGN.md tokens → the type and colour a composed archetype is drawn in.
 *
 * The split this preserves is spec 24's, and it is the whole reason a genome
 * is safe to consult: THE GENOME GIVES STRUCTURE, THE BRAND GIVES EVERYTHING
 * VISIBLE. An archetype says "a band across the bottom sixth with one line of
 * type in it" and never what colour the band is or what the line is set in.
 * Invert that and you have composed a competent imitation of the market
 * average, which for a brand whose value is distinctiveness is a net loss.
 *
 * Every token is optional and every fallback is neutral, because a store with
 * a sparse DESIGN.md must still compose. The fallbacks are deliberately plain
 * — near-black on white, a system serif — so an unstyled surface looks
 * unfinished rather than looking like some other brand's house style.
 */

import type { SurfaceStyle, TextStyle } from "./archetype-surface";

/** A compiled DTCG token tree (lib/design-surfaces/dtcg compileDesignTokens). */
type Tokens = Record<string, unknown>;

function tokenValue(tokens: Tokens | undefined, group: string, name: string): string | undefined {
  const g = tokens?.[group] as Record<string, unknown> | undefined;
  const t = g?.[name] as { $value?: unknown } | undefined;
  return typeof t?.$value === "string" ? t.$value : undefined;
}

/** First colour token present, by preference order. */
function firstColor(tokens: Tokens | undefined, names: string[]): string | undefined {
  for (const n of names) {
    const v = tokenValue(tokens, "color", n);
    if (v?.startsWith("#")) return v;
  }
  return undefined;
}

/**
 * Penpot font id from a family stack, matching design-surfaces' own scheme
 * (`gfont-<slug>` of the FIRST family). Kept identical on purpose: a mismatch
 * here shows up as a silently substituted typeface in the export, which reads
 * as a design choice rather than a bug.
 */
function fontFromStack(stack: string | undefined): { fontFamily: string; fontId: string } | undefined {
  const first = stack?.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  if (!first) return undefined;
  return { fontFamily: first, fontId: `gfont-${first.toLowerCase().replace(/\s+/g, "-")}` };
}

const FALLBACK_SERIF = { fontFamily: "Georgia", fontId: "gfont-georgia" };
const FALLBACK_SANS = { fontFamily: "Inter", fontId: "gfont-inter" };

/**
 * Build the style a surface is composed in from the store's tokens.
 *
 * Role assignment follows the genome's own vocabulary: `headline` and
 * `statement` are display type (the store's display face); `eyebrow`,
 * `subhead` and `body` are supporting type at the muted ink. Roles the genome
 * adds later inherit `defaultText` rather than throwing — an unknown role
 * should render plainly, not fail a compose.
 */
export function surfaceStyleFromTokens(tokens?: Tokens): SurfaceStyle {
  const ground = firstColor(tokens, ["warm-parchment", "background", "surface", "background-primary"]) ?? "#FFFFFF";
  const ink = firstColor(tokens, ["charcoal", "ink", "text", "deep-ink", "foreground"]) ?? "#1A1A1A";
  const muted = firstColor(tokens, ["warm-gray", "muted", "secondary", "text-secondary"]) ?? ink;

  const display = fontFromStack(tokenValue(tokens, "typography", "display")) ?? FALLBACK_SERIF;
  const body = fontFromStack(tokenValue(tokens, "typography", "body")) ?? FALLBACK_SANS;

  const displayText: TextStyle = { ...display, color: ink, fontWeight: "500" };
  const supporting: TextStyle = { ...body, color: muted };

  return {
    background: { fillColor: ground, fillOpacity: 1 },
    bandColor: ground,
    defaultText: { ...body, color: ink, textAlign: "left" },
    roles: {
      headline: { ...displayText, textAlign: "left" },
      statement: { ...displayText, textAlign: "center" },
      subhead: { ...supporting, textAlign: "center" },
      eyebrow: { ...supporting, textAlign: "left" },
      body: { ...supporting, textAlign: "center" },
    },
  };
}
