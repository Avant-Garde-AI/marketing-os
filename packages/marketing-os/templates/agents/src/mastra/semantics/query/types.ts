// agents/src/mastra/semantics/query/types.ts
//
// Types for the governed query interface (Phase F): the input grammar, the
// validated/compiled form, the self-describing result envelope, and the
// structured error taxonomy.

import type { CompiledView, Dimension, Grain, Measure, Provider } from "../types";

// --- Input grammar ---------------------------------------------------------

export type FilterOp = "eq" | "neq" | "in" | "contains" | "gt" | "gte" | "lt" | "lte" | "between";

export interface QueryFilter {
  field: string;
  op: FilterOp;
  value: unknown;
}

export interface QueryOrder {
  field: string;
  dir: "asc" | "desc";
}

export interface QueryTime {
  grain?: Grain;
  /** named range ("last_30_days", "this_month", "yesterday", "7daysAgo"…) or explicit {start,end} */
  range?: string | { start: string; end: string };
}

export interface QueryInput {
  view: string;
  measures: string[];
  dimensions?: string[];
  time?: QueryTime;
  filters?: QueryFilter[];
  segments?: string[];
  order?: QueryOrder[];
  limit?: number;
  offset?: number;
}

// --- Validated / compiled form ---------------------------------------------

export interface ResolvedFilter {
  field: Measure | Dimension;
  isMeasure: boolean;
  op: FilterOp;
  value: unknown;
}

export interface ResolvedOrder {
  name: string;
  isMeasure: boolean;
  dir: "asc" | "desc";
}

export interface ValidatedQuery {
  view: CompiledView;
  measures: Measure[];
  dimensions: Dimension[];
  time: { grain?: Grain; start: string; end: string; rangeLabel: string; timezone: string };
  filters: ResolvedFilter[];
  order: ResolvedOrder[];
  limit: number;
  offset: number;
  appliedDefaults: string[];
}

// --- Result envelope -------------------------------------------------------

export interface ResultEnvelope {
  data: Record<string, unknown>[];
  meta: {
    view: string;
    coverage: Provider[];
    row_count: number;
    truncated: boolean;
    time: { grain?: Grain; range: { start: string; end: string }; timezone: string };
    currency: string;
    freshness: Record<string, string>;
    applied_defaults: string[];
    caveats: string[];
  };
}

// --- Explain ---------------------------------------------------------------

export interface ExplainResult {
  view: string;
  provider: Provider;
  plan: Record<string, unknown>;
  estimated_rows: number | string;
  warnings: string[];
  note: string;
}

// --- Error taxonomy --------------------------------------------------------

export interface DidYouMean {
  view: string;
  field: string;
  reason: string;
}

export type QueryError =
  | { error: "UNKNOWN_VIEW"; message: string; available_views: string[]; hint: string }
  | {
      error: "VIEW_UNAVAILABLE";
      view: string;
      message: string;
      coverage: Provider[];
      connect_url?: string;
      hint: string;
    }
  | {
      error: "INVALID_FIELD";
      message: string;
      field: string;
      kind: "measure" | "dimension";
      did_you_mean: DidYouMean[];
      valid_measures: string[];
      valid_dimensions: string[];
      hint: string;
    }
  | { error: "INVALID_QUERY"; message: string; hint: string }
  | { error: "RANGE_UNSUPPORTED"; message: string; supported_grains?: Grain[]; hint: string }
  | {
      error: "INCOMPATIBLE_COMBINATION";
      message: string;
      incompatible: string[];
      hint: string;
    }
  | { error: "RECONNECT_REQUIRED"; provider: string; message: string; reconnect_url?: string }
  | { error: "PROVIDER_ERROR"; provider: string; message: string; status?: number; hint: string };

export function isQueryError(x: unknown): x is QueryError {
  return typeof x === "object" && x !== null && "error" in x;
}
