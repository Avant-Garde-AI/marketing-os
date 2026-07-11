// Public Brand Portal data (spec 22 §Portal) — the outward-facing read over a
// store's Brand Soul manifest.
//
// Two audiences, one source of truth: humans get the editorial page
// (/brand/{slug}); agents get machine endpoints (/brand/{slug}/llms.txt and
// /brand/{slug}/file/{kind}) they can discover and fetch naturally.
//
// PUBLICATION FILTER: the portal is a brand *overview*, not the strategy
// dossier. Inward-facing sections (competitive teardown, measurement plumbing)
// and inward front-matter blocks (health metrics, competitor lists) are
// stripped before anything leaves. v1 list is opinionated; a front-matter
// `portal:` config can override later.

import { parse as parseYaml } from "yaml";
import { getBrandDoc } from "./store";

const EXCLUDED_SECTIONS = [/competitive differentiation/i, /measurement & brand health/i];
const EXCLUDED_FRONT_KEYS = ["health_metrics", "source"];

export interface PortalSection {
  heading: string;
  body: string;
}

export interface PortalData {
  slug: string;
  name: string;
  version: number;
  updated?: string;
  essence?: string;
  northStar?: string;
  voicePillars: string[];
  personaName?: string;
  sections: PortalSection[];
  designColors: Record<string, string>;
  designSections: PortalSection[];
  designVersion?: number;
}

export function slugToShop(slug: string): string {
  return `${slug}.myshopify.com`;
}

function splitSections(markdown: string): PortalSection[] {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const out: PortalSection[] = [];
  const re = /^## +(.+?)\s*$/gm;
  const marks: Array<{ h: string; start: number; cs: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) marks.push({ h: m[1].trim(), start: m.index, cs: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : body.length;
    out.push({ heading: marks[i].h, body: body.slice(marks[i].cs, end).trim() });
  }
  return out;
}

function frontMatter(markdown: string): Record<string, any> {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  try {
    return (parseYaml(m[1]) as Record<string, any>) ?? {};
  } catch {
    return {};
  }
}

const isPublicSection = (heading: string) => !EXCLUDED_SECTIONS.some((re) => re.test(heading));

/** Assemble the portal view for a store slug; null when no brand.md exists. */
export async function getPortalData(slug: string): Promise<PortalData | null> {
  const shop = slugToShop(slug);
  const brand = await getBrandDoc(shop, "brand.md");
  if (!brand) return null;
  const fm = frontMatter(brand.content);
  const design = await getBrandDoc(shop, "DESIGN.md");
  const designFm = design ? frontMatter(design.content) : {};
  const designColors: Record<string, string> = {};
  for (const [k, v] of Object.entries((designFm.colors ?? {}) as Record<string, unknown>)) {
    if (typeof v === "string" && v.startsWith("#")) designColors[k] = v;
  }
  return {
    slug,
    name: String(fm.name ?? slug),
    version: Number(fm.version ?? brand.version),
    updated: fm.updated ? String(fm.updated) : undefined,
    essence: fm.essence?.line ? String(fm.essence.line) : undefined,
    northStar: fm.north_star?.statement ? String(fm.north_star.statement) : undefined,
    voicePillars: Array.isArray(fm.voice?.pillars) ? fm.voice.pillars.map(String) : [],
    personaName: fm.personas?.primary?.name ? String(fm.personas.primary.name) : undefined,
    sections: splitSections(brand.content).filter((s) => isPublicSection(s.heading)),
    designColors,
    designSections: design ? splitSections(design.content) : [],
    designVersion: design?.version,
  };
}

/** The machine-served brand.md: excluded sections + inward front-matter keys stripped. */
export async function getPublicBrandMd(slug: string): Promise<string | null> {
  const brand = await getBrandDoc(slugToShop(slug), "brand.md");
  if (!brand) return null;
  const m = brand.content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/);
  let front = "";
  if (m) {
    // Drop excluded top-level keys from the raw YAML while preserving comments
    // (provenance tags live in comments — a re-serialize would destroy them).
    const lines = m[2].split("\n");
    const kept: string[] = [];
    let skipping = false;
    for (const line of lines) {
      const top = line.match(/^([a-zA-Z_][\w-]*):/);
      if (top) skipping = EXCLUDED_FRONT_KEYS.includes(top[1]);
      if (!skipping) kept.push(line);
    }
    front = `---\n${kept.join("\n")}\n---\n\n`;
  }
  const sections = splitSections(brand.content).filter((s) => isPublicSection(s.heading));
  const title = brand.content.match(/^# .+$/m)?.[0] ?? "";
  return front + (title ? `${title}\n\n` : "") + sections.map((s) => `## ${s.heading}\n\n${s.body}`).join("\n\n");
}

export async function getPublicDesignMd(slug: string): Promise<string | null> {
  const design = await getBrandDoc(slugToShop(slug), "DESIGN.md");
  return design?.content ?? null;
}
