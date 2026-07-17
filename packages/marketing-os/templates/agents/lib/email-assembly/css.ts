/**
 * DTCG tokens → email-safe CSS (WS2-R4, 04 §4 "one source, two renderers").
 *
 * The same DESIGN.md-compiled token file that styles Penpot boards styles the
 * HTML sections, so a board and the paragraph below it agree by construction.
 * This module resolves a small `EmailTheme` from the token file and emits the
 * head-level `<style>` support block. Everything visual on rendered blocks is
 * INLINE (email clients — Gmail's non-primary contexts especially — strip or
 * ignore `<style>`); the `<style>` block carries only what CANNOT be inline:
 * media queries (mobile stacking, dark mode).
 *
 * ## Token lookup heuristics (documented honestly)
 *
 * DTCG names are brand-authored, so resolution is a lookup ORDER, not a
 * schema. First hit wins; every lookup degrades to an email-safe default when
 * nothing matches (the emitter must never fail on a sparse palette):
 *
 *   text        colors.text → .ink → .foreground → .body → .black   (#1a1a1a)
 *   background  colors.background → .paper → .surface → .white      (#ffffff)
 *   accent      components.button.backgroundColor → colors.accent →
 *               .primary → .brand                                   (= text)
 *   accent text components.button.textColor → .color → by luminance of accent
 *   radius      components.button.rounded → rounded.button → .md → .sm (4px)
 *   gutter      spacing.gutter → .md → .base                        (24px)
 *   heading     typography.heading → .display → .h1 → .title
 *   body        typography.body → .paragraph → .text → .base
 *
 * Aliases (`{colors.paper}`) resolve set-relative across all sets, exactly as
 * brand-md emits them; resolution is depth-capped at 8 (cycles degrade to the
 * default rather than looping).
 *
 * ## Dark-safe pairs (04 §5c — damage control, not control)
 *
 * A dark override block is emitted ONLY when the palette actually defines a
 * coherent dark pair. We look, in order:
 *   1. explicit dark tokens in any set: `colors.background-dark` /
 *      `backgroundDark` / `dark-background` plus the matching `text-dark`
 *      family — both must exist (a background without a legible ink is worse
 *      than nothing);
 *   2. a token SET whose name contains "dark" (brand-md compiles a
 *      `themes: { dark: … }` DESIGN.md entry to such a set) providing its own
 *      `colors.background`/`colors.text`.
 * When absent we still emit `color-scheme` metas (declaring support stops
 * some clients from force-inverting) but no overrides — degrade gracefully.
 * Overrides only touch OUR classes (`.eab-text`, `.eab-heading`, `.eab-meta`):
 * the skeleton's frame is the store's own proven HTML and we never restyle it.
 *
 * ## Font stacks
 *
 * Outlook (Word engine) ignores web fonts and falls back unpredictably unless
 * a system family is present, so every emitted stack is guaranteed to end in
 * a generic family: if the token stack lacks one we append a serif or sans
 * fallback chosen by a crude name sniff (Georgia/Canela/Playfair/etc → serif).
 * Brand-critical type moments belong in boards, where the font is rasterized
 * (04 §5a).
 */

import type { DtcgTokensFile } from "./types";

// ---------------------------------------------------------------------------
// Theme shape consumed by renderers.ts.
// ---------------------------------------------------------------------------

export interface EmailTheme {
  bodyFontStack: string;
  headingFontStack: string;
  /** Body copy size in px. */
  bodyFontSize: number;
  /** Level-1 heading size in px (levels 2/3 derived in the renderer). */
  headingFontSize: number;
  /** Unitless body line-height (rendered as px for Outlook determinism). */
  bodyLineHeight: number;
  headingWeight: number;
  textColor: string;
  backgroundColor: string;
  accentColor: string;
  accentTextColor: string;
  buttonRadiusPx: number;
  /** Horizontal padding applied by block renderers, in px. */
  gutterPx: number;
  /** Present only when the palette defines a coherent dark pair. */
  dark: { textColor: string; backgroundColor: string } | null;
}

// ---------------------------------------------------------------------------
// Token flattening + alias resolution.
// ---------------------------------------------------------------------------

interface FlatToken {
  type: string;
  value: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Root entries that are token sets (skip `$description`, `$themes`, …). */
function tokenSets(file: DtcgTokensFile): Array<[string, Record<string, unknown>]> {
  const sets: Array<[string, Record<string, unknown>]> = [];
  for (const [key, value] of Object.entries(file)) {
    if (key.startsWith("$")) continue;
    if (isPlainObject(value)) sets.push([key, value]);
  }
  return sets;
}

function flattenGroup(
  group: Record<string, unknown>,
  prefix: string,
  out: Map<string, FlatToken>,
): void {
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

const ALIAS_RE = /^\{([^{}]+)\}$/;

/** Resolve `{colors.paper}`-style aliases against the flattened union map. */
function resolveValue(value: unknown, map: Map<string, FlatToken>, depth = 0): unknown {
  if (depth > 8 || typeof value !== "string") return value;
  const m = ALIAS_RE.exec(value);
  if (!m || m[1] === undefined) return value;
  const target = map.get(m[1]);
  if (!target) return undefined; // dangling alias — caller falls to default
  return resolveValue(target.value, map, depth + 1);
}

function lookupString(
  map: Map<string, FlatToken>,
  paths: string[],
  wantType?: string,
): string | undefined {
  for (const path of paths) {
    const token = map.get(path);
    if (!token) continue;
    if (wantType && token.type && token.type !== wantType) continue;
    const resolved = resolveValue(token.value, map);
    if (typeof resolved === "string" && resolved.trim()) return resolved.trim();
  }
  return undefined;
}

/** `"24px"` → 24; bare numbers pass through; anything else → undefined. */
function parsePx(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
    if (m && m[1] !== undefined) return Number(m[1]);
  }
  return undefined;
}

function lookupPx(map: Map<string, FlatToken>, paths: string[]): number | undefined {
  for (const path of paths) {
    const token = map.get(path);
    if (!token) continue;
    const px = parsePx(resolveValue(token.value, map));
    if (px !== undefined) return px;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Font stacks.
// ---------------------------------------------------------------------------

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
]);

/** Crude serif sniff — see module JSDoc; wrong guesses still yield a legible stack. */
const SERIF_HINT =
  /serif|georgia|times|garamond|didot|baskerville|caslon|canela|freight|playfair|palatino|bodoni|tiempos/i;

function quoteFamily(name: string): string {
  return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(name) ? name : `'${name.replace(/'/g, "")}'`;
}

/**
 * Token fontFamily (array or comma string) → CSS stack guaranteed to end in
 * a generic family (Outlook fallback discipline).
 */
export function toCssFontStack(families: unknown, fallback: "serif" | "sans-serif"): string {
  let names: string[] = [];
  if (Array.isArray(families)) {
    names = families.map((f) => String(f).trim()).filter(Boolean);
  } else if (typeof families === "string" && families.trim()) {
    names = families
      .split(",")
      .map((f) => f.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  if (names.length === 0) {
    return fallback === "serif"
      ? "Georgia, 'Times New Roman', serif"
      : "Helvetica, Arial, sans-serif";
  }
  const last = names[names.length - 1];
  if (last === undefined || !GENERIC_FAMILIES.has(last.toLowerCase())) {
    const wantsSerif = names.some((n) => SERIF_HINT.test(n)) || fallback === "serif";
    names = names.concat(
      wantsSerif ? ["Georgia", "Times New Roman", "serif"] : ["Helvetica", "Arial", "sans-serif"],
    );
  }
  return names.map(quoteFamily).join(", ");
}

// ---------------------------------------------------------------------------
// Color helpers.
// ---------------------------------------------------------------------------

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Approximate relative luminance (0–1) of a hex color. Deliberately simple
 * (no sRGB linearization) — it only picks black-vs-white button ink, where
 * the crude luma answer matches the correct one for any sane brand accent.
 */
export function approxLuminance(hex: string): number | undefined {
  const m = HEX_RE.exec(hex.trim());
  if (!m || m[1] === undefined) return undefined;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------
// Theme resolution.
// ---------------------------------------------------------------------------

interface TypographyPick {
  stack?: string;
  sizePx?: number;
  weight?: number;
  lineHeight?: number;
}

function lookupTypography(
  map: Map<string, FlatToken>,
  paths: string[],
  fallbackGeneric: "serif" | "sans-serif",
): TypographyPick {
  for (const path of paths) {
    const token = map.get(path);
    if (!token || token.type !== "typography" || !isPlainObject(token.value)) continue;
    const v = token.value;
    const pick: TypographyPick = {};
    if (v.fontFamily !== undefined) {
      pick.stack = toCssFontStack(resolveValue(v.fontFamily, map), fallbackGeneric);
    }
    const size = parsePx(resolveValue(v.fontSize, map));
    if (size !== undefined) pick.sizePx = size;
    const weight = Number(resolveValue(v.fontWeight, map));
    if (Number.isFinite(weight) && weight > 0) pick.weight = weight;
    const lh = Number(resolveValue(v.lineHeight, map));
    if (Number.isFinite(lh) && lh > 0 && lh < 4) pick.lineHeight = lh;
    return pick;
  }
  return {};
}

/**
 * Resolve an `EmailTheme` from a DTCG tokens file (brand-md
 * `compileDesignTokens` output). Pure; degrades to email-safe defaults for
 * every missing token (see module JSDoc for the exact lookup orders).
 */
export function resolveEmailTheme(tokens?: DtcgTokensFile): EmailTheme {
  const map = new Map<string, FlatToken>();
  const darkMap = new Map<string, FlatToken>();
  let hasDarkSet = false;
  if (tokens) {
    for (const [setName, set] of tokenSets(tokens)) {
      // Base sets flatten into the main map; sets named *dark* flatten into
      // the dark map ONLY (they layer over global, so the main map must NOT
      // be polluted by them — dark backgrounds would win base lookups).
      if (/dark/i.test(setName)) {
        hasDarkSet = true;
        flattenGroup(set, "", darkMap);
      } else {
        flattenGroup(set, "", map);
      }
    }
    // Dark-set aliases may point at global tokens; give darkMap read access.
    for (const [k, v] of map) if (!darkMap.has(k)) darkMap.set(k, v);
  }

  const textColor =
    lookupString(map, ["colors.text", "colors.ink", "colors.foreground", "colors.body", "colors.black"], "color") ??
    "#1a1a1a";
  const backgroundColor =
    lookupString(map, ["colors.background", "colors.paper", "colors.surface", "colors.white"], "color") ??
    "#ffffff";
  const accentColor =
    lookupString(
      map,
      ["components.button.backgroundColor", "colors.accent", "colors.primary", "colors.brand"],
      "color",
    ) ?? textColor;
  const accentTextColor =
    lookupString(map, ["components.button.textColor", "components.button.color"], "color") ??
    ((approxLuminance(accentColor) ?? 0) > 0.6 ? "#111111" : "#ffffff");

  const heading = lookupTypography(
    map,
    ["typography.heading", "typography.display", "typography.h1", "typography.title"],
    "serif",
  );
  const body = lookupTypography(
    map,
    ["typography.body", "typography.paragraph", "typography.text", "typography.base"],
    "sans-serif",
  );

  // Dark pair: explicit *-dark color tokens first, then a dark set's own pair.
  const darkText =
    lookupString(map, ["colors.text-dark", "colors.textDark", "colors.dark-text"], "color") ??
    (hasDarkSet
      ? lookupString(darkMap, ["colors.text", "colors.ink", "colors.foreground"], "color")
      : undefined);
  const darkBackground =
    lookupString(map, ["colors.background-dark", "colors.backgroundDark", "colors.dark-background"], "color") ??
    (hasDarkSet
      ? lookupString(darkMap, ["colors.background", "colors.paper", "colors.surface"], "color")
      : undefined);

  return {
    bodyFontStack: body.stack ?? toCssFontStack(undefined, "sans-serif"),
    headingFontStack: heading.stack ?? toCssFontStack(undefined, "serif"),
    bodyFontSize: body.sizePx ?? 16,
    headingFontSize: heading.sizePx ?? 32,
    bodyLineHeight: body.lineHeight ?? 1.5,
    headingWeight: heading.weight ?? 700,
    textColor,
    backgroundColor,
    accentColor,
    accentTextColor,
    buttonRadiusPx:
      lookupPx(map, ["components.button.rounded", "rounded.button", "rounded.md", "rounded.sm"]) ?? 4,
    gutterPx: lookupPx(map, ["spacing.gutter", "spacing.md", "spacing.base"]) ?? 24,
    dark: darkText && darkBackground ? { textColor: darkText, backgroundColor: darkBackground } : null,
  };
}

// ---------------------------------------------------------------------------
// Head emission.
// ---------------------------------------------------------------------------

/**
 * `color-scheme` metas: declaring both schemes tells Apple Mail / iOS Mail
 * to respect our `prefers-color-scheme` styles instead of auto-inverting,
 * and is harmless where unsupported. Injected once (assemble.ts skips it if
 * the skeleton already declares one).
 */
export const COLOR_SCHEME_META =
  `<meta name="color-scheme" content="light dark">\n` +
  `<meta name="supported-color-schemes" content="light dark">`;

/**
 * The head `<style>` support block: ONLY what cannot be inlined.
 *
 * - Mobile stacking for `.eab-col` (productRow columns) — Gmail iOS/Android
 *   and Apple Mail honor this; Outlook Windows never sees it (it renders the
 *   MSO ghost-table fallback instead, which does not stack — accepted).
 * - Dark overrides for our own text classes, only when the palette defines a
 *   dark pair. `!important` is required: inline styles otherwise win over
 *   media-query rules by specificity of origin.
 */
export function emitEmailStyles(theme: EmailTheme): string {
  const lines: string[] = [
    `<style type="text/css">`,
    `/* @avant-garde/email-assembly renderer support styles */`,
    `@media only screen and (max-width:480px){`,
    `.eab-col{width:100% !important;max-width:100% !important;display:block !important;}`,
    `}`,
  ];
  if (theme.dark) {
    lines.push(
      `@media (prefers-color-scheme: dark){`,
      // Only OUR ink flips. The skeleton's frame backgrounds are the store's
      // own proven HTML — restyling them from here would fight whatever
      // dark-mode handling the source template already carries (04 §5c:
      // damage control, not control).
      `.eab-text,.eab-heading,.eab-meta{color:${theme.dark.textColor} !important;}`,
      `}`,
    );
  }
  lines.push(`</style>`);
  return lines.join("\n");
}
