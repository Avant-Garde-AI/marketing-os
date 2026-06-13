// agents/src/mastra/semantics/mcp-resources.ts
//
// MCP resources for the store's marketing data model. Resources are the
// read-only documents an MCP client can pull into context: the compiled
// manifest, individual views, the glossary, connection status, and a cookbook.

import { getStoreModel } from "./index";
import { DEFAULT_MODEL } from "./default-model";

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export const STATIC_RESOURCES: McpResource[] = [
  {
    uri: "semantic://manifest",
    name: "Semantic manifest",
    description: "The full compiled marketing data model for this store (views, measures, dimensions, coverage).",
    mimeType: "application/json",
  },
  {
    uri: "semantic://glossary",
    name: "Metric glossary",
    description: "Cross-view metric semantics and reconciliation notes (platform vs blended ROAS, sessions ≠ clicks, …).",
    mimeType: "application/json",
  },
  {
    uri: "semantic://connections",
    name: "Provider connections",
    description: "Which data providers are connected, their coverage, and how to connect the rest.",
    mimeType: "application/json",
  },
  {
    uri: "semantic://cookbook",
    name: "Query cookbook",
    description: "Worked examples: question → query JSON → why it is shaped that way.",
    mimeType: "application/json",
  },
];

export const RESOURCE_TEMPLATES: McpResourceTemplate[] = [
  {
    uriTemplate: "semantic://views/{view}",
    name: "View schema",
    description: "One view's full schema (measures, dimensions, grains, freshness, defaults).",
    mimeType: "application/json",
  },
];

const COOKBOOK = [
  {
    question: "How much traffic did we get by channel last month?",
    query: { view: "traffic", measures: ["sessions", "total_users"], dimensions: ["channel"], time: { range: "last_month" }, order: [{ field: "sessions", dir: "desc" }] },
    why: "traffic is the GA4 site-visits view; channel is the default channel group; order by sessions desc to rank.",
  },
  {
    question: "What's our revenue trend by week this year?",
    query: { view: "commerce", measures: ["orders", "gross_revenue", "aov"], dimensions: ["date"], time: { grain: "week", range: "this_year" } },
    why: "commerce is Shopify ground truth; grain=week buckets the date dimension; aov is derived from revenue/orders.",
  },
  {
    question: "Which landing pages convert best?",
    query: { view: "traffic", measures: ["sessions", "engaged_sessions", "engagement_rate"], dimensions: ["landing_page"], time: { range: "last_30_days" }, order: [{ field: "engagement_rate", dir: "desc" }], limit: 20 },
    why: "engagement_rate is the closest GA4 proxy for landing-page quality; rank desc and cap at 20.",
  },
  {
    question: "New vs returning customer revenue last quarter?",
    query: { view: "commerce", measures: ["orders", "gross_revenue"], dimensions: ["customer_type"], time: { range: "last_90_days" } },
    why: "customer_type splits orders by first-vs-repeat purchase, derived from Shopify customer order counts.",
  },
];

/** Read a resource by URI. Returns the text content (JSON) or null if unknown. */
export async function readResource(uri: string): Promise<string | null> {
  if (uri === "semantic://manifest") {
    return JSON.stringify(await getStoreModel(), null, 2);
  }
  if (uri === "semantic://glossary") {
    return JSON.stringify(DEFAULT_MODEL.glossary, null, 2);
  }
  if (uri === "semantic://connections") {
    const model = await getStoreModel();
    return JSON.stringify(
      {
        store: model.store,
        connected: model.connectedProviders,
        views: model.views.map((v) => ({
          name: v.name,
          available: v.available,
          coverage: v.coverage,
          unavailable_reason: v.available ? undefined : v.unavailableReason,
        })),
        connect_more: "Open Marketing OS → Integrations in the Shopify admin to connect Google Ads or Meta.",
      },
      null,
      2
    );
  }
  if (uri === "semantic://cookbook") {
    return JSON.stringify(COOKBOOK, null, 2);
  }
  const viewMatch = uri.match(/^semantic:\/\/views\/(.+)$/);
  if (viewMatch) {
    const model = await getStoreModel();
    const view = model.views.find((v) => v.name === viewMatch[1]);
    if (!view) return null;
    return JSON.stringify(view, null, 2);
  }
  return null;
}
