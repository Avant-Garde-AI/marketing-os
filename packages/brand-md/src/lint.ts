import type { BrandDocument, LintFinding } from "./types";

/**
 * brand.md linter (spec 22 §2). Inherits DESIGN.md's conformance philosophy:
 * unknown sections are fine (preserve, don't error); duplicates are not.
 * Severities: error = document is untrustworthy as a soul; warning = weakens
 * it; info = advisory.
 */
export function lintBrandMd(doc: BrandDocument): LintFinding[] {
  const findings: LintFinding[] = [];
  const fm = doc.frontMatter;

  // missing-essence: the soul must state what the brand IS.
  if (!fm.essence?.line) {
    findings.push({
      rule: "missing-essence",
      severity: "error",
      message: "front matter `essence.line` is missing — the one-line brand essence is the document's anchor",
    });
  }

  // spec-version: unknown spec string.
  if (fm.spec && !String(fm.spec).startsWith("brand.md/")) {
    findings.push({ rule: "unknown-spec", severity: "warning", message: `unrecognized spec "${fm.spec}" (expected brand.md/v0)` });
  }
  if (typeof fm.version !== "number" || fm.version < 1) {
    findings.push({ rule: "missing-version", severity: "error", message: "front matter `version` must be a positive integer" });
  }

  // duplicate-heading: rejected, per DESIGN.md conformance.
  const seen = new Map<string, number>();
  for (const s of doc.sections) {
    const key = s.heading.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [heading, count] of seen) {
    if (count > 1) {
      findings.push({ rule: "duplicate-heading", severity: "error", message: `section "${heading}" appears ${count} times` });
    }
  }

  // unowned-claim: top-level front-matter blocks with no provenance tag in the raw YAML.
  // Provenance lives in comments (# @owner etc.); a block with none is unattributed.
  const provenancedBlocks = ["essence", "north_star", "positioning", "promise", "personas", "voice", "guardrails"];
  for (const block of provenancedBlocks) {
    const blockRe = new RegExp(`^${block}:`, "m");
    if (!blockRe.test(doc.frontMatterRaw)) continue;
    // Look for a @tag on the block's line or within its indented body.
    const bodyRe = new RegExp(`^${block}:[^\\n]*(#\\s*@(owner|agent|data|research))`, "m");
    const withinRe = new RegExp(`^${block}:[\\s\\S]*?(?=^\\S|$(?![\\s\\S]))`, "m");
    const within = doc.frontMatterRaw.match(withinRe)?.[0] ?? "";
    if (!bodyRe.test(doc.frontMatterRaw) && !/#\s*@(owner|agent|data|research)/.test(within)) {
      findings.push({
        rule: "unowned-claim",
        severity: "warning",
        message: `front-matter block \`${block}\` carries no provenance tag (@owner/@agent/@data/@research)`,
      });
    }
  }

  // missing-changelog: versioned documents need their history.
  if (!doc.sections.some((s) => /provenance|change log/i.test(s.heading))) {
    findings.push({ rule: "missing-changelog", severity: "warning", message: "no Provenance & Change Log section" });
  }

  // broken-design-ref: advisory only (resolution is the caller's context).
  if (!fm.design_ref) {
    findings.push({ rule: "missing-design-ref", severity: "info", message: "no design_ref — soul without a body (DESIGN.md sibling)" });
  }

  // stale-data-claim: health_metrics declared but no updated date within 90 days.
  if (fm.health_metrics && fm.updated) {
    const updated = new Date(fm.updated).getTime();
    if (Number.isFinite(updated) && Date.now() - updated > 90 * 24 * 3600 * 1000) {
      findings.push({
        rule: "stale-data-claim",
        severity: "warning",
        message: `document last updated ${fm.updated}; @data claims may be stale (>90 days)`,
      });
    }
  }

  return findings;
}
