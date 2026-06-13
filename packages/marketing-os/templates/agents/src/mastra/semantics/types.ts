// agents/src/mastra/semantics/types.ts
//
// Manifest types for the Marketing OS semantic layer. The model is declarative
// data, not code: a typed manifest the runtime compiles per store. Introspection
// (explore_schema), validation, did-you-mean, and the query planner all fall out
// of this one structure.

export type Provider = "ga4" | "gads" | "meta" | "shopify";

export type Grain = "hour" | "day" | "week" | "month" | "quarter" | "year";

export type FieldFormat =
  | "currency"
  | "percent"
  | "integer"
  | "decimal"
  | "duration"
  | "id"
  | "text"
  | "date";

/** How a field is computed for one provider. */
export interface ProviderBinding {
  provider: Provider;
  /**
   * Provider-native expression:
   *   ga4:     "metrics.sessions" | "dimensions.sessionDefaultChannelGroup"
   *   gads:    "metrics.cost_micros/1e6" | "segments.date" | "campaign.name"
   *   meta:    "insights.spend" | "campaign_name"
   *   shopify: "orders.total_price"
   */
  expr: string;
  notes?: string;
}

export interface FieldMeta {
  /** canonical snake_case, unique within the view */
  name: string;
  /** human label */
  title: string;
  /** one-paragraph plain-language definition */
  description: string;
  /** alternate phrasings: "cost" → spend, "turnover" → revenue */
  synonyms?: string[];
  format?: FieldFormat;
  /** surfaced in describe_field AND in query result envelopes */
  caveats?: string[];
  /** how this field is computed, per provider */
  provenance: ProviderBinding[];
  /** true when merged in by per-store discovery (e.g. a GA4 custom dimension) */
  discovered?: boolean;
  /** false when the field's provider is not connected for this store */
  available?: boolean;
}

export interface Measure extends FieldMeta {
  agg: "sum" | "avg" | "count" | "count_distinct" | "derived";
  /** for agg=derived: a formula referencing canonical measure names, e.g. "conversion_value / spend" */
  formula?: string;
}

export interface Dimension extends FieldMeta {
  type: "string" | "number" | "date" | "boolean" | "enum";
  /** for type=enum: channel taxonomy, platform, device, … */
  enumValues?: string[];
}

export interface Filter {
  field: string;
  op: "eq" | "neq" | "in" | "contains" | "gt" | "gte" | "lt" | "lte" | "between";
  value: unknown;
}

export interface Order {
  field: string;
  dir: "asc" | "desc";
}

export interface Segment {
  name: string;
  description: string;
  filter: Filter;
}

export interface TimeDimension {
  name: string;
  grains: Grain[];
  minDate?: string;
}

export interface CompatibilityRule {
  /** fields that cannot be queried together (e.g. a GA4 dim/metric incompatibility) */
  incompatible: string[];
  reason: string;
}

export interface View {
  /** canonical name, e.g. "ads_performance" */
  name: string;
  title: string;
  /** what questions this view answers — LLM-facing */
  description: string;
  /** providers needed; blended views list several */
  requires: Provider[];
  /** when true, usable with a subset of `requires` (exposed with coverage metadata) */
  partialOk?: boolean;
  /**
   * when true, the view is declared but its query engine is not yet implemented
   * (e.g. blended views before the federation layer ships). It surfaces in
   * explore_schema as unavailable with a "coming in a future release" note.
   */
  comingSoon?: boolean;
  measures: Measure[];
  dimensions: Dimension[];
  timeDimension?: TimeDimension;
  segments?: Segment[];
  defaults?: { timeRange?: string; order?: Order[] };
  compatibility?: CompatibilityRule[];
  freshness: { latencyNote: string };
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export interface SemanticModel {
  version: string;
  store: { slug: string; currency: string; timezone: string };
  views: View[];
  glossary: GlossaryEntry[];
}

// ---------------------------------------------------------------------------
// Compiled view metadata (added during per-store compilation)
// ---------------------------------------------------------------------------

export interface CompiledView extends View {
  /** providers required by this view that ARE connected for the store */
  coverage: Provider[];
  /** whether the view is usable for this store right now */
  available: boolean;
  /** when unavailable, why — and what to do about it */
  unavailableReason?: string;
}

export interface CompiledModel extends Omit<SemanticModel, "views"> {
  views: CompiledView[];
  /** providers connected for this store at compile time */
  connectedProviders: Provider[];
}
