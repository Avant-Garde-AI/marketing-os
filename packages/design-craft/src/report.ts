/**
 * `design-craft report` (spec 35 P2): the vocabulary measured against M1, plus
 * ontology health and conversion-lens coverage. Pure: vocabulary + labels in,
 * a plain object out, so the CLI, the datasheet and the MCP all read one number.
 */
import { CONVERSION_STAGES, conversionRole, type ConversionStage } from "./conversion.js";
import type { LabelRecord } from "./labels.js";
import { admittedValues, isRecognized, vocabularyStats, type Vocabulary, type VocabularyStats } from "./vocabulary.js";

export interface Criterion {
  id: string;
  label: string;
  target: number;
  actual: number;
  met: boolean;
}

export interface VocabularyReport {
  stats: VocabularyStats;
  m1: { met: boolean; criteria: Criterion[] };
  categories: Record<string, number>;
  axes: {
    axis: string;
    origin: "seeded" | "emergent";
    brands: number;
    admitted: number;
    pending: number;
    stage: ConversionStage | null;
    aliases: string[];
  }[];
  emergence: { recognizedEmergent: number; recognized: number; rate: number };
  /** Recognized axes per conversion stage; the stage map shows where the action space is thin. */
  stages: Record<ConversionStage, { axes: number; admittedValues: number }>;
  /** Recognized axes the conversion lens doesn't cover yet. */
  unmappedAxes: string[];
  /** Admitted values with measured outcomes (reward.offered > 0). Zero until the action gate reports. */
  rewardCoverage: { values: number; withOutcomes: number };
}

export function vocabularyReport(v: Vocabulary, records: LabelRecord[]): VocabularyReport {
  const stats = vocabularyStats(v);
  const byCategory = new Map<string, Set<string>>();
  for (const r of records) (byCategory.get(r.category) ?? byCategory.set(r.category, new Set()).get(r.category)!).add(r.brand);
  const categories = Object.fromEntries([...byCategory].sort().map(([c, b]) => [c, b.size]));
  const bigCategories = [...byCategory.values()].filter((b) => b.size >= 5).length;
  const corpusBrands = new Set(records.map((r) => r.brand)).size;

  const recognized = Object.keys(v.axes).filter((a) => isRecognized(v, a)).sort();
  const axes = recognized.map((axis) => {
    const ax = v.axes[axis]!;
    const admitted = admittedValues(v, axis).length;
    return {
      axis,
      origin: ax.origin,
      brands: ax.axisSupport.length,
      admitted,
      pending: Object.keys(ax.values).length - admitted,
      stage: conversionRole(axis)?.stage ?? null,
      aliases: ax.aliases ?? [],
    };
  });
  const stages = Object.fromEntries(CONVERSION_STAGES.map(({ stage }) => [stage, { axes: 0, admittedValues: 0 }])) as VocabularyReport["stages"];
  for (const a of axes) if (a.stage) {
    stages[a.stage].axes++;
    stages[a.stage].admittedValues += a.admitted;
  }
  const emergent = axes.filter((a) => a.origin === "emergent").length;
  const values = Object.values(v.axes).flatMap((ax) => Object.values(ax.values).filter((e) => e.admitted));

  const criteria: Criterion[] = [
    { id: "axes", label: "recognized axes", target: 20, actual: stats.recognizedAxes },
    { id: "values", label: "admitted values", target: 100, actual: stats.admittedValues },
    { id: "brands", label: "distinct storefronts", target: 60, actual: corpusBrands },
    { id: "categories", label: "categories with ≥5 brands", target: 4, actual: bigCategories },
  ].map((c) => ({ ...c, met: c.actual >= c.target }));

  return {
    stats,
    m1: { met: criteria.every((c) => c.met), criteria },
    categories,
    axes,
    emergence: { recognizedEmergent: emergent, recognized: recognized.length, rate: recognized.length ? Math.round((emergent / recognized.length) * 1000) / 1000 : 0 },
    stages,
    unmappedAxes: axes.filter((a) => !a.stage).map((a) => a.axis),
    rewardCoverage: { values: values.length, withOutcomes: values.filter((e) => (e.reward?.offered ?? 0) > 0).length },
  };
}

export function formatReport(r: VocabularyReport): string {
  const lines = [
    `M1 ${r.m1.met ? "MET" : "NOT MET"}: ${r.m1.criteria.map((c) => `${c.label} ${c.actual}/${c.target}${c.met ? " ✓" : " ✗"}`).join(" · ")}`,
    `categories: ${Object.entries(r.categories).map(([c, n]) => `${c} ${n}`).join(", ")}`,
    `emergence: ${r.emergence.recognizedEmergent} of ${r.emergence.recognized} recognized axes emergent (${Math.round(r.emergence.rate * 100)}%)`,
    `reward coverage: ${r.rewardCoverage.withOutcomes}/${r.rewardCoverage.values} admitted values have measured outcomes`,
    "",
    "stage        axes  values",
    ...Object.entries(r.stages).map(([s, x]) => `${s.padEnd(12)} ${String(x.axes).padStart(4)}  ${String(x.admittedValues).padStart(6)}`),
    "",
    ...r.axes.map((a) => `  ${a.axis.padEnd(30)} ${a.origin === "seeded" ? "seed" : "emrg"} ${String(a.brands).padStart(3)} brands  ${String(a.admitted).padStart(3)} admitted  ${(a.stage ?? "UNMAPPED").padEnd(11)}${a.aliases.length ? ` ← ${a.aliases.join(", ")}` : ""}`),
  ];
  if (r.unmappedAxes.length) lines.push("", `unmapped by the conversion lens: ${r.unmappedAxes.join(", ")}`);
  return lines.join("\n");
}
