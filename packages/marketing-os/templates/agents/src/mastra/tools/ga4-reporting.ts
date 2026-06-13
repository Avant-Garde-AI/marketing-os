// agents/src/mastra/tools/ga4-reporting.ts
//
// GA4 official-parity tools — input/output shapes mirror the official
// googleanalytics/google-analytics-mcp server so prompts and skills written
// for it work unchanged. Access tokens resolve through the Marketing OS broker
// (see lib/ga4.ts). When Google is not connected the tools return a structured
// reconnect message instead of throwing, so the agent can guide the user.

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ga4, GA4ReconnectRequiredError } from "../../../lib/ga4";

/** Wrap a GA4 call so reconnect-required surfaces as structured output. */
async function guard<T>(fn: () => Promise<T>): Promise<T | { reconnectRequired: true; message: string; reconnectUrl?: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GA4ReconnectRequiredError) {
      return { reconnectRequired: true, message: err.message, reconnectUrl: err.reconnectUrl };
    }
    throw err;
  }
}

const reconnectShape = z.object({
  reconnectRequired: z.literal(true),
  message: z.string(),
  reconnectUrl: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 1. get_account_summaries
// ---------------------------------------------------------------------------
const getAccountSummaries = createTool({
  id: "get_account_summaries",
  description:
    "List all GA4 account summaries the connected Google account can access, " +
    "including each account's properties. Use this to discover available property IDs.",
  inputSchema: z.object({}),
  outputSchema: z.union([
    z.object({ accountSummaries: z.array(z.any()) }),
    reconnectShape,
  ]),
  execute: async () =>
    guard(async () => {
      const data = await ga4.getAccountSummaries();
      return { accountSummaries: data.accountSummaries ?? [] };
    }),
});

// ---------------------------------------------------------------------------
// 2. get_property_details
// ---------------------------------------------------------------------------
const getPropertyDetails = createTool({
  id: "get_property_details",
  description:
    "Get details about a GA4 property (display name, timezone, currency, " +
    "industry, create time). Defaults to the store's connected property.",
  inputSchema: z.object({
    propertyId: z.string().optional().describe("GA4 property id, e.g. '123456789'. Defaults to the connected property."),
  }),
  outputSchema: z.union([z.record(z.any()), reconnectShape]),
  execute: async (inputData) => guard(() => ga4.getPropertyDetails(inputData.propertyId)),
});

// ---------------------------------------------------------------------------
// 3. list_google_ads_links
// ---------------------------------------------------------------------------
const listGoogleAdsLinks = createTool({
  id: "list_google_ads_links",
  description:
    "List Google Ads links configured on the GA4 property. Useful for confirming " +
    "ads/analytics integration before cross-referencing campaigns.",
  inputSchema: z.object({
    propertyId: z.string().optional(),
  }),
  outputSchema: z.union([
    z.object({ googleAdsLinks: z.array(z.any()) }),
    reconnectShape,
  ]),
  execute: async (inputData) =>
    guard(async () => {
      const data = await ga4.listGoogleAdsLinks(inputData.propertyId);
      return { googleAdsLinks: data.googleAdsLinks ?? [] };
    }),
});

// ---------------------------------------------------------------------------
// 4. run_report
// ---------------------------------------------------------------------------
const runReport = createTool({
  id: "run_report",
  description:
    "Run a GA4 core report (runReport). Provide dimensions, metrics, and date " +
    "ranges. Metrics/dimensions use GA4 API names, e.g. metrics: ['sessions', " +
    "'totalUsers'], dimensions: ['date','sessionDefaultChannelGroup']. " +
    "Date ranges: [{startDate:'30daysAgo', endDate:'today'}].",
  inputSchema: z.object({
    dimensions: z.array(z.string()).default([]).describe("GA4 dimension API names"),
    metrics: z.array(z.string()).min(1).describe("GA4 metric API names"),
    dateRanges: z
      .array(z.object({ startDate: z.string(), endDate: z.string() }))
      .default([{ startDate: "30daysAgo", endDate: "today" }]),
    limit: z.number().min(1).max(250).default(50),
    orderBys: z.array(z.any()).optional(),
    dimensionFilter: z.any().optional(),
    propertyId: z.string().optional(),
  }),
  outputSchema: z.union([z.record(z.any()), reconnectShape]),
  execute: async (inputData) =>
    guard(() =>
      ga4.runReport(
        {
          dimensions: (inputData.dimensions ?? []).map((name) => ({ name })),
          metrics: inputData.metrics.map((name) => ({ name })),
          dateRanges: inputData.dateRanges ?? [{ startDate: "30daysAgo", endDate: "today" }],
          limit: inputData.limit ?? 50,
          ...(inputData.orderBys ? { orderBys: inputData.orderBys } : {}),
          ...(inputData.dimensionFilter ? { dimensionFilter: inputData.dimensionFilter } : {}),
        },
        inputData.propertyId
      )
    ),
});

// ---------------------------------------------------------------------------
// 5. run_realtime_report
// ---------------------------------------------------------------------------
const runRealtimeReport = createTool({
  id: "run_realtime_report",
  description:
    "Run a GA4 realtime report (runRealtimeReport) for activity in the last 30 " +
    "minutes. Realtime supports a limited set of dimensions/metrics, e.g. " +
    "metrics: ['activeUsers'], dimensions: ['unifiedScreenName','country'].",
  inputSchema: z.object({
    dimensions: z.array(z.string()).default([]),
    metrics: z.array(z.string()).min(1),
    limit: z.number().min(1).max(250).default(50),
    propertyId: z.string().optional(),
  }),
  outputSchema: z.union([z.record(z.any()), reconnectShape]),
  execute: async (inputData) =>
    guard(() =>
      ga4.runRealtimeReport(
        {
          dimensions: (inputData.dimensions ?? []).map((name) => ({ name })),
          metrics: inputData.metrics.map((name) => ({ name })),
          limit: inputData.limit ?? 50,
        },
        inputData.propertyId
      )
    ),
});

// ---------------------------------------------------------------------------
// 6. get_custom_dimensions_and_metrics
// ---------------------------------------------------------------------------
const getCustomDimensionsAndMetrics = createTool({
  id: "get_custom_dimensions_and_metrics",
  description:
    "List the GA4 property's custom dimensions and custom metrics so reports can " +
    "reference store-specific events (e.g. add_to_cart_value).",
  inputSchema: z.object({
    propertyId: z.string().optional(),
  }),
  outputSchema: z.union([
    z.object({
      customDimensions: z.array(z.any()),
      customMetrics: z.array(z.any()),
    }),
    reconnectShape,
  ]),
  execute: async (inputData) =>
    guard(() => ga4.getCustomDimensionsAndMetrics(inputData.propertyId)),
});

export const ga4Tools = {
  get_account_summaries: getAccountSummaries,
  get_property_details: getPropertyDetails,
  list_google_ads_links: listGoogleAdsLinks,
  run_report: runReport,
  run_realtime_report: runRealtimeReport,
  get_custom_dimensions_and_metrics: getCustomDimensionsAndMetrics,
};
