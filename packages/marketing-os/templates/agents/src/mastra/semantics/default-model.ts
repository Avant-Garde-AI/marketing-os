// agents/src/mastra/semantics/default-model.ts
//
// The default semantic model that ships with the scaffold. Tranche 1 wires the
// GA4 + Shopify views (traffic, acquisition, site_events, commerce). The ads and
// blended views are declared so they surface in explore_schema as unavailable
// with connect prompts until Google Ads / Meta and the federation engine land.

import type { Dimension, Measure, View, GlossaryEntry, SemanticModel } from "./types";

// Reusable GA4 dimensions ----------------------------------------------------

const dimDate: Dimension = {
  name: "date",
  title: "Date",
  description: "Calendar date in the store's timezone.",
  type: "date",
  format: "date",
  provenance: [{ provider: "ga4", expr: "dimensions.date" }],
};

const dimChannel: Dimension = {
  name: "channel",
  title: "Default channel group",
  description:
    "GA4's default channel grouping for the session (Direct, Organic Search, Paid Search, Organic Social, Email, Referral, …).",
  type: "enum",
  synonyms: ["channel group", "traffic channel"],
  enumValues: [
    "Direct",
    "Organic Search",
    "Paid Search",
    "Organic Social",
    "Paid Social",
    "Email",
    "Referral",
    "Display",
    "Affiliates",
    "Unassigned",
  ],
  provenance: [{ provider: "ga4", expr: "dimensions.sessionDefaultChannelGroup" }],
};

const dimSource: Dimension = {
  name: "source",
  title: "Session source",
  description: "The origin of the session's traffic (e.g. google, direct, newsletter).",
  type: "string",
  synonyms: ["utm source"],
  provenance: [{ provider: "ga4", expr: "dimensions.sessionSource" }],
};

const dimMedium: Dimension = {
  name: "medium",
  title: "Session medium",
  description: "The delivery mechanism of the session's traffic (e.g. organic, cpc, referral, email).",
  type: "string",
  synonyms: ["utm medium"],
  provenance: [{ provider: "ga4", expr: "dimensions.sessionMedium" }],
};

const dimDevice: Dimension = {
  name: "device",
  title: "Device category",
  description: "The device category of the user (desktop, mobile, tablet).",
  type: "enum",
  enumValues: ["desktop", "mobile", "tablet"],
  provenance: [{ provider: "ga4", expr: "dimensions.deviceCategory" }],
};

// GA4 reusable measures ------------------------------------------------------

const measSessions: Measure = {
  name: "sessions",
  title: "Sessions",
  description: "The number of sessions that began on the site (GA4 sessions).",
  agg: "sum",
  format: "integer",
  synonyms: ["visits"],
  caveats: ["GA4 sessions are not the same as ad clicks — see the glossary entry 'sessions ≠ clicks'."],
  provenance: [{ provider: "ga4", expr: "metrics.sessions" }],
};

const measTotalUsers: Measure = {
  name: "total_users",
  title: "Total users",
  description: "The number of distinct users who had at least one session.",
  agg: "sum",
  format: "integer",
  synonyms: ["users", "visitors"],
  provenance: [{ provider: "ga4", expr: "metrics.totalUsers" }],
};

const measNewUsers: Measure = {
  name: "new_users",
  title: "New users",
  description: "The number of users who interacted with the site for the first time.",
  agg: "sum",
  format: "integer",
  provenance: [{ provider: "ga4", expr: "metrics.newUsers" }],
};

const measKeyEvents: Measure = {
  name: "key_events",
  title: "Key events",
  description:
    "Count of GA4 key events (conversions). These are GA4-attributed, distinct from platform ad conversions and Shopify orders.",
  agg: "sum",
  format: "integer",
  synonyms: ["conversions", "goals"],
  caveats: [
    "GA4 key_events are GA4-attributed and differ from platform ad conversions and from Shopify orders. See glossary.",
  ],
  provenance: [{ provider: "ga4", expr: "metrics.keyEvents" }],
};

// Views ----------------------------------------------------------------------

const traffic: View = {
  name: "traffic",
  title: "Site traffic",
  description:
    "Site visits and engagement from Google Analytics. Answers: how much traffic, from what channels/sources/devices, and how engaged.",
  requires: ["ga4"],
  freshness: { latencyNote: "GA4 intraday data lags ~4–8h; finalized after ~48h." },
  timeDimension: { name: "date", grains: ["day", "week", "month", "quarter", "year"] },
  defaults: { timeRange: "last_30_days", order: [{ field: "date", dir: "asc" }] },
  measures: [
    measSessions,
    measTotalUsers,
    measNewUsers,
    {
      name: "engaged_sessions",
      title: "Engaged sessions",
      description: "Sessions that lasted 10s+, had a key event, or 2+ pageviews.",
      agg: "sum",
      format: "integer",
      provenance: [{ provider: "ga4", expr: "metrics.engagedSessions" }],
    },
    {
      name: "engagement_rate",
      title: "Engagement rate",
      description: "The share of sessions that were engaged.",
      agg: "avg",
      format: "percent",
      provenance: [{ provider: "ga4", expr: "metrics.engagementRate" }],
    },
    {
      name: "avg_session_duration",
      title: "Average session duration",
      description: "Average length of a session, in seconds.",
      agg: "avg",
      format: "duration",
      provenance: [{ provider: "ga4", expr: "metrics.averageSessionDuration" }],
    },
    {
      name: "views",
      title: "Views",
      description: "The number of screen/page views.",
      agg: "sum",
      format: "integer",
      synonyms: ["pageviews", "page views"],
      provenance: [{ provider: "ga4", expr: "metrics.screenPageViews" }],
    },
  ],
  dimensions: [
    dimDate,
    dimChannel,
    dimSource,
    dimMedium,
    dimDevice,
    {
      name: "country",
      title: "Country",
      description: "The country from which the session originated.",
      type: "string",
      provenance: [{ provider: "ga4", expr: "dimensions.country" }],
    },
    {
      name: "landing_page",
      title: "Landing page",
      description: "The first page (path + query) of the session.",
      type: "string",
      provenance: [{ provider: "ga4", expr: "dimensions.landingPagePlusQueryString" }],
    },
  ],
};

const acquisition: View = {
  name: "acquisition",
  title: "Acquisition",
  description:
    "Where visitors come from and how well sources convert (GA4). Answers: which channels/campaigns drive new users and key events.",
  requires: ["ga4"],
  freshness: { latencyNote: "GA4 intraday data lags ~4–8h; finalized after ~48h." },
  timeDimension: { name: "date", grains: ["day", "week", "month", "quarter", "year"] },
  defaults: { timeRange: "last_30_days" },
  measures: [
    measSessions,
    measNewUsers,
    measKeyEvents,
    {
      name: "session_key_event_rate",
      title: "Session key event rate",
      description: "The share of sessions that included a key event.",
      agg: "avg",
      format: "percent",
      synonyms: ["conversion rate", "cvr"],
      provenance: [{ provider: "ga4", expr: "metrics.sessionKeyEventRate" }],
    },
  ],
  dimensions: [
    dimDate,
    dimChannel,
    dimSource,
    dimMedium,
    {
      name: "campaign",
      title: "Campaign (UTM)",
      description: "The marketing campaign that drove the session (utm_campaign).",
      type: "string",
      synonyms: ["utm campaign"],
      provenance: [{ provider: "ga4", expr: "dimensions.sessionCampaignName" }],
    },
  ],
};

const siteEvents: View = {
  name: "site_events",
  title: "Site events",
  description:
    "On-site behavior and conversion events (GA4). Answers: which events fire, on which pages, and their value.",
  requires: ["ga4"],
  freshness: { latencyNote: "GA4 intraday data lags ~4–8h; finalized after ~48h." },
  timeDimension: { name: "date", grains: ["day", "week", "month"] },
  defaults: { timeRange: "last_30_days" },
  measures: [
    {
      name: "event_count",
      title: "Event count",
      description: "The total number of events.",
      agg: "sum",
      format: "integer",
      provenance: [{ provider: "ga4", expr: "metrics.eventCount" }],
    },
    measKeyEvents,
    {
      name: "event_value",
      title: "Event value",
      description: "The summed value attached to events (the GA4 'value' event parameter).",
      agg: "sum",
      format: "currency",
      provenance: [{ provider: "ga4", expr: "metrics.eventValue" }],
    },
  ],
  dimensions: [
    dimDate,
    {
      name: "event_name",
      title: "Event name",
      description: "The GA4 event name (e.g. page_view, add_to_cart, purchase).",
      type: "string",
      provenance: [{ provider: "ga4", expr: "dimensions.eventName" }],
    },
    {
      name: "page_path",
      title: "Page path",
      description: "The path of the page on which the event occurred.",
      type: "string",
      provenance: [{ provider: "ga4", expr: "dimensions.pagePath" }],
    },
    dimDevice,
  ],
};

const commerce: View = {
  name: "commerce",
  title: "Commerce",
  description:
    "Actual orders and revenue from Shopify — the ground truth for sales. Answers: orders, revenue, AOV, units, refunds by product/discount/customer type.",
  requires: ["shopify"],
  freshness: { latencyNote: "Shopify order data is effectively realtime." },
  timeDimension: { name: "date", grains: ["day", "week", "month", "quarter", "year"] },
  defaults: { timeRange: "last_30_days", order: [{ field: "date", dir: "asc" }] },
  measures: [
    {
      name: "orders",
      title: "Orders",
      description: "The number of orders placed.",
      agg: "sum",
      format: "integer",
      provenance: [{ provider: "shopify", expr: "count(orders)" }],
    },
    {
      name: "gross_revenue",
      title: "Gross revenue",
      description: "Total order value before refunds (sum of order totals).",
      agg: "sum",
      format: "currency",
      synonyms: ["revenue", "sales", "turnover"],
      provenance: [{ provider: "shopify", expr: "sum(orders.total_price)" }],
    },
    {
      name: "net_revenue",
      title: "Net revenue",
      description: "Gross revenue minus refunds.",
      agg: "sum",
      format: "currency",
      synonyms: ["net sales"],
      provenance: [{ provider: "shopify", expr: "sum(orders.total_price) - sum(refunds.amount)" }],
    },
    {
      name: "aov",
      title: "Average order value",
      description: "Gross revenue divided by orders.",
      agg: "derived",
      formula: "gross_revenue / orders",
      format: "currency",
      synonyms: ["average order value"],
      provenance: [{ provider: "shopify", expr: "sum(orders.total_price)/count(orders)" }],
    },
    {
      name: "units",
      title: "Units sold",
      description: "Total quantity of line items sold.",
      agg: "sum",
      format: "integer",
      provenance: [{ provider: "shopify", expr: "sum(line_items.quantity)" }],
    },
    {
      name: "refunds",
      title: "Refunds",
      description: "Total refunded amount.",
      agg: "sum",
      format: "currency",
      provenance: [{ provider: "shopify", expr: "sum(refunds.amount)" }],
    },
    {
      name: "new_customer_orders",
      title: "New-customer orders",
      description: "Orders placed by customers making their first purchase.",
      agg: "sum",
      format: "integer",
      provenance: [{ provider: "shopify", expr: "count(orders where customer.orders_count = 1)" }],
    },
  ],
  dimensions: [
    dimDate,
    {
      name: "product",
      title: "Product",
      description: "The product title.",
      type: "string",
      provenance: [{ provider: "shopify", expr: "line_items.product_title" }],
    },
    {
      name: "variant",
      title: "Variant",
      description: "The product variant title.",
      type: "string",
      provenance: [{ provider: "shopify", expr: "line_items.variant_title" }],
    },
    {
      name: "discount_code",
      title: "Discount code",
      description: "The discount code applied to the order, if any.",
      type: "string",
      provenance: [{ provider: "shopify", expr: "discount_applications.code" }],
    },
    {
      name: "customer_type",
      title: "Customer type",
      description: "Whether the order is from a new or returning customer.",
      type: "enum",
      enumValues: ["new", "returning"],
      provenance: [{ provider: "shopify", expr: "derived(customer.orders_count)" }],
    },
    {
      name: "referring_channel",
      title: "Referring channel",
      description: "The channel that referred the order, derived from order attribution (landing-site UTM / referring site).",
      type: "string",
      caveats: [
        "Derived from Shopify order attribution; coverage depends on UTM tagging and may not match GA4 channel exactly.",
      ],
      provenance: [{ provider: "shopify", expr: "derived(order.landing_site / referring_site)" }],
    },
  ],
};

// Ads + blended views (surface as unavailable in Tranche 1) ------------------

const adsPerformance: View = {
  name: "ads_performance",
  title: "Ads performance",
  description:
    "Paid performance across Google Ads and Meta. Answers: spend, impressions, clicks, CTR, CPC, platform conversions and ROAS by platform/campaign.",
  requires: ["gads", "meta"],
  partialOk: true,
  freshness: { latencyNote: "Google Ads ~3h lag; Meta ~ up to a few hours." },
  timeDimension: { name: "date", grains: ["day", "week", "month"] },
  measures: [
    {
      name: "spend",
      title: "Ad spend",
      description: "Total amount spent on ads.",
      agg: "sum",
      format: "currency",
      synonyms: ["cost", "ad cost"],
      provenance: [
        { provider: "gads", expr: "metrics.cost_micros/1e6" },
        { provider: "meta", expr: "insights.spend" },
      ],
    },
    {
      name: "platform_roas",
      title: "Platform ROAS",
      description: "Platform-reported conversion value divided by spend (each platform's own attribution).",
      agg: "derived",
      formula: "platform_conversion_value / spend",
      format: "decimal",
      caveats: ["Platform ROAS uses platform-attributed value, not Shopify revenue. See glossary."],
      provenance: [
        { provider: "gads", expr: "metrics.conversions_value/metrics.cost" },
        { provider: "meta", expr: "insights.purchase_roas" },
      ],
    },
  ],
  dimensions: [
    dimDate,
    {
      name: "platform",
      title: "Platform",
      description: "The ad platform (google or meta).",
      type: "enum",
      enumValues: ["google", "meta"],
      provenance: [
        { provider: "gads", expr: "'google'" },
        { provider: "meta", expr: "'meta'" },
      ],
    },
    {
      name: "campaign",
      title: "Campaign",
      description: "The ad campaign name.",
      type: "string",
      provenance: [
        { provider: "gads", expr: "campaign.name" },
        { provider: "meta", expr: "campaign_name" },
      ],
    },
  ],
};

const marketingOverview: View = {
  name: "marketing_overview",
  title: "Marketing overview (blended)",
  description:
    "The blended truth across channels: spend vs Shopify revenue, blended ROAS, MER, and CAC. Requires an ads connection and the federation engine.",
  requires: ["shopify", "gads", "meta"],
  partialOk: true,
  comingSoon: true,
  freshness: { latencyNote: "Blends realtime Shopify revenue with lagged ad/analytics data." },
  timeDimension: { name: "date", grains: ["day", "week", "month"] },
  measures: [
    {
      name: "blended_roas",
      title: "Blended ROAS",
      description: "Shopify gross revenue divided by total ad spend across platforms.",
      agg: "derived",
      formula: "gross_revenue / spend",
      format: "decimal",
      caveats: ["Uses Shopify revenue as the numerator (ground truth), not platform-reported value."],
      provenance: [
        { provider: "shopify", expr: "sum(orders.total_price)" },
        { provider: "gads", expr: "metrics.cost_micros/1e6" },
        { provider: "meta", expr: "insights.spend" },
      ],
    },
    {
      name: "mer",
      title: "MER",
      description: "Marketing efficiency ratio: total revenue / total ad spend.",
      agg: "derived",
      formula: "gross_revenue / spend",
      format: "decimal",
      provenance: [{ provider: "shopify", expr: "sum(orders.total_price)" }],
    },
    {
      name: "cac",
      title: "CAC",
      description: "Customer acquisition cost: ad spend / new-customer orders.",
      agg: "derived",
      formula: "spend / new_customer_orders",
      format: "currency",
      provenance: [{ provider: "shopify", expr: "count(new_customer_orders)" }],
    },
  ],
  dimensions: [dimDate, dimChannel],
};

// Glossary -------------------------------------------------------------------

const glossary: GlossaryEntry[] = [
  {
    term: "platform_conversions vs key_events vs orders",
    definition:
      "Three different counting systems. Google/Meta conversions are platform-attributed (each platform claims credit independently — they double-count across platforms and use their own windows). GA4 key_events are GA4-attributed. Shopify orders are ground truth. Blended metrics in marketing_overview always use Shopify revenue as the numerator.",
  },
  {
    term: "platform_roas vs blended_roas",
    definition:
      "platform_roas is platform-reported conversion value divided by spend (each platform's own attribution and window). blended_roas is Shopify revenue divided by spend. They will differ — blended_roas is the conservative truth.",
  },
  {
    term: "sessions ≠ clicks",
    definition:
      "GA4 sessions and ad clicks never reconcile: a click may not start a session (bounces before the tag fires), and a session may aggregate multiple clicks or none (direct). Do not expect ads_performance.clicks to equal traffic.sessions.",
  },
  {
    term: "freshness",
    definition:
      "Shopify commerce data is realtime. GA4 intraday lags ~4–8h and finalizes after ~48h. Google Ads lags ~3h. When comparing same-day numbers across views, expect the lagged sources to undercount.",
  },
];

export const DEFAULT_MODEL: Omit<SemanticModel, "store"> = {
  version: "1.0.0",
  views: [traffic, acquisition, siteEvents, commerce, adsPerformance, marketingOverview],
  glossary,
};
