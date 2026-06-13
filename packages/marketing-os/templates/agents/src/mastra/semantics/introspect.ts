// agents/src/mastra/semantics/introspect.ts
//
// Shared introspection logic for explore_schema and describe_field, called by
// both the Mastra tools (console agents) and the /api/mcp route (MCP clients) —
// one implementation, two consumption modes.

import { getStoreModel, searchFields, findView } from "./index";

export async function runExploreSchema(args: { view?: string; search?: string }): Promise<unknown> {
  const model = await getStoreModel();

  if (args.search) {
    const hits = searchFields(model, args.search).slice(0, 25);
    return {
      query: args.search,
      matches: hits.map((h) => ({
        view: h.view,
        field: h.field,
        kind: h.kind,
        title: h.title,
        available: h.available,
      })),
      hint:
        hits.length === 0
          ? "No fields matched. Call explore_schema with no arguments to see all views."
          : "Use describe_field({ view, field }) for the full definition of any match.",
    };
  }

  if (args.view) {
    const view = findView(model, args.view);
    if (!view) {
      return {
        error: "UNKNOWN_VIEW",
        message: `No view named '${args.view}'.`,
        available_views: model.views.map((v) => v.name),
      };
    }
    return {
      name: view.name,
      title: view.title,
      description: view.description,
      available: view.available,
      coverage: view.coverage,
      unavailable_reason: view.available ? undefined : view.unavailableReason,
      freshness: view.freshness.latencyNote,
      timeDimension: view.timeDimension,
      defaults: view.defaults,
      measures: view.measures.map((m) => ({
        name: m.name,
        title: m.title,
        description: m.description,
        format: m.format,
        available: m.available !== false,
        discovered: m.discovered ?? false,
      })),
      dimensions: view.dimensions.map((d) => ({
        name: d.name,
        title: d.title,
        description: d.description,
        type: d.type,
        available: d.available !== false,
        discovered: d.discovered ?? false,
      })),
      segments: view.segments?.map((s) => ({ name: s.name, description: s.description })) ?? [],
    };
  }

  return {
    store: model.store,
    connected_providers: model.connectedProviders,
    views: model.views.map((v) => ({
      name: v.name,
      title: v.title,
      description: v.description,
      available: v.available,
      coverage: v.coverage,
      unavailable_reason: v.available ? undefined : v.unavailableReason,
      measure_count: v.measures.length,
      dimension_count: v.dimensions.length,
    })),
    hint: "Inspect a view with explore_schema({ view }); search fields with explore_schema({ search }).",
  };
}

export async function runDescribeField(args: { view: string; field: string }): Promise<unknown> {
  const model = await getStoreModel();
  const view = findView(model, args.view);
  if (!view) {
    return {
      error: "UNKNOWN_VIEW",
      message: `No view named '${args.view}'.`,
      available_views: model.views.map((v) => v.name),
    };
  }

  const measure = view.measures.find((m) => m.name === args.field);
  const dimension = view.dimensions.find((d) => d.name === args.field);
  const field = measure ?? dimension;

  if (!field) {
    const all = [...view.measures, ...view.dimensions];
    const guesses = all
      .filter(
        (f) =>
          f.name.includes(args.field) ||
          args.field.includes(f.name) ||
          f.synonyms?.some((s) => s.toLowerCase().includes(args.field.toLowerCase()))
      )
      .map((f) => f.name)
      .slice(0, 5);
    return {
      error: "UNKNOWN_FIELD",
      message: `No field '${args.field}' on view '${args.view}'.`,
      did_you_mean: guesses,
      valid_measures: view.measures.map((m) => m.name),
      valid_dimensions: view.dimensions.map((d) => d.name),
    };
  }

  return {
    view: view.name,
    field: field.name,
    kind: measure ? "measure" : "dimension",
    title: field.title,
    description: field.description,
    format: field.format,
    available: field.available !== false,
    discovered: field.discovered ?? false,
    synonyms: field.synonyms ?? [],
    caveats: field.caveats ?? [],
    provenance: field.provenance,
    ...(measure ? { agg: measure.agg, formula: measure.formula } : {}),
    ...(dimension ? { type: dimension.type, enum_values: dimension.enumValues } : {}),
    grains: view.timeDimension?.grains,
  };
}
