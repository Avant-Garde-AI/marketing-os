/**
 * Value families: the taxonomy's middle level (spec 35 P2, 2026-11-25).
 *
 *   axis (a question)  →  family (a decision)  →  value (one named treatment)
 *
 * Admitted values are deliberately specific, so an axis can carry 20-30 of
 * them, and a category's brands spread thinly across near-variants
 * (`static-text-strip`, `static-text-bar`, `solid-color-text-strip`). Live audits
 * on 2026-11-25 found no conventions a page matched (zero strengths) and called
 * almost everything distinctive. Conversion moves are made between DECISIONS
 * (a static vs a rotating announcement bar), not between wordings, so
 * conventions and strokes are measured on families.
 *
 * Families are proposed by a model, one call per axis, and then validated
 * deterministically: every admitted value lands in exactly one family, unknown
 * names are dropped, and values the model omitted go to `other`. Like the merges,
 * every grouping is cached for replay and a reviewer file can override it.
 * Families never change admission. They are a derived view, rebuilt whenever
 * the vocabulary changes.
 */
import { conversionRole } from "./conversion.js";
import { admittedValues, normalizeValue, type Vocabulary } from "./vocabulary.js";

export interface Family {
  key: string;
  label: string;
  description: string;
  values: string[];
}

export interface Taxonomy {
  schema: "design-craft/taxonomy@1";
  vocabularyRef: string;
  grouper?: string;
  axes: Record<string, { families: Family[] }>;
}

export interface GroupingInput {
  axis: string;
  question?: string;
  conversionQuestion?: string;
  values: { value: string; gloss?: string; brands: number }[];
}

export interface FamilyGrouper {
  readonly id: string;
  group(input: GroupingInput): Promise<string>;
}

export const OTHER_FAMILY = "other";

/** Reviewer overrides: move a value to a family (created if new), or rename a family's label. */
export interface TaxonomyOverride {
  axis: string;
  value?: string;
  family: string;
  label?: string;
  why?: string;
}

export interface TaxonomyBuildReport {
  axes: number;
  grouped: number;
  cached: number;
  /** Values the model left out or named twice, fixed by the validator. */
  repaired: { axis: string; value: string; fix: string }[];
  errors: { axis: string; error: string }[];
}

export function groupingInput(v: Vocabulary, axis: string): GroupingInput {
  const ax = v.axes[axis]!;
  return {
    axis,
    ...(ax.description ? { question: ax.description } : {}),
    ...(conversionRole(axis) ? { conversionQuestion: conversionRole(axis)!.job } : {}),
    values: admittedValues(v, axis)
      .map((value) => ({ value, ...(ax.values[value]!.gloss ? { gloss: ax.values[value]!.gloss } : {}), brands: ax.values[value]!.support.length }))
      .sort((a, b) => b.brands - a.brands || a.value.localeCompare(b.value)),
  };
}

/**
 * Validate a grouper's raw JSON against the axis's admitted values. The result
 * always partitions the values exactly: that's the invariant benchmarks rely on.
 */
export function parseFamilies(raw: string, values: string[], axis = ""): { families: Family[]; repaired: TaxonomyBuildReport["repaired"] } {
  const repaired: TaxonomyBuildReport["repaired"] = [];
  let parsed: any;
  try {
    const start = raw.indexOf("{");
    parsed = JSON.parse(raw.slice(start, raw.lastIndexOf("}") + 1));
  } catch {
    throw new Error("grouper returned invalid JSON");
  }
  const want = new Set(values);
  const placed = new Set<string>();
  const families: Family[] = [];
  for (const f of Array.isArray(parsed?.families) ? parsed.families : []) {
    const key = normalizeValue(f?.key ?? f?.label ?? "");
    if (!key) continue;
    const mine: string[] = [];
    for (const raw of Array.isArray(f?.values) ? f.values : []) {
      const val = normalizeValue(raw);
      if (!want.has(val)) continue; // invented or misspelled: dropped
      if (placed.has(val)) {
        repaired.push({ axis, value: val, fix: `named twice; kept in its first family, not "${key}"` });
        continue;
      }
      placed.add(val);
      mine.push(val);
    }
    if (!mine.length) continue;
    const existing = families.find((x) => x.key === key);
    if (existing) existing.values.push(...mine);
    else families.push({ key, label: String(f?.label ?? key).trim() || key, description: String(f?.description ?? "").trim(), values: mine });
  }
  const missing = values.filter((x) => !placed.has(x));
  if (missing.length) {
    for (const m of missing) repaired.push({ axis, value: m, fix: `omitted by the grouper; placed in "${OTHER_FAMILY}"` });
    const other = families.find((f) => f.key === OTHER_FAMILY);
    if (other) other.values.push(...missing);
    else families.push({ key: OTHER_FAMILY, label: "Other", description: "Values that fit no family the grouper named.", values: missing });
  }
  return { families, repaired };
}

export function applyOverrides(t: Taxonomy, overrides: TaxonomyOverride[]): void {
  for (const o of overrides) {
    const ax = t.axes[o.axis];
    if (!ax) continue;
    const fam = normalizeValue(o.family);
    let target = ax.families.find((f) => f.key === fam);
    if (!target) {
      target = { key: fam, label: o.label ?? fam, description: o.why ?? "", values: [] };
      ax.families.push(target);
    } else if (o.label) target.label = o.label;
    if (o.value) {
      const val = normalizeValue(o.value);
      for (const f of ax.families) f.values = f.values.filter((x) => x !== val);
      target.values.push(val);
    }
    ax.families = ax.families.filter((f) => f.values.length);
  }
}

/** Group every recognized axis that has admitted values. One grouper call per axis, cached by its exact input. */
export async function buildTaxonomy(
  v: Vocabulary,
  opts: { grouper: FamilyGrouper; cache?: Map<string, string>; vocabularyRef?: string; overrides?: TaxonomyOverride[]; minValues?: number },
): Promise<{ taxonomy: Taxonomy; report: TaxonomyBuildReport }> {
  const taxonomy: Taxonomy = { schema: "design-craft/taxonomy@1", vocabularyRef: opts.vocabularyRef ?? "", grouper: opts.grouper.id, axes: {} };
  const report: TaxonomyBuildReport = { axes: 0, grouped: 0, cached: 0, repaired: [], errors: [] };
  const minValues = opts.minValues ?? 4;
  for (const axis of Object.keys(v.axes).sort()) {
    const values = admittedValues(v, axis);
    if (!values.length) continue;
    report.axes++;
    // Too few values to need families: each value is its own decision.
    if (values.length < minValues) {
      taxonomy.axes[axis] = { families: values.map((x) => ({ key: x, label: x, description: v.axes[axis]!.values[x]!.gloss ?? "", values: [x] })) };
      continue;
    }
    const input = groupingInput(v, axis);
    const key = `${opts.grouper.id}|${JSON.stringify(input)}`;
    try {
      let raw = opts.cache?.get(key);
      if (raw) report.cached++;
      else {
        raw = await opts.grouper.group(input);
        opts.cache?.set(key, raw);
        report.grouped++;
      }
      const { families, repaired } = parseFamilies(raw, values, axis);
      report.repaired.push(...repaired);
      taxonomy.axes[axis] = { families };
    } catch (e) {
      // An ungrouped axis falls back to value-level benchmarks; nothing is invented.
      report.errors.push({ axis, error: (e as Error).message.slice(0, 200) });
    }
  }
  if (opts.overrides?.length) applyOverrides(taxonomy, opts.overrides);
  return { taxonomy, report };
}

/** The family a value belongs to on an axis, or null when the axis has no families. */
export function familyOf(t: Taxonomy | undefined, axis: string, value: string): Family | null {
  return t?.axes[axis]?.families.find((f) => f.values.includes(value)) ?? null;
}

export const TAXONOMY_SYSTEM = [
  "You organize the values of ONE storefront design axis into FAMILIES: the distinct decisions a designer chooses between when answering the axis's question.",
  "Values in a family are variants of the same decision. Different families are different decisions that would change what a shopper sees or does.",
  "Group by the decision itself (structure, mechanism, placement, what is shown), never by wording, by color words alone, or by store.",
  "Make 2 to 7 families. Name each with a short kebab-case key (2-4 words), a short label, and a one-sentence description of the decision.",
  "Put EVERY listed value in exactly one family, copying value names exactly. A value that fits no family goes in a family with key \"other\".",
  "Don't make a family of one value unless it really is a separate decision.",
  'Return STRICT JSON: {"families": [{"key": "...", "label": "...", "description": "...", "values": ["..."]}]}',
].join("\n");

export function taxonomyPrompt(input: GroupingInput): string {
  return [
    `AXIS: ${input.axis}`,
    ...(input.question ? [`QUESTION: ${input.question}`] : []),
    ...(input.conversionQuestion ? [`WHY IT MATTERS TO A SHOPPER: ${input.conversionQuestion}`] : []),
    "",
    "VALUES (name: description [brands using it]):",
    ...input.values.map((x) => `- ${x.value}${x.gloss ? `: ${x.gloss}` : ""} [${x.brands}]`),
    "",
    "JSON only.",
  ].join("\n");
}
