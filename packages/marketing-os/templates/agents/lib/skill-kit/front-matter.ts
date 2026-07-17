/**
 * YAML-front-matter document plumbing — the physical format every pack
 * artifact shares with brand.md (05 H6: both packs' artifacts.ts duplicated
 * this; it lives here now). Round-trip guarantee for consumers:
 * `splitFrontMatter(frontMatterDocument(fm, body))` recovers both halves.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { z } from "zod";

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a document into parsed front matter + body. Throws with `docName`
 * context on missing/invalid front matter. */
export function splitFrontMatter(
  raw: string,
  docName: string,
): { frontMatter: unknown; body: string } {
  const m = raw.match(FRONT_MATTER_RE);
  if (!m) throw new Error(`${docName}: missing YAML front matter (--- ... ---)`);
  let frontMatter: unknown;
  try {
    frontMatter = parseYaml(m[1] ?? "");
  } catch (e) {
    throw new Error(`${docName}: invalid front matter YAML: ${e instanceof Error ? e.message : e}`);
  }
  if (!frontMatter || typeof frontMatter !== "object") {
    throw new Error(`${docName}: front matter is not a mapping`);
  }
  return { frontMatter, body: raw.slice(m[0].length) };
}

/** Serialize front matter + body back into the canonical document form. */
export function frontMatterDocument(frontMatter: Record<string, unknown>, body: string): string {
  const yamlSrc = stringifyYaml(frontMatter).trimEnd();
  const trimmedBody = body.trim();
  return `---\n${yamlSrc}\n---\n\n${trimmedBody}${trimmedBody ? "\n" : ""}`;
}

/** Validate parsed front matter against a zod schema, with readable errors. */
export function validateFrontMatter<T>(schema: z.ZodType<T>, value: unknown, docName: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`${docName}: invalid front matter — ${issues}`);
  }
  return result.data;
}
