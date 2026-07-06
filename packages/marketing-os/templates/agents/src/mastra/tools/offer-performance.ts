// agents/src/mastra/tools/offer-performance.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createShopifyClient } from "../../../lib/shopify";

/**
 * chart_offer_performance (spec 14, O1) — the offer funnel as generative UI.
 *
 * Joins two sources:
 *  - platform experiment stats (per-arm counters + Beta-posterior read)
 *  - Shopify attribution: customers tagged by the capture endpoint
 *    (mos-offer, <surfaceId>, arm:<arm>) → orders/revenue since capture.
 */

const armSchema = z.object({
  arm: z.string(),
  exposures: z.number(),
  impressions: z.number(),
  captures: z.number(),
  dismisses: z.number(),
  captureRate: z.number().nullable(),
  ci95: z.tuple([z.number(), z.number()]).nullable(),
  pBest: z.number().nullable(),
  attributedCustomers: z.number(),
  attributedOrders: z.number(),
  attributedRevenue: z.number(),
});

export const chartOfferPerformance = createTool({
  id: "chart_offer_performance",
  description:
    "Render the offer-performance funnel: per-arm exposures, impressions, " +
    "captures, capture rate with credible interval, probability-best, and " +
    "Shopify-attributed customers/orders/revenue. Use for questions about how " +
    "an offer, popup, signup, or the Collector's List is performing.",
  inputSchema: z.object({
    surfaceId: z.string().default("ofr_collectors_list_v1"),
    days: z.number().int().min(7).max(90).default(30),
  }),
  outputSchema: z.union([
    z.object({
      surfaceId: z.string(),
      days: z.number(),
      arms: z.array(armSchema),
    }),
    z.object({ unavailable: z.literal(true), reason: z.string() }),
  ]),
  execute: async (inputData) => {
    const surfaceId = inputData.surfaceId ?? "ofr_collectors_list_v1";
    const days = inputData.days ?? 30;
    const apiUrl = process.env.MARKETING_OS_API_URL;
    const apiKey = process.env.MARKETING_OS_API_KEY;
    if (!apiUrl || !apiKey) {
      return { unavailable: true as const, reason: "Platform link not configured (MARKETING_OS_API_URL/KEY)." };
    }

    try {
      const res = await fetch(
        `${apiUrl.replace(/\/$/, "")}/api/offers/stats?surfaceId=${encodeURIComponent(surfaceId)}&days=${days}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (!res.ok) {
        return { unavailable: true as const, reason: `Platform stats unavailable (${res.status}).` };
      }
      const stats = (await res.json()) as {
        surfaces: { surfaceId: string; arms: Omit<z.infer<typeof armSchema>,
          "attributedCustomers" | "attributedOrders" | "attributedRevenue">[] }[];
      };
      const surface = stats.surfaces.find((s) => s.surfaceId === surfaceId);
      if (!surface || surface.arms.length === 0) {
        return { unavailable: true as const, reason: "No experiment data yet — the offer may not be live or hasn't had traffic." };
      }

      // Shopify attribution per arm via capture tags.
      const shopify = createShopifyClient();
      const arms = await Promise.all(
        surface.arms.map(async (a) => {
          let customers = 0, orders = 0, revenue = 0;
          if (a.arm !== "control") {
            try {
              const found = await shopify.rest<{
                customers: { orders_count: number; total_spent: string }[];
              }>(
                `customers/search.json?query=${encodeURIComponent(`tag:'${surfaceId}' AND tag:'arm:${a.arm}'`)}&limit=250`
              );
              for (const c of found.customers ?? []) {
                customers += 1;
                orders += c.orders_count ?? 0;
                revenue += Number.parseFloat(c.total_spent ?? "0") || 0;
              }
            } catch {
              /* attribution optional — funnel still renders */
            }
          }
          return {
            ...a,
            attributedCustomers: customers,
            attributedOrders: orders,
            attributedRevenue: Math.round(revenue),
          };
        })
      );

      return { surfaceId, days, arms };
    } catch (err) {
      return {
        unavailable: true as const,
        reason: `Stats unavailable: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  },
});
