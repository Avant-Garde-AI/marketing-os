// agents/src/mastra/tools/semantics.ts
//
// Semantic-layer introspection tools (Bonnard grammar). explore_schema lets an
// agent discover the store's marketing data model; describe_field gives the full
// meaning and provenance of any field. query/explain_query arrive in Phase F.

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { runExploreSchema, runDescribeField } from "../semantics/introspect";
import { runQuery, explainQuery, type QueryInput } from "../semantics/query";

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
  execute: async (inputData) => runExploreSchema(inputData),
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
  execute: async (inputData) => runDescribeField(inputData),
});

// ---------------------------------------------------------------------------
// query / explain_query
// ---------------------------------------------------------------------------

const queryInputSchema = z.object({
  view: z.string().describe("The view to query (from explore_schema)."),
  measures: z.array(z.string()).min(1).describe("Measure names to aggregate."),
  dimensions: z.array(z.string()).optional().describe("Dimension names to group by."),
  time: z
    .object({
      grain: z.enum(["hour", "day", "week", "month", "quarter", "year"]).optional(),
      range: z
        .union([
          z.string().describe("named range: last_30_days, this_month, yesterday, 7daysAgo, …"),
          z.object({ start: z.string(), end: z.string() }),
        ])
        .optional(),
    })
    .optional(),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(["eq", "neq", "in", "contains", "gt", "gte", "lt", "lte", "between"]),
        value: z.any(),
      })
    )
    .optional(),
  order: z
    .array(z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }))
    .optional(),
  limit: z.number().min(1).max(250).optional(),
  offset: z.number().min(0).optional(),
});

const query = createTool({
  id: "query",
  description:
    "Run a governed query against a semantic view and get a self-describing " +
    "result envelope (data + coverage, freshness, timezone, currency, caveats, " +
    "truncation). Validates against the model first — invalid fields return " +
    "did-you-mean guidance. Prefer this over the raw GA4 tools for marketing " +
    "questions. Example: { view:'traffic', measures:['sessions'], " +
    "dimensions:['channel'], time:{ range:'last_30_days' }, order:[{field:'sessions',dir:'desc'}] }.",
  inputSchema: queryInputSchema,
  outputSchema: z.any(),
  execute: async (inputData) => runQuery(inputData as QueryInput),
});

const explain = createTool({
  id: "explain_query",
  description:
    "Validate a query and return the compiled plan WITHOUT executing it (zero " +
    "quota cost). Use this to check an expensive or uncertain query before " +
    "running it: it returns the GA4 request body or Shopify fetch plan, the " +
    "output columns, and any warnings. Same input shape as query.",
  inputSchema: queryInputSchema,
  outputSchema: z.any(),
  execute: async (inputData) => explainQuery(inputData as QueryInput),
});

export const semanticTools = {
  explore_schema: exploreSchema,
  describe_field: describeField,
  explain_query: explain,
  query,
};
