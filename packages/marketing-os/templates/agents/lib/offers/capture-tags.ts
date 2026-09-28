/**
 * Customer tags for an offer capture (spec 14 O0, spec 34 §2.5) — used by
 * app/api/surfaces/capture. Template-owned (not vendored from the pack):
 * it is Shopify-tag plumbing, not offer logic.
 */

export const MAX_ANSWER_TAGS = 5;

/**
 * Zero-party answers arrive from the storefront, so they are untrusted: keys
 * and values are reduced to the manifest's own vocabulary shape ([a-z0-9_-],
 * ≤ 32 chars — the choice block's answerKey/option-value shape), so nothing
 * free-form, and nothing that could smuggle a comma into Shopify's
 * comma-separated tag list, ever lands on the customer record.
 */
export function answerTags(answers: unknown): string[] {
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return [];
  const clean = (s: unknown) =>
    typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) : "";
  const tags: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(answers as Record<string, unknown>)) {
    const key = clean(rawKey).replace(/-/g, "_");
    const value = clean(rawValue);
    if (!key || !value) continue;
    tags.push(`mos-ans:${key}:${value}`);
    if (tags.length === MAX_ANSWER_TAGS) break;
  }
  return tags;
}

/** Shopify's customer PUT replaces the whole tag list — merge, never overwrite. */
export function mergeTags(existing: string | undefined, add: string[]): string {
  const current = (existing ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return [...new Set([...current, ...add])].join(",");
}
