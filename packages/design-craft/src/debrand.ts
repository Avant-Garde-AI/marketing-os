/**
 * de-brand (spec 35 §1.1): fold label records into the vocabulary.
 *
 * The DTC analog of Arthaus's `de-artist`. We cannot see other brands' edit
 * history, so we label the finished storefront and treat each named treatment
 * as one observation by that brand. Support is per BRAND: many pages and both
 * viewports of one store count once, which is what keeps one heavily-labeled
 * store from promoting its own quirks.
 *
 * Confirmed (human-reviewed) records observe as `earned` and admit on sight.
 * Model records observe as `proposed` and wait for distinct-brand recurrence.
 */
import type { LabelRecord } from "./labels.js";
import { labelRecordSchema } from "./labels.js";
import { DTC_SEED_AXES } from "./ontology.js";
import { observe, type AxisPrompt, type ObserveResult, type Vocabulary } from "./vocabulary.js";

export interface DebrandEvent extends ObserveResult {
  brand: string;
  value: string;
}

export interface DebrandSummary {
  records: number;
  observations: number;
  promoted: DebrandEvent[];
  axesRecognized: string[];
  rejected: DebrandEvent[];
  merged: DebrandEvent[];
}

export function debrand(
  v: Vocabulary,
  records: Iterable<LabelRecord | unknown>,
  opts: { seedAxes?: AxisPrompt[] } = {},
): DebrandSummary {
  const summary: DebrandSummary = { records: 0, observations: 0, promoted: [], axesRecognized: [], rejected: [], merged: [] };
  for (const input of records) {
    const rec = labelRecordSchema.parse(input);
    summary.records++;
    const origin = rec.confirmed ? "earned" : "proposed";

    // Facets are already-admitted values; re-observing them adds this brand's support.
    const facetObs = Object.entries(rec.facets)
      .filter((e): e is [string, string] => typeof e[1] === "string")
      .map(([axis, value]) => ({ axis, value, gloss: null as string | null }));
    const proposalObs = rec.proposals.map((p) => ({ axis: p.axis, value: p.value, gloss: p.gloss ?? null }));

    for (const o of [...facetObs, ...proposalObs]) {
      const res = observe(v, { ...o, brand: rec.brand, origin });
      summary.observations++;
      const ev: DebrandEvent = { ...res, brand: rec.brand, value: o.value };
      if (res.status === "promoted") summary.promoted.push(ev);
      if (res.status === "rejected") summary.rejected.push(ev);
      if (res.mergedFrom) summary.merged.push(ev);
      if (res.axisRecognized) summary.axesRecognized.push(res.axis);
    }
  }
  // Mark seed axes as seeded and carry their question, so the axis merge never absorbs
  // a seed and can judge emergent axes against what each seed actually asks.
  for (const seed of opts.seedAxes ?? DTC_SEED_AXES) {
    const ax = v.axes[seed.axis];
    if (!ax) continue;
    ax.origin = "seeded";
    ax.description ??= seed.description;
  }
  return summary;
}
