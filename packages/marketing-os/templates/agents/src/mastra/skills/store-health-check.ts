import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Skill Metadata — exported for the skills registry and UI card generation.
 */
export const metadata = {
  id: "store-health-check",
  name: "Store Health Check",
  description: "Analyze your store's recent performance across orders, traffic, and key metrics.",
  category: "analytics",
  icon: "activity",
  executionMode: "sync" as const,
  version: "1.0.0",
  author: "Marketing OS",
};

/**
 * Input schema — used for both validation and UI form generation.
 */
export const inputSchema = z.object({
  timeRange: z
    .enum(["7d", "30d", "90d"])
    .default("30d")
    .describe("Time range for the analysis"),
  includeOrders: z
    .boolean()
    .default(true)
    .describe("Include order analysis"),
  includeProducts: z
    .boolean()
    .default(true)
    .describe("Include product performance"),
  includeTraffic: z
    .boolean()
    .default(true)
    .describe("Include traffic analysis"),
});

/**
 * Output schema — defines the structured response.
 */
export const outputSchema = z.object({
  summary: z
    .string()
    .describe("High-level summary of store health"),
  metrics: z.object({
    totalOrders: z
      .number()
      .describe("Total number of orders in the time range"),
    totalRevenue: z
      .number()
      .describe("Total revenue generated"),
    averageOrderValue: z
      .number()
      .describe("Average order value"),
    topProducts: z.array(
      z.object({
        name: z.string().describe("Product name"),
        sales: z.number().describe("Number of sales"),
        revenue: z.number().describe("Revenue generated"),
      })
    ).describe("Top performing products"),
    trafficMetrics: z.object({
      sessions: z.number().describe("Total sessions"),
      conversionRate: z.number().describe("Conversion rate percentage"),
    }).optional().describe("Traffic metrics if includeTraffic is true"),
  }),
  recommendations: z
    .array(z.string())
    .describe("Actionable recommendations based on the analysis"),
  alerts: z
    .array(
      z.object({
        severity: z
          .enum(["info", "warning", "critical"])
          .describe("Alert severity level"),
        message: z.string().describe("Alert message"),
      })
    )
    .describe("Important alerts or issues detected"),
});

/**
 * The skill tool — the actual executable.
 */
export const tool = createTool({
  id: metadata.id,
  description: metadata.description,
  inputSchema,
  outputSchema,
  execute: async ({ context, mastra }) => {
    const recommendations: string[] = [];
    const alerts: Array<{ severity: "info" | "warning" | "critical"; message: string }> = [];

    // Fetch store data via Shopify Admin API
    const ordersRes = await fetch(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/orders.json?status=any&limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
        },
      }
    );
    const ordersData = await ordersRes.json();
    const orders = ordersData.orders || [];

    // Filter orders by time range
    const now = new Date();
    const daysMap: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
    const daysAgo = daysMap[inputData.timeRange as string];
    const cutoffDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

    const filteredOrders = orders.filter((o: any) =>
      new Date(o.created_at) >= cutoffDate
    );

    // Compute order metrics
    const totalRevenue = filteredOrders.reduce(
      (sum: number, o: any) => sum + parseFloat(o.total_price || "0"),
      0
    );
    const averageOrderValue = filteredOrders.length > 0
      ? totalRevenue / filteredOrders.length
      : 0;

    // Analyze product performance
    let topProducts: Array<{ name: string; sales: number; revenue: number }> = [];
    if (inputData.includeProducts) {
      const productMap = new Map<string, { sales: number; revenue: number }>();

      filteredOrders.forEach((order: any) => {
        order.line_items?.forEach((item: any) => {
          const name = item.title;
          const existing = productMap.get(name) || { sales: 0, revenue: 0 };
          productMap.set(name, {
            sales: existing.sales + item.quantity,
            revenue: existing.revenue + parseFloat(item.price) * item.quantity,
          });
        });
      });

      topProducts = Array.from(productMap.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
    }

    // Generate recommendations
    if (filteredOrders.length === 0) {
      alerts.push({
        severity: "critical",
        message: `No orders found in the last ${inputData.timeRange}. Consider reviewing your marketing strategy.`,
      });
      recommendations.push("Run a promotional campaign to drive traffic");
      recommendations.push("Review your product pricing and positioning");
    } else {
      if (averageOrderValue < 50) {
        recommendations.push("Consider implementing upselling or bundle offers to increase AOV");
      }

      if (topProducts.length > 0 && topProducts[0].sales > filteredOrders.length * 0.5) {
        recommendations.push(
          `Your top product (${topProducts[0].name}) accounts for most sales. Diversify by promoting other products.`
        );
      }

      recommendations.push("Consider running a retargeting campaign for cart abandoners");
    }

    // Traffic metrics (placeholder - would integrate with GA4)
    const trafficMetrics = inputData.includeTraffic
      ? {
          sessions: Math.floor(filteredOrders.length * 45), // Rough estimate
          conversionRate: filteredOrders.length > 0 ? 2.2 : 0,
        }
      : undefined;

    return {
      summary: `Analyzed ${filteredOrders.length} orders over the last ${inputData.timeRange}. Total revenue: $${totalRevenue.toFixed(2)}, AOV: $${averageOrderValue.toFixed(2)}.`,
      metrics: {
        totalOrders: filteredOrders.length,
        totalRevenue,
        averageOrderValue,
        topProducts,
        ...(trafficMetrics && { trafficMetrics }),
      },
      recommendations,
      alerts,
    };
  },
});
