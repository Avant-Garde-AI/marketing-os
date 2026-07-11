import { parse as parseYaml } from "yaml";
import type { BrandDocument, BrandFrontMatter, BrandSection } from "./types";

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse a brand.md document: YAML front matter + `##` sections.
 * The raw front-matter source is preserved (provenance lives in YAML comments).
 * Throws on missing/invalid front matter — a brand.md without a soul is not a
 * brand.md. Section-level problems are the linter's job, not the parser's.
 */
export function parseBrandMd(raw: string): BrandDocument {
  const m = raw.match(FRONT_MATTER_RE);
  if (!m) throw new Error("brand.md: missing YAML front matter (--- ... ---)");
  const frontMatterRaw = m[1];
  let frontMatter: BrandFrontMatter;
  try {
    frontMatter = parseYaml(frontMatterRaw) as BrandFrontMatter;
  } catch (e) {
    throw new Error(`brand.md: invalid front matter YAML: ${e instanceof Error ? e.message : e}`);
  }
  if (!frontMatter || typeof frontMatter !== "object") {
    throw new Error("brand.md: front matter is not a mapping");
  }
  if (!frontMatter.name) throw new Error("brand.md: front matter `name` is required");

  const body = raw.slice(m[0].length);
  const sections: BrandSection[] = [];
  const sectionRe = /^## +(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  const marks: { heading: string; start: number; contentStart: number }[] = [];
  while ((match = sectionRe.exec(body))) {
    marks.push({ heading: match[1].trim(), start: match.index, contentStart: match.index + match[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : body.length;
    sections.push({ heading: marks[i].heading, body: body.slice(marks[i].contentStart, end).trim() });
  }
  return { frontMatter, frontMatterRaw, sections, raw };
}

/**
 * Distill the per-turn injectable brand context (spec 22 D5: front matter
 * only). Returns a compact plain-object subset — voice, AI rules, copy
 * formulas, guardrails, tone — ready to serialize into agent instructions.
 */
export function distillBrandContext(doc: BrandDocument): Record<string, unknown> {
  const fm = doc.frontMatter;
  const out: Record<string, unknown> = {
    brand: fm.name,
    version: fm.version,
  };
  if (fm.essence?.line) out.essence = fm.essence.line;
  if (fm.voice) out.voice = fm.voice;
  if (fm.ai_voice_rules) out.ai_voice_rules = fm.ai_voice_rules;
  if (fm.art_description_formula) out.art_description_formula = fm.art_description_formula;
  if (fm.guardrails) out.guardrails = fm.guardrails;
  if (fm.personas && typeof fm.personas === "object") {
    const primary = (fm.personas as Record<string, any>).primary;
    if (primary?.name) {
      out.primary_persona = {
        name: primary.name,
        mental_model: primary.mental_model,
        decision_hierarchy: primary.decision_hierarchy,
      };
    }
  }
  return out;
}
