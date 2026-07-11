/**
 * brand.md/v0 — type definitions (spec 22 §2).
 *
 * The front matter is the machine-readable soul: what the context engine
 * injects per turn (D5: front matter only). Prose sections carry full depth
 * and load on demand. All front-matter claims carry provenance via inline
 * `# @owner|@agent|@data|@research` comments in the YAML source; the parser
 * preserves the raw source so provenance survives round-trips.
 */

export type Provenance = "owner" | "agent" | "data" | "research";

export interface BrandFrontMatter {
  spec: string; // "brand.md/v0"
  name: string;
  version: number;
  updated?: string;
  source?: string;
  essence?: { line?: string; meaning?: string[] };
  north_star?: { statement?: string; signals?: string[] };
  positioning?: Record<string, unknown>;
  promise?: string[];
  personas?: Record<string, unknown>;
  experience?: Record<string, unknown>;
  voice?: {
    essence?: string;
    pillars?: string[];
    never?: string[];
    tone_by_context?: Record<string, string>;
  };
  art_description_formula?: Record<string, unknown>;
  ai_voice_rules?: string[];
  conversion?: Record<string, unknown>;
  guardrails?: string[];
  health_metrics?: Record<string, string[]>;
  design_ref?: string;
  [key: string]: unknown;
}

export interface BrandSection {
  heading: string;
  body: string;
}

export interface BrandDocument {
  frontMatter: BrandFrontMatter;
  /** Raw YAML source of the front matter — preserves provenance comments. */
  frontMatterRaw: string;
  sections: BrandSection[];
  raw: string;
}

export type LintSeverity = "error" | "warning" | "info";

export interface LintFinding {
  rule: string;
  severity: LintSeverity;
  message: string;
}

/** Canonical v0 section order (spec 22 §2, derived from the Arthaus guide). */
export const CANONICAL_SECTIONS = [
  "Essence & North Star",
  "Mission, Vision & Purpose",
  "Positioning & Promise",
  "Audience Architecture",
  "The Two-Tier Experience", // experience architecture (name may vary per brand)
  "Voice & Tone",
  "Messaging Framework",
  "Art Description Formula", // copy formula templates (name may vary per brand)
  "Experience Principles",
  "Product & Merchandising Principles",
  "Brand Architecture",
  "Content & Editorial Strategy",
  "Channel Guidelines",
  "AI & Personalization Voice",
  "Governance: Do's & Don'ts",
  "Competitive Differentiation",
  "Measurement & Brand Health",
  "Provenance & Change Log",
] as const;
