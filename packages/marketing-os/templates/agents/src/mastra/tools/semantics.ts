// agents/src/mastra/tools/semantics.ts
//
// Semantic-layer introspection tools (Bonnard grammar). explore_schema lets an
// agent discover the store's marketing data model; describe_field gives the full
// meaning and provenance of any field. query/explain_query arrive in Phase F.

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getStoreModel, searchFields, findView } from "../semantics";

// ---------------------------------------------------------------------------
// explore_schema
// ---------------------------------------------------------------------------
const exploreSchema = createTool({
  id: "explore_schema",
  description:
    "Explore the store's marketing data model. Call with no arguments to list " +
    "all views (what each answers, whether it's available, coverage). Pass a " +
    "`view` to list its measures, dimensions, grains, and freshness. Pass a " +
    "`search` term to find the right field across every view (matches names, " +
    "synonyms, and descriptions) — e.g. search 'cost' to find ads_performance.spend.",
  inputSchema: z.object({
    view: z.string().optional().describe("A view name to inspect in full."),
    search: z.string().optional().describe("A keyword to search for across all fields."),
  }),
  outputSchema: z.any(),
  execute: async (inputData) => {
    const model = await getStoreModel();

    // search mode
    if (inputData.search) {
      const hits = searchFields(model, inputData.search).slice(0, 25);
      return {
        query: inputData.search,
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

    // single-view mode
    if (inputData.view) {
      const view = findView(model, inputData.view);
      if (!view) {
        return {
          error: "UNKNOWN_VIEW",
          message: `No view named '${inputData.view}'.`,
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

    // overview mode
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
  },
});

// ---------------------------------------------------------------------------
// describe_field
// ---------------------------------------------------------------------------
const describeField = createTool({
  id: "describe_field",
  description:
    "Get the full definition of a single field: plain-language meaning, format, " +
    "per-provider provenance (the actual GA4 metric name / Shopify expression), " +
    "derived-measure formula, caveats, synonyms, and example values for enums.",
  inputSchema: z.object({
    view: z.string().describe("The view the field belongs to."),
    field: z.string().describe("The measure or dimension name."),
  }),
  outputSchema: z.any(),
  execute: async (inputData) => {
    const model = await getStoreModel();
    const view = findView(model, inputData.view);
    if (!view) {
      return {
        error: "UNKNOWN_VIEW",
        message: `No view named '${inputData.view}'.`,
        available_views: model.views.map((v) => v.name),
      };
    }

    const measure = view.measures.find((m) => m.name === inputData.field);
    const dimension = view.dimensions.find((d) => d.name === inputData.field);
    const field = measure ?? dimension;

    if (!field) {
      // did-you-mean across this view's fields
      const all = [...view.measures, ...view.dimensions];
      const guesses = all
        .filter(
          (f) =>
            f.name.includes(inputData.field) ||
            inputData.field.includes(f.name) ||
            f.synonyms?.some((s) => s.toLowerCase().includes(inputData.field.toLowerCase()))
        )
        .map((f) => f.name)
        .slice(0, 5);
      return {
        error: "UNKNOWN_FIELD",
        message: `No field '${inputData.field}' on view '${inputData.view}'.`,
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
      ...(dimension
        ? { type: dimension.type, enum_values: dimension.enumValues }
        : {}),
      grains: view.timeDimension?.grains,
    };
  },
});

export const semanticTools = {
  explore_schema: exploreSchema,
  describe_field: describeField,
};
