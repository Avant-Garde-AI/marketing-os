/**
 * (De)serialization for brand-design.md — human-readable Markdown with a
 * structured front-matter block (PRD §2). `parse(serialize(doc))` round-trips
 * the structured fields losslessly.
 */
import { brandDesignDocSchema, type BrandDesignDoc } from "./schema.js";

// ── serialize ────────────────────────────────────────────────────────────────

export function serializeBrandDesign(doc: BrandDesignDoc): string {
  const fm = doc.frontmatter;
  const out: string[] = [];
  out.push("---");
  out.push(`brand_id: ${fm.brandId}`);
  out.push(`neurograph_persona: ${fm.neurographPersona ?? "null"}`);
  out.push(`category: ${fm.category}`);
  out.push(`version: ${fm.version}`);
  out.push(`updated: ${fm.updated}`);
  out.push("---");
  out.push("");
  out.push(`# Brand Conversion Document — ${fm.brandId}`);
  out.push("");

  out.push("## 1. Brand Essence & Positioning");
  out.push(doc.essence);
  out.push("");

  out.push("## 2. Target Persona");
  out.push(`_Source: ${doc.persona.source}${doc.persona.ref ? ` (${doc.persona.ref})` : ""}_`);
  out.push(doc.persona.summary);
  out.push(...bullets("Decision drivers", doc.persona.drivers));
  out.push(...bullets("Objections", doc.persona.objections));
  out.push(...bullets("Trust requirements", doc.persona.trustRequirements));
  out.push("");

  out.push("## 3. Value Proposition & Differentiation");
  out.push(doc.valueProp);
  out.push("");

  out.push("## 4. Visual Identity");
  out.push(doc.visualIdentity.summary);
  out.push(...bullets("Design tokens", Object.entries(doc.visualIdentity.tokens).map(([k, v]) => `${k}: ${v}`)));
  out.push(`**Typography:** ${doc.visualIdentity.typography}`);
  out.push(`**Imagery:** ${doc.visualIdentity.imagery}`);
  out.push("");

  out.push("## 5. Voice & Copy Principles");
  out.push(`**Tone:** ${doc.voice.tone}`);
  out.push(...bullets("Vocabulary", doc.voice.vocabulary));
  out.push(...bullets("Do not", doc.voice.donts));
  out.push("");

  out.push("## 6. Design Principles");
  out.push(...doc.designPrinciples.map((p) => `- ${p}`));
  out.push("");

  out.push("## 7. Category Context");
  out.push(doc.categoryContext);
  out.push("");

  out.push("## 8. Conversion Priorities");
  out.push(...doc.conversionPriorities.map((p) => `- ${p}`));
  out.push("");

  out.push("## 9. Guardrails");
  out.push(`**Accessibility:** WCAG ${doc.guardrails.wcag}`);
  out.push("**No dark patterns:** required");
  out.push(...bullets("Additional", doc.guardrails.custom));
  out.push("");

  return out.join("\n");
}

function bullets(label: string, items: string[]): string[] {
  if (items.length === 0) return [`**${label}:**`];
  return [`**${label}:**`, ...items.map((i) => `- ${i}`)];
}

// ── parse ────────────────────────────────────────────────────────────────────

export function parseBrandDesign(md: string): BrandDesignDoc {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch || fmMatch[1] === undefined) throw new Error("brand-design.md: missing front-matter block");
  const fm = parseFrontmatter(fmMatch[1]);
  const body = md.slice(fmMatch[0].length);

  const s1 = section(body, 1);
  const s2 = section(body, 2);
  const s3 = section(body, 3);
  const s4 = section(body, 4);
  const s5 = section(body, 5);
  const s6 = section(body, 6);
  const s7 = section(body, 7);
  const s8 = section(body, 8);
  const s9 = section(body, 9);

  const p2 = splitLabeled(stripSourceLine(s2.raw));
  const v4 = splitLabeled(s4.raw);
  const c5 = splitLabeled(s5.raw);
  const g9 = splitLabeled(s9.raw);

  const doc = {
    frontmatter: fm,
    essence: s1.lead.trim(),
    persona: {
      source: sourceFrom(s2.raw),
      ref: refFrom(s2.raw),
      summary: p2.lead.trim(),
      drivers: list(p2.labels["Decision drivers"]),
      objections: list(p2.labels["Objections"]),
      trustRequirements: list(p2.labels["Trust requirements"]),
    },
    valueProp: s3.lead.trim(),
    visualIdentity: {
      summary: v4.lead.trim(),
      tokens: tokens(list(v4.labels["Design tokens"])),
      typography: inline(v4.labels["Typography"]),
      imagery: inline(v4.labels["Imagery"]),
    },
    voice: {
      tone: inline(c5.labels["Tone"]),
      vocabulary: list(c5.labels["Vocabulary"]),
      donts: list(c5.labels["Do not"]),
    },
    designPrinciples: list(s6.lead),
    categoryContext: s7.lead.trim(),
    conversionPriorities: list(s8.lead),
    guardrails: {
      wcag: wcagFrom(inline(g9.labels["Accessibility"])),
      noDarkPatterns: true as const,
      custom: list(g9.labels["Additional"]),
    },
  };
  return brandDesignDocSchema.parse(doc);
}

function parseFrontmatter(block: string): BrandDesignDoc["frontmatter"] {
  const map: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    map[key] = line.slice(idx + 1).trim();
  }
  const np = map["neurograph_persona"];
  return {
    brandId: map["brand_id"] ?? "",
    neurographPersona: np === undefined || np === "null" ? null : np,
    category: map["category"] ?? "",
    version: map["version"] ?? "0.1.0",
    updated: map["updated"] ?? "",
  };
}

/** Returns the raw content of `## N. …` up to the next section, and its lead text. */
function section(body: string, n: number): { raw: string; lead: string } {
  const re = new RegExp(`^## ${n}\\. .*$`, "m");
  const m = body.match(re);
  if (!m || m.index === undefined) return { raw: "", lead: "" };
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^## \d+\. /m);
  const raw = next === -1 ? rest : rest.slice(0, next);
  return { raw: raw.replace(/^\n/, ""), lead: leadOf(raw) };
}

/** Lead text = everything before the first `**Label:**` line. */
function leadOf(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\*\*.+?:\*\*/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

interface Labeled {
  lead: string;
  labels: Record<string, string>;
}

function splitLabeled(raw: string): Labeled {
  const lines = raw.split("\n");
  const lead: string[] = [];
  const labels: Record<string, string> = {};
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) labels[current] = buf.join("\n").trim();
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^\*\*(.+?):\*\*\s?(.*)$/);
    if (m && m[1] !== undefined) {
      flush();
      current = m[1];
      buf = m[2] ? [m[2]] : [];
    } else if (current === null) {
      lead.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  return { lead: lead.join("\n").trim(), labels };
}

function list(content: string | undefined): string[] {
  if (!content) return [];
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter((l) => l.length > 0);
}

function inline(content: string | undefined): string {
  if (!content) return "";
  return (content.split("\n")[0] ?? "").trim();
}

function tokens(items: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const idx = item.indexOf(":");
    if (idx === -1) continue;
    out[item.slice(0, idx).trim()] = item.slice(idx + 1).trim();
  }
  return out;
}

function stripSourceLine(lead: string): string {
  return lead.replace(/^_Source:.*_\s*$/m, "").trim();
}

function sourceFrom(raw: string): "elicited" | "neurograph" {
  return /_Source:\s*neurograph/i.test(raw) ? "neurograph" : "elicited";
}

function refFrom(raw: string): string | undefined {
  const m = raw.match(/_Source:\s*\w+\s*\((.+?)\)_/);
  return m && m[1] ? m[1].trim() : undefined;
}

function wcagFrom(value: string): "A" | "AA" | "AAA" {
  const m = value.match(/WCAG\s*(AAA|AA|A)/i);
  const level = m?.[1]?.toUpperCase();
  return level === "A" || level === "AA" || level === "AAA" ? level : "AA";
}
