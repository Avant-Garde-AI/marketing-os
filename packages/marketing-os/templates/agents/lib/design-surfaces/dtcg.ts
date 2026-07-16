/**
 * Vendored from marketing-os packages/brand-md (src/dtcg.ts + the front-matter
 * parser it needs from src/parse.ts + LintFinding from src/types.ts) @
 * 2026-07-16 — npm publish blocked (no auth); replace with
 * @avant-garde/brand-md when published. Do not edit here without porting back.
 *
 * DESIGN.md → W3C DTCG design-tokens compiler (spec 23 §5, Stage 6 DISTRIBUTE).
 *
 * Compiles the machine-readable front matter of a Google-spec DESIGN.md
 * (the brand manifest's "body" document, sibling of brand.md) into a
 * W3C Design Tokens Community Group JSON file that Penpot imports natively.
 *
 * Mapping (DESIGN.md front-matter key → DTCG):
 *   colors.*              → `color` tokens
 *   typography.*          → composite `typography` tokens (fontFamily CSS
 *                           stacks parsed into arrays; fontSize/letterSpacing
 *                           as dimension strings; lineHeight as number;
 *                           fontWeight as number)
 *   spacing.* / rounded.* → `dimension` tokens
 *   components.*.<prop>   → per-property tokens (backgroundColor/textColor →
 *                           color; height/width/padding/rounded → dimension;
 *                           fontWeight → fontWeight; …)
 *
 * DESIGN.md's own alias syntax ("{colors.bronze}") is already DTCG alias
 * syntax; category/group names are preserved verbatim so references survive
 * the compile untouched.
 *
 * Sets & themes: token categories land in a single "global" set unless the
 * front matter carries a `themes:` mapping (per-register overrides — e.g.
 * editorial vs interactive), in which case each theme compiles to its own
 * set layered over global via a `$themes` entry (the Tokens Studio-style
 * multi-set shape Penpot understands). The Arthaus example encodes its two
 * registers as named color tokens (`background` vs `background-transactional`)
 * rather than structured themes, so it compiles to the single default set.
 *
 * Provenance: root `$extensions["com.marketingos"]` records the source
 * document's name/version and a caller-supplied `compiledAt` — the library
 * never reads the clock itself. Front-matter fields with no clean DTCG
 * mapping are recorded under the same extension as `unmapped`.
 */

import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Inlined from brand-md src/types.ts (finding shape) and src/parse.ts (the
// front-matter parser — only the frontMatter field is consumed here).
// ---------------------------------------------------------------------------

export type LintSeverity = "error" | "warning" | "info";

export interface LintFinding {
  rule: string;
  severity: LintSeverity;
  message: string;
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse a front-matter markdown document (YAML front matter). Mirrors
 * brand-md's parseFrontMatterDocument, trimmed to the fields the compiler
 * consumes. `docName` labels error messages only.
 */
function parseFrontMatterDocument(raw: string, docName = "DESIGN.md"): { frontMatter: Record<string, unknown> } {
  const m = raw.match(FRONT_MATTER_RE);
  if (!m) throw new Error(`${docName}: missing YAML front matter (--- ... ---)`);
  let frontMatter: Record<string, unknown>;
  try {
    frontMatter = parseYaml(m[1]) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${docName}: invalid front matter YAML: ${e instanceof Error ? e.message : e}`);
  }
  if (!frontMatter || typeof frontMatter !== "object") {
    throw new Error(`${docName}: front matter is not a mapping`);
  }
  if (!frontMatter.name) throw new Error(`${docName}: front matter \`name\` is required`);
  return { frontMatter };
}

// ---------------------------------------------------------------------------
// DESIGN.md front-matter shape (Google DESIGN.md spec, as instantiated by the
// Arthaus example).
// ---------------------------------------------------------------------------

export interface DesignTypographyStyle {
  fontFamily?: string;
  fontSize?: string | number;
  fontWeight?: number | string;
  lineHeight?: number | string;
  letterSpacing?: string | number;
  [key: string]: unknown;
}

export interface DesignFrontMatter {
  name?: string;
  version?: string | number;
  description?: string;
  spec?: string;
  colors?: Record<string, string>;
  typography?: Record<string, DesignTypographyStyle>;
  spacing?: Record<string, string | number>;
  rounded?: Record<string, string | number>;
  components?: Record<string, Record<string, unknown>>;
  /** Optional per-register/theme overrides: theme name → partial categories. */
  themes?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// DTCG output shape.
// ---------------------------------------------------------------------------

export type DtcgType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "number"
  | "typography";

export interface DtcgToken {
  $type: DtcgType;
  $value: unknown;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

export interface DtcgGroup {
  $description?: string;
  $extensions?: Record<string, unknown>;
  [name: string]: DtcgToken | DtcgGroup | string | Record<string, unknown> | undefined;
}

export interface DtcgTheme {
  id: string;
  name: string;
  selectedTokenSets: Record<string, "enabled" | "source" | "disabled">;
}

export interface MarketingOsProvenance {
  source: "DESIGN.md";
  designMdName?: string;
  designMdVersion?: string | number;
  designMdSpec?: string;
  /** Caller-supplied ISO timestamp; omitted when not provided. */
  compiledAt?: string;
  /** Front-matter paths that had no clean DTCG mapping. */
  unmapped?: string[];
}

export interface DtcgTokensFile {
  $description?: string;
  $extensions?: { "com.marketingos": MarketingOsProvenance; [key: string]: unknown };
  $metadata?: { tokenSetOrder: string[] };
  $themes?: DtcgTheme[];
  [setName: string]:
    | DtcgGroup
    | DtcgTheme[]
    | { tokenSetOrder: string[] }
    | { "com.marketingos": MarketingOsProvenance }
    | string
    | undefined;
}

export interface CompileOptions {
  /**
   * ISO timestamp recorded in provenance. Must be supplied by the caller —
   * the compiler never generates one (deterministic output for a given input).
   */
  compiledAt?: string;
}

// ---------------------------------------------------------------------------
// Compile helpers.
// ---------------------------------------------------------------------------

const ALIAS_RE = /^\{[^{}]+\}$/;

function isAlias(v: unknown): v is string {
  return typeof v === "string" && ALIAS_RE.test(v);
}

/** Bare numbers in dimension positions are treated as px, per DESIGN.md usage. */
function dimensionValue(v: string | number): string {
  return typeof v === "number" ? `${v}px` : v;
}

/** "Canela, 'Freight Display', serif" → ["Canela", "Freight Display", "serif"]. */
function parseFontStack(stack: string): string[] | string {
  if (ALIAS_RE.test(stack)) return stack;
  return stack
    .split(",")
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

/** Component/style property → DTCG type. Unknown properties fall to inference. */
const COMPONENT_PROP_TYPES: Record<string, DtcgType> = {
  backgroundColor: "color",
  textColor: "color",
  color: "color",
  borderColor: "color",
  height: "dimension",
  width: "dimension",
  padding: "dimension",
  margin: "dimension",
  gap: "dimension",
  rounded: "dimension",
  fontSize: "dimension",
  letterSpacing: "dimension",
  fontWeight: "fontWeight",
  lineHeight: "number",
  fontFamily: "fontFamily",
};

const HEX_RE = /^#[0-9a-f]{3,8}$/i;
const DIMENSION_RE = /^-?\d*\.?\d+(px|em|rem|%)$/;

function inferType(prop: string, value: unknown): DtcgType | undefined {
  const mapped = COMPONENT_PROP_TYPES[prop];
  if (mapped) return mapped;
  if (typeof value === "string" && HEX_RE.test(value)) return "color";
  if (isAlias(value)) {
    const root = value.slice(1, -1).split(".")[0];
    if (root === "colors") return "color";
    if (root === "spacing" || root === "rounded") return "dimension";
    return undefined;
  }
  if (typeof value === "string" && DIMENSION_RE.test(value)) return "dimension";
  if (typeof value === "number") return "number";
  return undefined;
}

function shapeValue(type: DtcgType, value: unknown): unknown {
  if (isAlias(value)) return value; // aliases pass through untouched
  switch (type) {
    case "color":
      return String(value);
    case "dimension":
      return dimensionValue(value as string | number);
    case "fontFamily":
      return parseFontStack(String(value));
    default:
      return value;
  }
}

function token(type: DtcgType, value: unknown): DtcgToken {
  return { $type: type, $value: shapeValue(type, value) };
}

function compileTypographyStyle(style: DesignTypographyStyle): DtcgToken {
  const value: Record<string, unknown> = {};
  if (style.fontFamily != null) value.fontFamily = parseFontStack(String(style.fontFamily));
  if (style.fontSize != null) value.fontSize = dimensionValue(style.fontSize);
  if (style.fontWeight != null) value.fontWeight = style.fontWeight;
  if (style.lineHeight != null) value.lineHeight = style.lineHeight;
  if (style.letterSpacing != null) value.letterSpacing = dimensionValue(style.letterSpacing);
  return { $type: "typography", $value: value };
}

/**
 * Compile one bundle of token categories (the front matter itself, or a
 * theme's override bundle) into a DTCG token set. `pathPrefix` labels
 * unmapped findings (e.g. "themes.editorial.").
 */
function compileCategories(
  src: Record<string, unknown>,
  unmapped: string[],
  pathPrefix = "",
): DtcgGroup {
  const set: DtcgGroup = {};

  const colors = src.colors as Record<string, unknown> | undefined;
  if (colors) {
    const group: DtcgGroup = {};
    for (const [name, value] of Object.entries(colors)) group[name] = token("color", value);
    set.colors = group;
  }

  const typography = src.typography as Record<string, DesignTypographyStyle> | undefined;
  if (typography) {
    const group: DtcgGroup = {};
    for (const [name, style] of Object.entries(typography)) {
      if (!style || typeof style !== "object") {
        unmapped.push(`${pathPrefix}typography.${name}`);
        continue;
      }
      group[name] = compileTypographyStyle(style);
      for (const key of Object.keys(style)) {
        if (!(key in COMPONENT_PROP_TYPES)) unmapped.push(`${pathPrefix}typography.${name}.${key}`);
      }
    }
    set.typography = group;
  }

  for (const category of ["spacing", "rounded"] as const) {
    const entries = src[category] as Record<string, string | number> | undefined;
    if (!entries) continue;
    const group: DtcgGroup = {};
    for (const [name, value] of Object.entries(entries)) group[name] = token("dimension", value);
    set[category] = group;
  }

  const components = src.components as Record<string, Record<string, unknown>> | undefined;
  if (components) {
    const group: DtcgGroup = {};
    for (const [componentName, props] of Object.entries(components)) {
      if (!props || typeof props !== "object") {
        unmapped.push(`${pathPrefix}components.${componentName}`);
        continue;
      }
      const componentGroup: DtcgGroup = {};
      for (const [prop, value] of Object.entries(props)) {
        const type = inferType(prop, value);
        if (!type) {
          unmapped.push(`${pathPrefix}components.${componentName}.${prop}`);
          continue;
        }
        componentGroup[prop] = token(type, value);
      }
      group[componentName] = componentGroup;
    }
    set.components = group;
  }

  return set;
}

/** Front-matter keys the compiler consumes (everything else is `unmapped`). */
const HANDLED_KEYS = new Set([
  "name",
  "version",
  "description",
  "spec",
  "colors",
  "typography",
  "spacing",
  "rounded",
  "components",
  "themes",
]);

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Compile a DESIGN.md document (raw markdown with YAML front matter) into a
 * W3C DTCG design-tokens file ready for Penpot import.
 */
export function compileDesignTokens(
  designMdContent: string,
  options?: CompileOptions,
): DtcgTokensFile {
  const doc = parseFrontMatterDocument(designMdContent, "DESIGN.md");
  const fm = doc.frontMatter as DesignFrontMatter;
  const unmapped: string[] = [];

  const globalSet = compileCategories(fm, unmapped);

  for (const key of Object.keys(fm)) {
    if (!HANDLED_KEYS.has(key)) unmapped.push(key);
  }

  const setOrder = ["global"];
  const themes: DtcgTheme[] = [
    { id: "default", name: "Default", selectedTokenSets: { global: "enabled" } },
  ];
  const themeSets: Record<string, DtcgGroup> = {};
  if (fm.themes && typeof fm.themes === "object") {
    for (const [themeName, bundle] of Object.entries(fm.themes)) {
      if (!bundle || typeof bundle !== "object") {
        unmapped.push(`themes.${themeName}`);
        continue;
      }
      themeSets[themeName] = compileCategories(
        bundle as Record<string, unknown>,
        unmapped,
        `themes.${themeName}.`,
      );
      setOrder.push(themeName);
      themes.push({
        id: themeName,
        name: themeName,
        selectedTokenSets: { global: "source", [themeName]: "enabled" },
      });
    }
  }

  const provenance: MarketingOsProvenance = { source: "DESIGN.md" };
  if (fm.name) provenance.designMdName = fm.name;
  if (fm.version !== undefined) provenance.designMdVersion = fm.version;
  if (fm.spec) provenance.designMdSpec = fm.spec;
  if (options?.compiledAt) provenance.compiledAt = options.compiledAt;
  if (unmapped.length) provenance.unmapped = unmapped;

  const file: DtcgTokensFile = {
    $description:
      typeof fm.description === "string" && fm.description.trim()
        ? fm.description.trim()
        : `${fm.name ?? "Brand"} design tokens compiled from DESIGN.md`,
    $extensions: { "com.marketingos": provenance },
    $metadata: { tokenSetOrder: setOrder },
    $themes: themes,
    global: globalSet,
    ...themeSets,
  };
  return file;
}

// ---------------------------------------------------------------------------
// Structural validator (DTCG conformance, same finding shape as the linter).
// ---------------------------------------------------------------------------

const ROOT_RESERVED = new Set(["$description", "$extensions", "$metadata", "$themes"]);
const TOKEN_KEYS = new Set(["$type", "$value", "$description", "$extensions"]);
// $type on a group is spec-legal (inherited default type), though we never emit it.
const GROUP_META = new Set(["$description", "$extensions", "$type"]);
const NAME_FORBIDDEN = /[{}.]/;

function walkGroup(
  node: Record<string, unknown>,
  setName: string,
  path: string[],
  findings: LintFinding[],
  tokenPaths: Set<string>,
): void {
  for (const [name, child] of Object.entries(node)) {
    const at = `${setName}${path.length ? "." + path.join(".") : ""}.${name}`;
    if (name.startsWith("$")) {
      if (!GROUP_META.has(name)) {
        findings.push({
          rule: "unknown-reserved-key",
          severity: "error",
          message: `group ${at.slice(0, -name.length - 1) || setName} carries unexpected reserved key \`${name}\``,
        });
      }
      continue;
    }
    if (NAME_FORBIDDEN.test(name) || name.startsWith("$")) {
      findings.push({
        rule: "invalid-token-name",
        severity: "error",
        message: `name \`${name}\` at ${at} contains a forbidden character ({, }, or .)`,
      });
    }
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      findings.push({
        rule: "invalid-node",
        severity: "error",
        message: `${at} is not a token or group (found ${Array.isArray(child) ? "array" : typeof child})`,
      });
      continue;
    }
    const c = child as Record<string, unknown>;
    if ("$value" in c) {
      // Token.
      if (typeof c.$type !== "string" || !c.$type) {
        findings.push({ rule: "token-missing-type", severity: "error", message: `token ${at} has $value but no $type` });
      }
      if (c.$value === undefined) {
        findings.push({ rule: "token-missing-value", severity: "error", message: `token ${at} has an undefined $value` });
      }
      for (const key of Object.keys(c)) {
        if (key.startsWith("$")) {
          if (!TOKEN_KEYS.has(key)) {
            findings.push({ rule: "unknown-token-key", severity: "error", message: `token ${at} carries unexpected reserved key \`${key}\`` });
          }
        } else {
          findings.push({ rule: "token-has-children", severity: "error", message: `token ${at} mixes $value with child \`${key}\` — a node is a token or a group, never both` });
        }
      }
      tokenPaths.add([...path, name].join("."));
    } else {
      walkGroup(c, setName, [...path, name], findings, tokenPaths);
    }
  }
}

function collectAliasRefs(value: unknown, refs: string[]): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\{([^{}]+)\}/g)) refs.push(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) collectAliasRefs(v, refs);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectAliasRefs(v, refs);
  }
}

function checkAliases(
  node: Record<string, unknown>,
  setName: string,
  path: string[],
  tokenPaths: Set<string>,
  findings: LintFinding[],
): void {
  for (const [name, child] of Object.entries(node)) {
    if (name.startsWith("$") || !child || typeof child !== "object" || Array.isArray(child)) continue;
    const c = child as Record<string, unknown>;
    if ("$value" in c) {
      const refs: string[] = [];
      collectAliasRefs(c.$value, refs);
      for (const ref of refs) {
        if (!tokenPaths.has(ref)) {
          findings.push({
            rule: "dangling-alias",
            severity: "error",
            message: `token ${setName}.${[...path, name].join(".")} references {${ref}}, which resolves to no token`,
          });
        }
      }
    } else {
      checkAliases(c, setName, [...path, name], tokenPaths, findings);
    }
  }
}

/**
 * Validate a DTCG tokens file structurally: every token has $type + $value,
 * tokens don't carry children, groups carry only their reserved metadata,
 * names avoid forbidden characters, and every alias resolves to a token.
 */
export function validateDtcgTokensFile(file: DtcgTokensFile): LintFinding[] {
  const findings: LintFinding[] = [];
  const sets: [string, Record<string, unknown>][] = [];

  for (const [key, value] of Object.entries(file)) {
    if (key.startsWith("$")) {
      if (!ROOT_RESERVED.has(key)) {
        findings.push({ rule: "unknown-reserved-key", severity: "error", message: `root carries unexpected reserved key \`${key}\`` });
      }
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      findings.push({ rule: "invalid-node", severity: "error", message: `set \`${key}\` is not a group` });
      continue;
    }
    sets.push([key, value as Record<string, unknown>]);
  }

  // Token paths are set-relative but resolved across the whole file (theme
  // sets layer over global), so collect the union before checking aliases.
  const tokenPaths = new Set<string>();
  for (const [setName, set] of sets) walkGroup(set, setName, [], findings, tokenPaths);
  for (const [setName, set] of sets) checkAliases(set, setName, [], tokenPaths, findings);

  return findings;
}
