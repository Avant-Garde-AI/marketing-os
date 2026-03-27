import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getShopifyClient } from "../../../lib/shopify";

/**
 * Skill Metadata — exported for the skills registry and UI card generation.
 */
export const metadata = {
  id: "weekly-digest",
  name: "Weekly Performance Digest",
  description: "Generate a comprehensive weekly performance summary designed for cron execution.",
  category: "analytics",
  icon: "calendar",
  executionMode: "sync" as const,
  version: "1.0.0",
  author: "Marketing OS",
};

/**
 * Input schema — used for both validation and UI form generation.
 */
export const inputSchema = z.object({
  weekOffset: z
    .number()
    .min(0)
    .max(12)
    .default(0)
    .describe("Week offset (0 = last 7 days, 1 = previous week, etc.)"),
  includeComparison: z
    .boolean()
    .default(true)
    .describe("Include week-over-week comparison"),
  includeTopProducts: z
    .boolean()
    .default(true)
    .describe("Include top performing products"),
  includeTrafficSources: z
    .boolean()
    .default(true)
    .describe("Include traffic source breakdown"),
  includeRecommendations: z
    .boolean()
    .default(true)
    .describe("Include actionable recommendations"),
  emailRecipients: z
    .array(z.string().email())
    .optional()
    .describe("Optional email addresses to send the digest to"),
});

/**
 * Output schema — defines the structured response.
 */
export const outputSchema = z.object({
  period: z.object({
    startDate: z.string().describe("Start date of the analysis period"),
    endDate: z.string().describe("End date of the analysis period"),
    label: z.string().describe("Human-readable period label"),
  }),
  summary: z
    .string()
    .describe("Executive summary of the week's performance"),
  metrics: z.object({
    orders: z.object({
      total: z.number().describe("Total orders"),
      change: z.number().optional().describe("Percentage change from previous period"),
      trend: z.enum(["up", "down", "flat"]).optional(),
    }),
    revenue: z.object({
      total: z.number().describe("Total revenue"),
      change: z.number().optional().describe("Percentage change from previous period"),
      trend: z.enum(["up", "down", "flat"]).optional(),
    }),
    averageOrderValue: z.object({
      value: z.number().describe("Average order value"),
      change: z.number().optional().describe("Percentage change from previous period"),
      trend: z.enum(["up", "down", "flat"]).optional(),
    }),
    conversionRate: z.object({
      rate: z.number().describe("Conversion rate percentage"),
      change: z.number().optional().describe("Percentage point change from previous period"),
      trend: z.enum(["up", "down", "flat"]).optional(),
    }).optional(),
  }),
  topProducts: z.array(
    z.object({
      name: z.string().describe("Product name"),
      sales: z.number().describe("Number of units sold"),
      revenue: z.number().describe("Revenue generated"),
      trend: z.enum(["rising", "stable", "falling"]).describe("Product trend"),
    })
  ).optional().describe("Top performing products"),
  trafficSources: z.array(
    z.object({
      source: z.string().describe("Traffic source name"),
      sessions: z.number().describe("Number of sessions"),
      conversions: z.number().describe("Number of conversions"),
      percentage: z.number().describe("Percentage of total traffic"),
    })
  ).optional().describe("Traffic source breakdown"),
  highlights: z.array(
    z.object({
      type: z.enum(["success", "concern", "insight"]).describe("Highlight type"),
      title: z.string().describe("Highlight title"),
      description: z.string().describe("Highlight description"),
    })
  ).describe("Key highlights from the week"),
  recommendations: z
    .array(
      z.object({
        priority: z.enum(["high", "medium", "low"]).describe("Priority level"),
        action: z.string().describe("Recommended action"),
        rationale: z.string().describe("Why this action is recommended"),
      })
    )
    .optional()
    .describe("Actionable recommendations"),
  emailSent: z
    .boolean()
    .optional()
    .describe("Whether the digest was sent via email"),
});

/**
 * The skill tool — the actual executable.
 */
export const tool = createTool({
  id: metadata.id,
  description: metadata.description,
  inputSchema,
  outputSchema,
  execute: async ({ inputData, mastra }) => {
    // Calculate date range
    const now = new Date();
    const daysOffset = inputData.weekOffset * 7;
    const endDate = new Date(now.getTime() - daysOffset * 24 * 60 * 60 * 1000);
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    const period = {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      label: inputData.weekOffset === 0
        ? "Last 7 days"
        : `Week of ${formatDate(startDate)}`,
    };

    // Fetch orders for the period
    const shopify = getShopifyClient();
    const ordersData = await shopify.rest<{ orders: any[] }>(
      `orders.json?status=any&limit=250&created_at_min=${startDate.toISOString()}`
    );
    const orders = (ordersData.orders || []).filter(
      (o: any) => new Date(o.created_at) >= startDate && new Date(o.created_at) <= endDate
    );

    // Calculate current period metrics
    const totalRevenue = orders.reduce(
      (sum: number, o: any) => sum + parseFloat(o.total_price || "0"),
      0
    );
    const averageOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

    // Fetch comparison period data if requested
    let comparison: { orders: number; revenue: number; aov: number } | undefined;
    if (inputData.includeComparison) {
      const prevStartDate = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      const prevEndDate = new Date(startDate);

      const prevOrdersData = await shopify.rest<{ orders: any[] }>(
        `orders.json?status=any&limit=250&created_at_min=${prevStartDate.toISOString()}`
      );
      const prevOrders = (prevOrdersData.orders || []).filter(
        (o: any) => new Date(o.created_at) >= prevStartDate && new Date(o.created_at) <= prevEndDate
      );

      const prevRevenue = prevOrders.reduce(
        (sum: number, o: any) => sum + parseFloat(o.total_price || "0"),
        0
      );
      const prevAov = prevOrders.length > 0 ? prevRevenue / prevOrders.length : 0;

      comparison = {
        orders: prevOrders.length,
        revenue: prevRevenue,
        aov: prevAov,
      };
    }

    // Calculate trends
    const getTrend = (current: number, previous?: number): "up" | "down" | "flat" => {
      if (!previous || previous === 0) return "flat";
      const change = ((current - previous) / previous) * 100;
      if (Math.abs(change) < 5) return "flat";
      return change > 0 ? "up" : "down";
    };

    const calculateChange = (current: number, previous?: number): number | undefined => {
      if (!previous || previous === 0) return undefined;
      return ((current - previous) / previous) * 100;
    };

    const metrics = {
      orders: {
        total: orders.length,
        change: calculateChange(orders.length, comparison?.orders),
        trend: comparison ? getTrend(orders.length, comparison.orders) : undefined,
      },
      revenue: {
        total: totalRevenue,
        change: calculateChange(totalRevenue, comparison?.revenue),
        trend: comparison ? getTrend(totalRevenue, comparison.revenue) : undefined,
      },
      averageOrderValue: {
        value: averageOrderValue,
        change: calculateChange(averageOrderValue, comparison?.aov),
        trend: comparison ? getTrend(averageOrderValue, comparison.aov) : undefined,
      },
    };

    // Analyze top products
    let topProducts;
    if (inputData.includeTopProducts) {
      const productMap = new Map<string, { sales: number; revenue: number }>();

      orders.forEach((order: any) => {
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
        .map(([name, data]) => ({
          name,
          sales: data.sales,
          revenue: data.revenue,
          trend: "stable" as const, // Would require historical data for accurate trend
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
    }

    // Generate highlights
    const highlights = [];

    if (metrics.revenue.trend === "up") {
      highlights.push({
        type: "success" as const,
        title: "Revenue Growth",
        description: `Revenue increased by ${metrics.revenue.change?.toFixed(1)}% compared to last week.`,
      });
    } else if (metrics.revenue.trend === "down") {
      highlights.push({
        type: "concern" as const,
        title: "Revenue Decline",
        description: `Revenue decreased by ${Math.abs(metrics.revenue.change || 0).toFixed(1)}% compared to last week.`,
      });
    }

    if (orders.length === 0) {
      highlights.push({
        type: "concern" as const,
        title: "No Orders",
        description: "No orders were placed during this period. Review your marketing campaigns.",
      });
    }

    if (topProducts && topProducts.length > 0) {
      highlights.push({
        type: "insight" as const,
        title: "Best Seller",
        description: `${topProducts[0].name} was your top product with $${topProducts[0].revenue.toFixed(2)} in revenue.`,
      });
    }

    // Generate recommendations
    let recommendations;
    if (inputData.includeRecommendations) {
      recommendations = [];

      if (metrics.revenue.trend === "down") {
        recommendations.push({
          priority: "high" as const,
          action: "Launch a promotional campaign",
          rationale: "Revenue has declined. A targeted promotion could help recover sales momentum.",
        });
      }

      if (averageOrderValue < 50) {
        recommendations.push({
          priority: "medium" as const,
          action: "Implement product bundles or upsells",
          rationale: `Current AOV is $${averageOrderValue.toFixed(2)}. Bundling can increase this metric.`,
        });
      }

      if (topProducts && topProducts.length > 0) {
        recommendations.push({
          priority: "low" as const,
          action: `Create more content featuring ${topProducts[0].name}`,
          rationale: "Your top product is performing well. Amplify its success with targeted content.",
        });
      }

      recommendations.push({
        priority: "medium" as const,
        action: "Review and optimize ad spend allocation",
        rationale: "Regular review of marketing spend ensures optimal ROI across channels.",
      });
    }

    // Generate summary
    const summary = `Week of ${period.startDate}: ${orders.length} orders, $${totalRevenue.toFixed(2)} revenue, $${averageOrderValue.toFixed(2)} AOV. ${
      metrics.revenue.trend === "up"
        ? `Revenue up ${metrics.revenue.change?.toFixed(1)}% vs. last week.`
        : metrics.revenue.trend === "down"
        ? `Revenue down ${Math.abs(metrics.revenue.change || 0).toFixed(1)}% vs. last week.`
        : "Performance stable vs. last week."
    }`;

    // Optional: Send email (placeholder)
    let emailSent = false;
    if (inputData.emailRecipients && inputData.emailRecipients.length > 0) {
      // In production, integrate with email service (SendGrid, Postmark, etc.)
      console.log(`Would send digest to: ${inputData.emailRecipients.join(", ")}`);
      emailSent = false; // Set to true when email integration is implemented
    }

    return {
      period,
      summary,
      metrics,
      topProducts,
      trafficSources: undefined, // Would integrate with GA4 in production
      highlights,
      recommendations,
      emailSent,
    };
  },
});
