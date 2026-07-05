// agents/src/mastra/tools/chart-tools.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createShopifyClient } from "../../../lib/shopify";
import { ga4 } from "../../../lib/ga4";

/**
 * Generative-UI chart tools (spec 13 addendum, static pattern).
 *
 * Each tool's outputSchema IS the props contract of a registered console
 * component — the agent picks the tool, the console owns the pixels. Tools
 * degrade gracefully: `unavailable` + reason instead of throwing, so the UI
 * renders a designed empty state rather than an error bubble.
 */

const unavailable = z.object({ unavailable: z.literal(true), reason: z.string() });

/* ── GA4 report helpers ─────────────────────────────────────────── */

interface Ga4Row {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}

function rows(report: Record<string, unknown>): Ga4Row[] {
  return Array.isArray((report as { rows?: Ga4Row[] }).rows)
    ? ((report as { rows?: Ga4Row[] }).rows as Ga4Row[])
    : [];
}
const num = (v?: string) => (v ? Number.parseFloat(v) || 0 : 0);

/* ── Revenue trend (Shopify commerce) ───────────────────────────── */

export const chartRevenueTrend = createTool({
  id: "chart_revenue_trend",
  description:
    "Render the revenue-trend chart: daily revenue for the last N days plus " +
    "revenue/orders/AOV stat tiles. Use for questions about revenue, sales, " +
    "or how the store is doing over time.",
  inputSchema: z.object({
    days: z.number().int().min(7).max(90).default(30),
  }),
  outputSchema: z.union([
    z.object({
      days: z.array(z.string()),
      values: z.array(z.number()),
      kpis: z.array(z.object({ label: z.string(), value: z.string(), note: z.string() })),
    }),
    unavailable,
  ]),
  execute: async (inputData) => {
    const days = inputData.days ?? 30;
    try {
      const shopify = createShopifyClient();
      const since = new Date(Date.now() - days * 86400_000);
      const data = await shopify.rest<{ orders: { created_at: string; total_price: string }[] }>(
        `orders.json?status=any&limit=250&fields=created_at,total_price&created_at_min=${encodeURIComponent(since.toISOString())}`
      );
      const orders = data.orders ?? [];
      const byDay = new Map<string, number>();
      for (let i = 0; i <= days; i++) {
        const d = new Date(since.getTime() + i * 86400_000);
        byDay.set(d.toISOString().slice(0, 10), 0);
      }
      let revenue = 0;
      for (const o of orders) {
        const key = o.created_at.slice(0, 10);
        const v = Number.parseFloat(o.total_price) || 0;
        revenue += v;
        byDay.set(key, (byDay.get(key) ?? 0) + v);
      }
      const fmtDay = (iso: string) =>
        new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      const aov = orders.length ? revenue / orders.length : 0;
      return {
        days: [...byDay.keys()].map(fmtDay),
        values: [...byDay.values()].map((v) => Math.round(v)),
        kpis: [
          { label: `Revenue (${days}d)`, value: `$${Math.round(revenue).toLocaleString()}`, note: `${orders.length} orders` },
          { label: "Orders", value: String(orders.length), note: `Last ${days} days` },
          { label: "Avg. order value", value: `$${Math.round(aov).toLocaleString()}`, note: "Across the period" },
        ],
      };
    } catch (err) {
      return { unavailable: true as const, reason: `Store data unavailable: ${err instanceof Error ? err.message : "unknown"}` };
    }
  },
});

/* ── Channel breakdown (GA4 acquisition) ────────────────────────── */

export const chartChannelBreakdown = createTool({
  id: "chart_channel_breakdown",
  description:
    "Render the channel-breakdown bar chart: sessions or revenue by default " +
    "channel group over the last N days. Use for questions about which " +
    "channels drive traffic or sales.",
  inputSchema: z.object({
    days: z.number().int().min(7).max(90).default(30),
    metric: z.enum(["sessions", "totalRevenue"]).default("sessions"),
  }),
  outputSchema: z.union([
    z.object({
      metric: z.string(),
      rows: z.array(z.object({ name: z.string(), value: z.number() })),
    }),
    unavailable,
  ]),
  execute: async (inputData) => {
    const days = inputData.days ?? 30;
    const metric = inputData.metric ?? "sessions";
    try {
      const report = await ga4.runReport({
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: metric }],
        orderBys: [{ metric: { metricName: metric }, desc: true }],
        limit: 8,
      });
      const out = rows(report).map((r) => ({
        name: r.dimensionValues?.[0]?.value ?? "Unknown",
        value: Math.round(num(r.metricValues?.[0]?.value)),
      }));
      if (out.length === 0) return { unavailable: true as const, reason: "GA4 returned no rows for this period." };
      return { metric, rows: out };
    } catch (err) {
      return { unavailable: true as const, reason: `GA4 unavailable: ${err instanceof Error ? err.message : "not connected"}` };
    }
  },
});

/* ── Landing-page conversion (GA4 traffic ⋈ commerce) ───────────── */

export const chartLandingConversion = createTool({
  id: "chart_landing_conversion",
  description:
    "Render the landing-page conversion table: sessions and conversion rate " +
    "by landing page. Use for questions about which pages convert best.",
  inputSchema: z.object({
    days: z.number().int().min(7).max(90).default(30),
  }),
  outputSchema: z.union([
    z.object({
      rows: z.array(z.object({ page: z.string(), sessions: z.number(), cvr: z.number() })),
    }),
    unavailable,
  ]),
  execute: async (inputData) => {
    const days = inputData.days ?? 30;
    try {
      const report = await ga4.runReport({
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "landingPagePlusQueryString" }],
        metrics: [{ name: "sessions" }, { name: "keyEvents" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 8,
      });
      const out = rows(report)
        .map((r) => {
          const sessions = num(r.metricValues?.[0]?.value);
          const events = num(r.metricValues?.[1]?.value);
          return {
            page: (r.dimensionValues?.[0]?.value ?? "(unknown)").split("?")[0] || "/",
            sessions: Math.round(sessions),
            cvr: sessions > 0 ? Math.round((events / sessions) * 1000) / 10 : 0,
          };
        })
        .filter((r) => r.sessions > 0);
      if (out.length === 0) return { unavailable: true as const, reason: "GA4 returned no landing-page rows." };
      return { rows: out };
    } catch (err) {
      return { unavailable: true as const, reason: `GA4 unavailable: ${err instanceof Error ? err.message : "not connected"}` };
    }
  },
});

/* ── Sessions period-over-period (GA4 traffic) ──────────────────── */

export const chartSessionsCompare = createTool({
  id: "chart_sessions_compare",
  description:
    "Render the period-over-period sessions chart: weekly sessions this " +
    "period vs the previous one. Use for questions comparing traffic to a " +
    "prior period.",
  inputSchema: z.object({
    weeks: z.number().int().min(2).max(8).default(4),
  }),
  outputSchema: z.union([
    z.object({
      labels: z.array(z.string()),
      now: z.array(z.number()),
      prev: z.array(z.number()),
    }),
    unavailable,
  ]),
  execute: async (inputData) => {
    const weeks = inputData.weeks ?? 4;
    try {
      const days = weeks * 7;
      const report = await ga4.runReport({
        dateRanges: [
          { startDate: `${days}daysAgo`, endDate: "today" },
          { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` },
        ],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }],
        limit: 1000,
      });
      // With two dateRanges GA4 appends an implicit dateRange dimension value.
      const now = new Array(weeks).fill(0);
      const prev = new Array(weeks).fill(0);
      const startNow = Date.now() - days * 86400_000;
      const startPrev = Date.now() - days * 2 * 86400_000;
      for (const r of rows(report)) {
        const dims = r.dimensionValues ?? [];
        const dateStr = dims[0]?.value ?? "";
        const range = dims[1]?.value ?? "date_range_0";
        const t = Date.parse(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T00:00:00Z`);
        if (!Number.isFinite(t)) continue;
        const isNow = range.endsWith("0");
        const start = isNow ? startNow : startPrev;
        const w = Math.min(weeks - 1, Math.max(0, Math.floor((t - start) / (7 * 86400_000))));
        (isNow ? now : prev)[w] += num(r.metricValues?.[0]?.value);
      }
      if (now.every((v) => v === 0) && prev.every((v) => v === 0)) {
        return { unavailable: true as const, reason: "GA4 returned no session data." };
      }
      return {
        labels: Array.from({ length: weeks }, (_, i) => `W${i + 1}`),
        now: now.map(Math.round),
        prev: prev.map(Math.round),
      };
    } catch (err) {
      return { unavailable: true as const, reason: `GA4 unavailable: ${err instanceof Error ? err.message : "not connected"}` };
    }
  },
});

/* ── Storefront-change proposal (HITL widget) ───────────────────── */

export const proposeStorefrontChange = createTool({
  id: "propose_storefront_change",
  description:
    "Propose a storefront change for the merchant to review. SIDE-EFFECT " +
    "FREE: this only renders the proposal card with your drafted change — " +
    "nothing ships until the merchant clicks Approve in the console (which " +
    "dispatches the change to the reviewed PR pipeline). Draft `proposed` " +
    "yourself, grounded in the brand voice. Use this INSTEAD of " +
    "dispatch-to-github whenever the user asks for a storefront change.",
  inputSchema: z.object({
    target: z.string().describe('What is being changed, e.g. "hero headline"'),
    current: z.string().describe("The current content/state, if known"),
    proposed: z.string().describe("The drafted replacement content"),
    rationale: z.string().describe("One sentence on why this serves the brand/persona"),
  }),
  outputSchema: z.object({
    proposalId: z.string(),
    target: z.string(),
    current: z.string(),
    proposed: z.string(),
    rationale: z.string(),
    reviewNote: z.string(),
  }),
  execute: async (inputData) => ({
    proposalId: `prop-${Math.random().toString(36).slice(2, 8)}`,
    target: inputData.target,
    current: inputData.current,
    proposed: inputData.proposed,
    rationale: inputData.rationale,
    reviewNote: "Ships through the reviewed PR pipeline after approval.",
  }),
});

export const chartTools = {
  chartRevenueTrend,
  chartChannelBreakdown,
  chartLandingConversion,
  chartSessionsCompare,
  proposeStorefrontChange,
};
