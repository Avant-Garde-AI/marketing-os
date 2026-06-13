// agents/src/mastra/semantics/query/ga4-plan.ts
//
// Compile a ValidatedQuery for a GA4-backed view into a GA4 runReport request,
// and execute it. buildGA4Request is pure so explain_query can show the plan
// without spending quota.

import { ga4 } from "../../../../lib/ga4";
import type { Dimension, Measure } from "../types";
import { ga4GrainDimension } from "./time";
import type { ResolvedFilter, ValidatedQuery } from "./types";

/** Pull the GA4 API name out of a field's provenance (strip the dimensions./metrics. prefix). */
function ga4Name(field: Measure | Dimension): string {
  const b = field.provenance.find((p) => p.provider === "ga4");
  const expr = b?.expr ?? field.name;
  return expr.replace(/^dimensions\./, "").replace(/^metrics\./, "");
}

function buildDimensionFilter(filters: ResolvedFilter[]): Record<string, unknown> | undefined {
  const dimFilters = filters.filter((f) => !f.isMeasure);
  if (dimFilters.length === 0) return undefined;

  const toExpr = (f: ResolvedFilter): Record<string, unknown> => {
    const fieldName = ga4Name(f.field);
    switch (f.op) {
      case "in":
        return {
          filter: {
            fieldName,
            inListFilter: { values: (Array.isArray(f.value) ? f.value : [f.value]).map(String) },
          },
        };
      case "contains":
        return {
          filter: { fieldName, stringFilter: { matchType: "CONTAINS", value: String(f.value) } },
        };
      case "neq":
        return {
          notExpression: {
            filter: { fieldName, stringFilter: { matchType: "EXACT", value: String(f.value) } },
          },
        };
      case "eq":
      default:
        return {
          filter: { fieldName, stringFilter: { matchType: "EXACT", value: String(f.value) } },
        };
    }
  };

  if (dimFilters.length === 1) return toExpr(dimFilters[0]);
  return { andGroup: { expressions: dimFilters.map(toExpr) } };
}

function buildMetricFilter(filters: ResolvedFilter[]): Record<string, unknown> | undefined {
  const metFilters = filters.filter((f) => f.isMeasure);
  if (metFilters.length === 0) return undefined;
  const opMap: Record<string, string> = { gt: "GREATER_THAN", gte: "GREATER_THAN_OR_EQUAL", lt: "LESS_THAN", lte: "LESS_THAN_OR_EQUAL", eq: "EQUAL" };
  const toExpr = (f: ResolvedFilter): Record<string, unknown> => ({
    filter: {
      fieldName: ga4Name(f.field),
      numericFilter: {
        operation: opMap[f.op] ?? "GREATER_THAN",
        value: { doubleValue: Number(f.value) },
      },
    },
  });
  if (metFilters.length === 1) return toExpr(metFilters[0]);
  return { andGroup: { expressions: metFilters.map(toExpr) } };
}

export interface GA4Plan {
  request: Record<string, unknown>;
  /** canonical output column names, in order (dimensions then metrics) */
  dimensionCols: string[];
  metricCols: string[];
}

export function buildGA4Request(vq: ValidatedQuery): GA4Plan {
  const dimensionCols: string[] = [];
  const ga4Dimensions: { name: string }[] = [];

  // time grain dimension first (labeled as the view's time dimension name, "date")
  const timeName = vq.view.timeDimension?.name ?? "date";
  if (vq.time.grain) {
    const gd = ga4GrainDimension(vq.time.grain);
    if (gd) {
      ga4Dimensions.push({ name: gd });
      dimensionCols.push(timeName);
    }
  }

  for (const d of vq.dimensions) {
    if (d.name === timeName && vq.time.grain) continue; // already added via grain
    ga4Dimensions.push({ name: ga4Name(d) });
    dimensionCols.push(d.name);
  }

  const metricCols = vq.measures.map((m) => m.name);
  const ga4Metrics = vq.measures.map((m) => ({ name: ga4Name(m) }));

  const orderBys = vq.order.map((o) => {
    const field = o.isMeasure
      ? vq.measures.find((m) => m.name === o.name)!
      : vq.dimensions.find((d) => d.name === o.name);
    const apiName = o.name === timeName && vq.time.grain ? ga4GrainDimension(vq.time.grain)! : field ? ga4Name(field) : o.name;
    return o.isMeasure
      ? { metric: { metricName: apiName }, desc: o.dir === "desc" }
      : { dimension: { dimensionName: apiName }, desc: o.dir === "desc" };
  });

  const dimensionFilter = buildDimensionFilter(vq.filters);
  const metricFilter = buildMetricFilter(vq.filters);

  const request: Record<string, unknown> = {
    dateRanges: [{ startDate: vq.time.start, endDate: vq.time.end }],
    dimensions: ga4Dimensions,
    metrics: ga4Metrics,
    limit: vq.limit,
    ...(vq.offset ? { offset: vq.offset } : {}),
    ...(orderBys.length ? { orderBys } : {}),
    ...(dimensionFilter ? { dimensionFilter } : {}),
    ...(metricFilter ? { metricFilter } : {}),
  };

  return { request, dimensionCols, metricCols };
}

export interface ProviderResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export async function runGA4Query(vq: ValidatedQuery): Promise<ProviderResult> {
  const plan = buildGA4Request(vq);
  const resp = (await ga4.runReport(plan.request)) as {
    rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
    rowCount?: number;
  };

  const rows = (resp.rows ?? []).map((r) => {
    const obj: Record<string, unknown> = {};
    plan.dimensionCols.forEach((name, i) => {
      obj[name] = r.dimensionValues?.[i]?.value ?? null;
    });
    plan.metricCols.forEach((name, j) => {
      const raw = r.metricValues?.[j]?.value;
      obj[name] = raw === undefined ? null : Number(raw);
    });
    return obj;
  });

  const totalRows = resp.rowCount ?? rows.length;
  return { rows, rowCount: rows.length, truncated: totalRows > rows.length };
}
