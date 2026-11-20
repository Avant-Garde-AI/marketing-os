/**
 * Open dataset export (spec 35 §4, M2).
 *
 * Emits labels as JSONL plus a generated datasheet. Labels only: the export
 * re-validates every row against `labelRecordSchema`, which has no pixel
 * field, and strips any unknown keys, so a capture path or embedded image a
 * caller attached can never ride out in a release.
 */
import { labelRecordSchema, type LabelRecord } from "./labels.js";
import { isRecognized, vocabularyStats, type Vocabulary } from "./vocabulary.js";

export function toJsonl(records: Iterable<unknown>): string {
  const lines: string[] = [];
  for (const r of records) lines.push(JSON.stringify(labelRecordSchema.parse(r)));
  return lines.length ? lines.join("\n") + "\n" : "";
}

export function parseJsonl(text: string): LabelRecord[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return labelRecordSchema.parse(JSON.parse(l));
      } catch (e) {
        throw new Error(`labels line ${i + 1}: ${(e as Error).message}`);
      }
    });
}

export function datasheet(records: LabelRecord[], v: Vocabulary, meta: { name: string; version: string }): string {
  const brands = new Set(records.map((r) => r.brand));
  const byCategory = new Map<string, Set<string>>();
  for (const r of records) (byCategory.get(r.category) ?? byCategory.set(r.category, new Set()).get(r.category)!).add(r.brand);
  const byPage = new Map<string, number>();
  for (const r of records) byPage.set(r.pageType, (byPage.get(r.pageType) ?? 0) + 1);
  const confirmed = records.filter((r) => r.confirmed).length;
  const labelers = [...new Set(records.map((r) => r.labeler.id))];
  const s = vocabularyStats(v);
  const dates = records.map((r) => r.capturedAt.slice(0, 10)).sort();
  const byMonth = new Map<string, Set<string>>();
  for (const r of records) (byMonth.get(r.capturedAt.slice(0, 7)) ?? byMonth.set(r.capturedAt.slice(0, 7), new Set()).get(r.capturedAt.slice(0, 7))!).add(r.brand);

  return [
    `# Datasheet: ${meta.name} v${meta.version}`,
    "",
    "Design-craft labels for DTC storefront pages (Marketing OS spec 35).",
    "",
    "## Composition",
    "",
    `- Records: ${records.length} (${confirmed} human-confirmed)`,
    `- Brands: ${brands.size}`,
    `- Labelers: ${labelers.join(", ") || "none"}`,
    `- Captured: ${dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "n/a"}. Storefront creative is seasonal (sale periods skew offer and hero axes).`,
    "",
    "| Category | Brands |",
    "|---|--:|",
    ...[...byCategory.entries()].sort().map(([c, b]) => `| ${c} | ${b.size} |`),
    "",
    "| Capture month (wave) | Brands |",
    "|---|--:|",
    ...[...byMonth.entries()].sort().map(([m, b]) => `| ${m} | ${b.size} |`),
    "",
    "| Page type | Records |",
    "|---|--:|",
    ...[...byPage.entries()].sort().map(([p, n]) => `| ${p} | ${n} |`),
    "",
    "## Vocabulary at export",
    "",
    `- Recognized axes: ${s.recognizedAxes} · axes with admitted values: ${s.admittedAxes}`,
    `- Admitted values: ${s.admittedValues} · pending: ${s.pendingValues}`,
    ...mergeState(v),
    "",
    "## What is NOT included",
    "",
    "- **No screenshots or page content.** Each row references its capture by sha256 only.",
    "  Recapture from `url` + `capturedAt` if pixels are needed; storefront imagery belongs to its owners.",
    "- No performance or conversion data. Selection was on visual distinctiveness and reputation, not observed outcomes.",
    "",
    "## Known limitations",
    "",
    "- Model-labeled rows (`confirmed: false`) carry teacher-model bias. Train and evaluate on confirmed rows where it matters.",
    "- Labels describe a page at `capturedAt`. Storefronts change.",
    "",
  ].join("\n");
}

/** Which recognized axes have been through the judged semantic merge. Unmerged axes still carry synonym variants as separate values. */
function mergeState(v: Vocabulary): string[] {
  const recognized = Object.keys(v.axes).filter((a) => isRecognized(v, a)).sort();
  const merged = recognized.filter((a) => Object.values(v.axes[a]!.values).some((e) => e.merges?.some((m) => m.method === "semantic")));
  const n = Object.values(v.axes).reduce((t, ax) => t + Object.values(ax.values).reduce((u, e) => u + (e.merges?.filter((m) => m.method === "semantic").length ?? 0), 0), 0);
  if (!n) return ["- Semantic merge: not run. Synonym variants are separate values."];
  const pending = recognized.filter((a) => !merged.includes(a));
  return [
    `- Semantic merge: ${n} judged merges across ${merged.length} of ${recognized.length} recognized axes.`,
    ...(pending.length ? [`- Not yet merged (synonym variants still separate): ${pending.join(", ")}`] : []),
  ];
}
