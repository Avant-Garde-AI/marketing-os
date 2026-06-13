// agents/src/mastra/semantics/compile.ts
//
// Per-store compilation of the default model. Given which providers are
// connected, the store's currency/timezone, and any discovered GA4 custom
// dimensions/metrics, produce a CompiledModel: views flagged available or not,
// discovered fields merged in, coverage annotated.

import { DEFAULT_MODEL } from "./default-model";
import type {
  CompiledModel,
  CompiledView,
  Dimension,
  Measure,
  Provider,
  View,
} from "./types";

export interface DiscoveredField {
  /** GA4 API name, e.g. "customEvent:add_to_cart_value" or "customUser:loyalty_tier" */
  apiName: string;
  displayName: string;
  description?: string;
  scope?: string;
}

export interface CompileContext {
  store: { slug: string; currency: string; timezone: string };
  /** providers connected for this store */
  connectedProviders: Provider[];
  /** GA4 custom dimensions/metrics discovered for the store */
  discovered?: { dimensions: DiscoveredField[]; metrics: DiscoveredField[] };
}

/** Is a view usable given the connected providers? */
function evaluateAvailability(
  view: View,
  connected: Set<Provider>
): { available: boolean; coverage: Provider[]; reason?: string } {
  const coverage = view.requires.filter((p) => connected.has(p));

  if (view.comingSoon) {
    return {
      available: false,
      coverage,
      reason:
        "This view is coming in a future release once the federation engine ships.",
    };
  }

  const ok = view.partialOk
    ? coverage.length > 0
    : view.requires.every((p) => connected.has(p));

  if (ok) return { available: true, coverage };

  const missing = view.requires.filter((p) => !connected.has(p));
  const labels: Record<Provider, string> = {
    ga4: "Google Analytics",
    gads: "Google Ads",
    meta: "Meta Ads",
    shopify: "Shopify",
  };
  const how = view.partialOk
    ? `Connect at least one of: ${missing.map((p) => labels[p]).join(", ")}`
    : `Connect: ${missing.map((p) => labels[p]).join(", ")}`;
  return {
    available: false,
    coverage,
    reason: `${how} in the Shopify admin under Marketing OS → Integrations to unlock this view.`,
  };
}

/** Mark a view's fields available/unavailable based on which providers are connected. */
function annotateFields(view: View, connected: Set<Provider>): View {
  const fieldAvailable = (provenance: { provider: Provider }[]) =>
    provenance.some((b) => connected.has(b.provider));

  return {
    ...view,
    measures: view.measures.map((m) => ({ ...m, available: fieldAvailable(m.provenance) })),
    dimensions: view.dimensions.map((d) => ({ ...d, available: fieldAvailable(d.provenance) })),
  };
}

/** Convert a discovered GA4 field into a Dimension. */
function discoveredToDimension(f: DiscoveredField): Dimension {
  return {
    name: f.apiName.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase(),
    title: f.displayName,
    description: f.description ?? `Custom GA4 dimension (${f.apiName}).`,
    type: "string",
    discovered: true,
    available: true,
    provenance: [{ provider: "ga4", expr: `dimensions.${f.apiName}` }],
  };
}

/** Convert a discovered GA4 field into a Measure. */
function discoveredToMeasure(f: DiscoveredField): Measure {
  return {
    name: f.apiName.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase(),
    title: f.displayName,
    description: f.description ?? `Custom GA4 metric (${f.apiName}).`,
    agg: "sum",
    format: "decimal",
    discovered: true,
    available: true,
    provenance: [{ provider: "ga4", expr: `metrics.${f.apiName}` }],
  };
}

/** Merge discovered GA4 custom fields into the GA4-backed views. */
function mergeDiscovered(view: CompiledView, ctx: CompileContext): CompiledView {
  if (!ctx.discovered) return view;
  // Custom dimensions/metrics describe site behavior → traffic and site_events.
  if (view.name !== "traffic" && view.name !== "site_events") return view;

  const newDims = ctx.discovered.dimensions.map(discoveredToDimension);
  const newMets = ctx.discovered.metrics.map(discoveredToMeasure);

  const existingDimNames = new Set(view.dimensions.map((d) => d.name));
  const existingMetNames = new Set(view.measures.map((m) => m.name));

  return {
    ...view,
    dimensions: [...view.dimensions, ...newDims.filter((d) => !existingDimNames.has(d.name))],
    measures: [...view.measures, ...newMets.filter((m) => !existingMetNames.has(m.name))],
  };
}

export function compileModel(ctx: CompileContext): CompiledModel {
  const connected = new Set(ctx.connectedProviders);

  const views: CompiledView[] = DEFAULT_MODEL.views.map((view) => {
    const annotated = annotateFields(view, connected);
    const { available, coverage, reason } = evaluateAvailability(view, connected);
    const compiled: CompiledView = {
      ...annotated,
      coverage,
      available,
      unavailableReason: reason,
    };
    return available ? mergeDiscovered(compiled, ctx) : compiled;
  });

  return {
    version: DEFAULT_MODEL.version,
    store: ctx.store,
    glossary: DEFAULT_MODEL.glossary,
    views,
    connectedProviders: ctx.connectedProviders,
  };
}
