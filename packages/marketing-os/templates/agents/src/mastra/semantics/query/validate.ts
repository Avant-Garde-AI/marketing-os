// agents/src/mastra/semantics/query/validate.ts
//
// Validate a QueryInput against the compiled model. Errors are structured
// guidance (did_you_mean, valid alternatives, connect prompts), never bare
// failures — this is the first half of the agent self-refinement loop.

import type { CompiledModel, Dimension, Measure } from "../types";
import { searchFields } from "../index";
import { resolveRange, ga4GrainDimension, GA4_SUPPORTED_GRAINS } from "./time";
import type {
  DidYouMean,
  QueryError,
  QueryInput,
  ResolvedFilter,
  ResolvedOrder,
  ValidatedQuery,
} from "./types";

const VALID_OPS = new Set(["eq", "neq", "in", "contains", "gt", "gte", "lt", "lte", "between"]);

/** Cheap edit distance for did-you-mean ranking. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Build did-you-mean suggestions for an unknown field name, model-wide. */
function suggestField(model: CompiledModel, name: string, currentView: string): DidYouMean[] {
  const out: DidYouMean[] = [];
  const seen = new Set<string>();

  // 1. synonym / substring matches across the whole model
  for (const hit of searchFields(model, name).slice(0, 6)) {
    const key = `${hit.view}.${hit.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      view: hit.view,
      field: hit.field,
      reason:
        hit.view === currentView
          ? `similar ${hit.kind} on this view`
          : `${hit.kind} on view '${hit.view}'`,
    });
  }

  // 2. near edit-distance matches on field names (typos)
  if (out.length < 4) {
    const lower = name.toLowerCase();
    const candidates: { view: string; field: string; dist: number }[] = [];
    for (const v of model.views) {
      for (const f of [...v.measures, ...v.dimensions]) {
        const d = editDistance(lower, f.name.toLowerCase());
        if (d <= Math.max(2, Math.floor(f.name.length / 3))) {
          candidates.push({ view: v.name, field: f.name, dist: d });
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    for (const c of candidates.slice(0, 4)) {
      const key = `${c.view}.${c.field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ view: c.view, field: c.field, reason: "similar spelling" });
    }
  }

  return out.slice(0, 5);
}

function providerLabel(p: string): string {
  return { ga4: "Google Analytics", gads: "Google Ads", meta: "Meta Ads", shopify: "Shopify" }[p] ?? p;
}

export function validateQuery(
  model: CompiledModel,
  input: QueryInput,
  connectUrl?: string
): ValidatedQuery | QueryError {
  const appliedDefaults: string[] = [];

  // --- view ---
  const view = model.views.find((v) => v.name === input.view);
  if (!view) {
    return {
      error: "UNKNOWN_VIEW",
      message: `No view named '${input.view}'.`,
      available_views: model.views.map((v) => v.name),
      hint: "Call explore_schema() to list views and what each answers.",
    };
  }
  if (!view.available) {
    return {
      error: "VIEW_UNAVAILABLE",
      view: view.name,
      message: view.unavailableReason ?? `The '${view.name}' view is not available for this store.`,
      coverage: view.coverage,
      connect_url: connectUrl,
      hint: view.comingSoon
        ? "This view is not implemented yet; use the available views in the meantime."
        : "Connect the required provider in the Shopify admin under Marketing OS → Integrations.",
    };
  }

  // --- measures (at least one required) ---
  if (!input.measures || input.measures.length === 0) {
    return {
      error: "INVALID_QUERY",
      message: "A query needs at least one measure.",
      hint: `Available measures on '${view.name}': ${view.measures.map((m) => m.name).join(", ")}`,
    };
  }

  const resolvedMeasures: Measure[] = [];
  for (const name of input.measures) {
    const m = view.measures.find((x) => x.name === name);
    if (!m) {
      return {
        error: "INVALID_FIELD",
        message: `Unknown measure '${name}' on view '${view.name}'.`,
        field: name,
        kind: "measure",
        did_you_mean: suggestField(model, name, view.name),
        valid_measures: view.measures.map((x) => x.name),
        valid_dimensions: view.dimensions.map((x) => x.name),
        hint: `Use explore_schema({ search: '${name}' }) to find where this field lives.`,
      };
    }
    if (m.available === false) {
      return {
        error: "VIEW_UNAVAILABLE",
        view: view.name,
        message: `Measure '${name}' needs ${m.provenance.map((p) => providerLabel(p.provider)).join(" or ")}, which isn't connected.`,
        coverage: view.coverage,
        connect_url: connectUrl,
        hint: "Connect the provider in the Shopify admin under Marketing OS → Integrations.",
      };
    }
    resolvedMeasures.push(m);
  }

  // --- dimensions ---
  const resolvedDimensions: Dimension[] = [];
  for (const name of input.dimensions ?? []) {
    const d = view.dimensions.find((x) => x.name === name);
    if (!d) {
      return {
        error: "INVALID_FIELD",
        message: `Unknown dimension '${name}' on view '${view.name}'.`,
        field: name,
        kind: "dimension",
        did_you_mean: suggestField(model, name, view.name),
        valid_measures: view.measures.map((x) => x.name),
        valid_dimensions: view.dimensions.map((x) => x.name),
        hint: `Use explore_schema({ view: '${view.name}' }) to see valid dimensions.`,
      };
    }
    resolvedDimensions.push(d);
  }

  // --- filters ---
  const resolvedFilters: ResolvedFilter[] = [];
  for (const f of input.filters ?? []) {
    if (!VALID_OPS.has(f.op)) {
      return {
        error: "INVALID_QUERY",
        message: `Unknown filter operator '${f.op}' on '${f.field}'.`,
        hint: `Valid operators: ${[...VALID_OPS].join(", ")}.`,
      };
    }
    const dim = view.dimensions.find((x) => x.name === f.field);
    const meas = view.measures.find((x) => x.name === f.field);
    const field = dim ?? meas;
    if (!field) {
      return {
        error: "INVALID_FIELD",
        message: `Filter references unknown field '${f.field}' on view '${view.name}'.`,
        field: f.field,
        kind: dim ? "dimension" : "measure",
        did_you_mean: suggestField(model, f.field, view.name),
        valid_measures: view.measures.map((x) => x.name),
        valid_dimensions: view.dimensions.map((x) => x.name),
        hint: "Filters can reference any measure or dimension on the view.",
      };
    }
    resolvedFilters.push({ field, isMeasure: !!meas, op: f.op, value: f.value });
  }

  // --- order ---
  const orderable = new Set([
    ...resolvedMeasures.map((m) => m.name),
    ...resolvedDimensions.map((d) => d.name),
  ]);
  const resolvedOrder: ResolvedOrder[] = [];
  for (const o of input.order ?? []) {
    if (!orderable.has(o.field)) {
      return {
        error: "INVALID_QUERY",
        message: `Cannot order by '${o.field}' — it must be one of the selected measures or dimensions.`,
        hint: `Selected fields: ${[...orderable].join(", ")}.`,
      };
    }
    resolvedOrder.push({
      name: o.field,
      isMeasure: resolvedMeasures.some((m) => m.name === o.field),
      dir: o.dir,
    });
  }

  // --- time ---
  const grain = input.time?.grain;
  if (grain && view.requires.includes("ga4") && !view.requires.includes("shopify")) {
    if (!ga4GrainDimension(grain)) {
      return {
        error: "RANGE_UNSUPPORTED",
        message: `Grain '${grain}' is not supported for GA4-backed views.`,
        supported_grains: GA4_SUPPORTED_GRAINS,
        hint: "Use one of the supported grains, or omit grain for a single total.",
      };
    }
  }
  const range = resolveRange(input.time?.range, model.store.timezone, view.defaults?.timeRange);
  if ("error" in range) {
    return {
      error: "RANGE_UNSUPPORTED",
      message: range.error,
      hint: `Supported named ranges: ${range.supported.join(", ")}, or { start, end } in YYYY-MM-DD.`,
    };
  }
  if (!input.time?.range && view.defaults?.timeRange) {
    appliedDefaults.push(`time range: ${view.defaults.timeRange}`);
  }

  // --- defaults: order ---
  if (resolvedOrder.length === 0 && view.defaults?.order) {
    for (const o of view.defaults.order) {
      if (orderable.has(o.field)) {
        resolvedOrder.push({
          name: o.field,
          isMeasure: resolvedMeasures.some((m) => m.name === o.field),
          dir: o.dir,
        });
        appliedDefaults.push(`order: ${o.field} ${o.dir}`);
      }
    }
  }

  const limit = input.limit ?? 50;
  if (limit < 1 || limit > 250) {
    return {
      error: "INVALID_QUERY",
      message: `limit must be between 1 and 250 (got ${limit}).`,
      hint: "Use offset for pagination beyond the first page.",
    };
  }

  return {
    view,
    measures: resolvedMeasures,
    dimensions: resolvedDimensions,
    time: { grain, start: range.start, end: range.end, rangeLabel: range.label, timezone: model.store.timezone },
    filters: resolvedFilters,
    order: resolvedOrder,
    limit,
    offset: input.offset ?? 0,
    appliedDefaults,
  };
}
