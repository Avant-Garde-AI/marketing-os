/**
 * DTCG token resolution for the email pack (WS2-R2 compose templates +
 * WS2-R6 scaffold) — one token source, two renderers (04 §4).
 *
 * The base theme (surface/ink/accent-button/typography) comes from
 * `@avant-garde/email-assembly`'s `resolveEmailTheme`, so a composed board
 * and the HTML paragraph below it agree by construction. This module layers
 * the email pack's ADDITIONAL lookups on top (display accent, muted ink,
 * border, card surface, mono stack, the full palette listing) using the same
 * conventions: lookup ORDER over schema, alias resolution depth-capped at 8,
 * and an email-safe default for every miss — sparse tokens NEVER throw.
 *
 * ## Token fallback policy (documented once, tested)
 *
 *   surface   colors.background → .paper → .surface → .white        #ffffff
 *   ink       colors.text → .ink → .foreground → .body → .black     #1a1a1a
 *   accent    colors.accent → .primary → .brand → button bg → ink
 *             (display accent — eyebrows, rules; distinct from the BUTTON
 *             accent, which for many brands is the ink itself)
 *   muted     colors.text-secondary → .textSecondary → .muted →
 *             .secondary → .gray                                    = ink
 *   border    colors.border → .divider → .line → .rule              #e5e5e5
 *   card      colors.background-transactional → .card → .white →
 *             components.card.backgroundColor                       #ffffff
 *   display   typography.heading → .display → .h1 → .title          Georgia
 *   body      typography.body → .paragraph → .text → .base          Helvetica
 *   mono      typography.specs → .mono → .code                      (omitted)
 *
 * Font ids follow Penpot's Google-font scheme (`gfont-<slug>` from the
 * FIRST family in the token stack) — matching design-surfaces' own
 * derivation in compose.ts `textStyle`. Non-Google families degrade to a
 * gfont id that Penpot resolves to its default; brand-critical rasterized
 * type is exactly why boards exist (04 §5a), and per-team font upload is a
 * tracked open question (WS2 OQ3).
 */

import { resolveEmailTheme, toCssFontStack, type EmailTheme } from "@avant-garde/email-assembly";

/**
 * A DTCG tokens file as produced by @avant-garde/brand-md's
 * `compileDesignTokens` (packages/brand-md/src/dtcg.ts). Structural — any
 * conforming W3C DTCG file works; the pack deliberately does not depend on
 * brand-md (the token file is an open format, not a brand-md-private shape).
 */
export type DtcgLikeTokens = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Flatten + alias resolution (same semantics as email-assembly's css.ts).
// ---------------------------------------------------------------------------

interface FlatToken {
  type: string;
  value: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function flattenGroup(group: Record<string, unknown>, prefix: string, out: Map<string, FlatToken>): void {
  for (const [name, node] of Object.entries(group)) {
    if (name.startsWith("$") || !isPlainObject(node)) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    if ("$value" in node) {
      out.set(path, { type: String(node.$type ?? ""), value: node.$value });
    } else {
      flattenGroup(node, path, out);
    }
  }
}

/** Flatten every non-`$` root set into one path → token map (union; theme
 * sets layer over global exactly as brand-md emits them, but dark sets are
 * excluded from base lookups — a dark background must never win a light
 * lookup). */
function flattenTokens(tokens?: DtcgLikeTokens): Map<string, FlatToken> {
  const map = new Map<string, FlatToken>();
  if (!tokens) return map;
  for (const [key, value] of Object.entries(tokens)) {
    if (key.startsWith("$") || /dark/i.test(key) || !isPlainObject(value)) continue;
    flattenGroup(value, "", map);
  }
  return map;
}

const ALIAS_RE = /^\{([^{}]+)\}$/;

/** Resolve `{colors.bronze}`-style aliases; depth-capped at 8 (cycles fall
 * through to the caller's default rather than looping). */
function resolveValue(value: unknown, map: Map<string, FlatToken>, depth = 0): unknown {
  if (depth > 8 || typeof value !== "string") return value;
  const m = ALIAS_RE.exec(value);
  if (!m || m[1] === undefined) return value;
  const target = map.get(m[1]);
  if (!target) return undefined;
  return resolveValue(target.value, map, depth + 1);
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function lookupColor(map: Map<string, FlatToken>, paths: string[]): string | undefined {
  for (const path of paths) {
    const token = map.get(path);
    if (!token) continue;
    const resolved = resolveValue(token.value, map);
    if (typeof resolved === "string" && HEX_RE.test(resolved.trim())) return resolved.trim();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The pack-level theme.
// ---------------------------------------------------------------------------

export interface EmailBrandTheme {
  /** The email-assembly base theme (surface/ink/button-accent/typography). */
  base: EmailTheme;
  /** Board + email background — token surface family (see fallback policy). */
  surface: string;
  /** Primary text / display ink. */
  ink: string;
  /** DISPLAY accent (eyebrows, rules, sub-lines) — colors.accent family
   * first, so brands whose button is simply their ink (Arthaus) still get
   * their true accent (bronze) on display moments. */
  accent: string;
  /** Secondary/quiet text. */
  muted: string;
  /** Hairline rules and card borders. */
  border: string;
  /** Card/panel background (transactional register when the brand has one). */
  card: string;
  /** First family of the display stack (Penpot fontFamily is one family). */
  displayFamily: string;
  /** Penpot font id for the display family (`gfont-<slug>`). */
  displayFontId: string;
  /** Full CSS display stack, guaranteed generic-terminated. */
  displayStack: string;
  displayWeight: number;
  /** First family of the body stack. */
  bodyFamily: string;
  bodyFontId: string;
  bodyStack: string;
  /** Mono stack when the brand defines one (specs/mono/code); else null. */
  monoStack: string | null;
  /** Every `colors.*` token that resolves to a hex, in declaration order. */
  palette: { name: string; hex: string }[];
}

/** `"'Freight Display', Georgia, serif"` → `"Freight Display"`. */
function firstFamily(stack: string): string {
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^['"]|['"]$/g, "");
}

/** Penpot Google-font id from a family name — same scheme as design-surfaces
 * compose.ts `textStyle` derives when fontId is omitted. */
export function gfontId(family: string): string {
  return `gfont-${family.toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * Resolve the pack's `EmailBrandTheme` from a DTCG tokens file. Pure and
 * total: sparse or absent tokens degrade to the documented defaults, never
 * throw.
 */
export function resolveEmailBrandTheme(tokens?: DtcgLikeTokens): EmailBrandTheme {
  const base = resolveEmailTheme(tokens);
  const map = flattenTokens(tokens);

  const ink = base.textColor;
  const accent =
    lookupColor(map, ["colors.accent", "colors.primary", "colors.brand"]) ?? base.accentColor;
  const muted =
    lookupColor(map, [
      "colors.text-secondary",
      "colors.textSecondary",
      "colors.muted",
      "colors.secondary",
      "colors.gray",
    ]) ?? ink;
  const border = lookupColor(map, ["colors.border", "colors.divider", "colors.line", "colors.rule"]) ?? "#e5e5e5";
  const card =
    lookupColor(map, [
      "colors.background-transactional",
      "colors.card",
      "colors.white",
      "components.card.backgroundColor",
    ]) ?? "#ffffff";

  // Mono stack (optional — omitted rather than defaulted; a fake mono stack
  // helps nobody).
  let monoStack: string | null = null;
  for (const path of ["typography.specs", "typography.mono", "typography.code"]) {
    const token = map.get(path);
    if (token && token.type === "typography" && isPlainObject(token.value) && token.value.fontFamily !== undefined) {
      monoStack = toCssFontStack(resolveValue(token.value.fontFamily, map), "sans-serif");
      if (!/monospace/.test(monoStack)) monoStack = `${monoStack.replace(/, (sans-)?serif$/, "")}, monospace`;
      break;
    }
  }

  const palette: { name: string; hex: string }[] = [];
  for (const [path, token] of map) {
    if (!path.startsWith("colors.")) continue;
    const name = path.slice("colors.".length);
    if (name.includes(".")) continue; // nested groups stay out of the flat table
    const resolved = resolveValue(token.value, map);
    if (typeof resolved === "string" && HEX_RE.test(resolved.trim())) {
      palette.push({ name, hex: resolved.trim() });
    }
  }

  const displayFamily = firstFamily(base.headingFontStack);
  const bodyFamily = firstFamily(base.bodyFontStack);

  return {
    base,
    surface: base.backgroundColor,
    ink,
    accent,
    muted,
    border,
    card,
    displayFamily,
    displayFontId: gfontId(displayFamily),
    displayStack: base.headingFontStack,
    displayWeight: base.headingWeight,
    bodyFamily,
    bodyFontId: gfontId(bodyFamily),
    bodyStack: base.bodyFontStack,
    monoStack,
    palette,
  };
}
