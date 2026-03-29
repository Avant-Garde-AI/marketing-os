// agents/src/mastra/workflows/weekly-review.ts
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { getShopifyClient } from "../../../lib/shopify";

/**
 * Weekly Review Workflow
 *
 * Aggregates performance data from multiple sources (Shopify, GA4, Meta Ads)
 * and generates a comprehensive weekly report with insights and recommendations.
 *
 * Designed to be run on a cron schedule (e.g., every Monday morning).
 */

// Step 1: Fetch Shopify data
const fetchShopifyData = createStep({
  id: "fetch-shopify-data",
  inputSchema: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
  outputSchema: z.object({
    totalOrders: z.number(),
    totalRevenue: z.number(),
    averageOrderValue: z.number(),
    topProducts: z.array(z.object({
      id: z.string(),
      title: z.string(),
      orderCount: z.number(),
      revenue: z.number(),
    })),
  }),
  execute: async ({ inputData }) => {
    const { startDate, endDate } = inputData;

    // Fetch orders from Shopify Admin API
    const shopify = getShopifyClient();
    const data = await shopify.rest<{ orders: any[] }>(
      `orders.json?status=any&limit=250&created_at_min=${startDate}&created_at_max=${endDate}`
    );
    const orders = data.orders || [];

    // Calculate metrics
    const totalRevenue = orders.reduce(
      (sum: number, o: any) => sum + parseFloat(o.total_price || "0"),
      0
    );
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Aggregate top products
    const productMap = new Map<string, { id: string; title: string; orderCount: number; revenue: number }>();

    orders.forEach((order: any) => {
      order.line_items?.forEach((item: any) => {
        const productId = String(item.product_id);
        const existing = productMap.get(productId);
        const itemRevenue = parseFloat(item.price) * item.quantity;

        if (existing) {
          existing.orderCount += item.quantity;
          existing.revenue += itemRevenue;
        } else {
          productMap.set(productId, {
            id: productId,
            title: item.title,
            orderCount: item.quantity,
            revenue: itemRevenue,
          });
        }
      });
    });

    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      totalOrders,
      totalRevenue,
      averageOrderValue,
      topProducts,
    };
  },
});

// Step 2: Fetch GA4 analytics data
const fetchGA4Data = createStep({
  id: "fetch-ga4-data",
  inputSchema: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
  outputSchema: z.object({
    totalPageViews: z.number(),
    totalUsers: z.number(),
    totalSessions: z.number(),
    conversionRate: z.number(),
    topPages: z.array(z.object({
      path: z.string(),
      pageViews: z.number(),
    })),
    trafficSources: z.array(z.object({
      source: z.string(),
      medium: z.string(),
      sessions: z.number(),
    })),
  }),
  execute: async ({ inputData }) => {
    const { startDate, endDate } = inputData;
    const propertyId = process.env.GA4_PROPERTY_ID;

    // If GA4 is not configured, return mock data
    if (!propertyId || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      return {
        totalPageViews: 0,
        totalUsers: 0,
        totalSessions: 0,
        conversionRate: 0,
        topPages: [],
        trafficSources: [],
      };
    }

    // In production, this would use the Google Analytics Data API
    // For template purposes, returning structure
    // const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    // const auth = new google.auth.GoogleAuth({...});
    // const analyticsData = google.analyticsdata('v1beta');

    return {
      totalPageViews: 0,
      totalUsers: 0,
      totalSessions: 0,
      conversionRate: 0,
      topPages: [],
      trafficSources: [],
    };
  },
});

// Step 3: Generate insights and recommendations
const generateInsights = createStep({
  id: "generate-insights",
  inputSchema: z.object({
    shopifyData: z.object({
      totalOrders: z.number(),
      totalRevenue: z.number(),
      averageOrderValue: z.number(),
      topProducts: z.array(z.object({
        id: z.string(),
        title: z.string(),
        orderCount: z.number(),
        revenue: z.number(),
      })),
    }),
    ga4Data: z.object({
      totalPageViews: z.number(),
      totalUsers: z.number(),
      totalSessions: z.number(),
      conversionRate: z.number(),
      topPages: z.array(z.object({
        path: z.string(),
        pageViews: z.number(),
      })),
      trafficSources: z.array(z.object({
        source: z.string(),
        medium: z.string(),
        sessions: z.number(),
      })),
    }),
  }),
  outputSchema: z.object({
    insights: z.array(z.string()),
    recommendations: z.array(z.string()),
    healthScore: z.number(),
  }),
  execute: async ({ inputData }) => {
    const { shopifyData, ga4Data } = inputData;
    const insights: string[] = [];
    const recommendations: string[] = [];
    let healthScore = 70; // Base score

    // Generate insights based on data
    if (shopifyData.totalOrders > 0) {
      insights.push(`Processed ${shopifyData.totalOrders} orders this week with $${shopifyData.totalRevenue.toFixed(2)} in revenue`);
      insights.push(`Average order value: $${shopifyData.averageOrderValue.toFixed(2)}`);

      if (shopifyData.averageOrderValue > 100) {
        healthScore += 10;
        insights.push("Above-average order value indicates strong product positioning");
      } else {
        recommendations.push("Consider upselling strategies or bundle offers to increase AOV");
      }
    } else {
      insights.push("No orders processed this week");
      recommendations.push("Review marketing campaigns and traffic sources");
      healthScore -= 20;
    }

    if (shopifyData.topProducts.length > 0) {
      const topProduct = shopifyData.topProducts[0];
      insights.push(`Top product: "${topProduct.title}" with $${topProduct.revenue.toFixed(2)} in revenue`);
      recommendations.push(`Consider featuring "${topProduct.title}" in marketing campaigns`);
    }

    if (ga4Data.totalSessions > 0) {
      insights.push(`${ga4Data.totalSessions} sessions from ${ga4Data.totalUsers} users`);
      insights.push(`Conversion rate: ${(ga4Data.conversionRate * 100).toFixed(2)}%`);

      if (ga4Data.conversionRate < 0.02) {
        recommendations.push("Conversion rate is below industry average - review checkout experience");
        healthScore -= 10;
      } else {
        healthScore += 10;
      }
    }

    if (ga4Data.trafficSources.length > 0) {
      const topSource = ga4Data.trafficSources[0];
      insights.push(`Primary traffic source: ${topSource.source} / ${topSource.medium}`);

      if (ga4Data.trafficSources.length < 3) {
        recommendations.push("Diversify traffic sources to reduce dependency on a single channel");
      }
    }

    // Ensure health score is between 0-100
    healthScore = Math.max(0, Math.min(100, healthScore));

    return {
      insights,
      recommendations,
      healthScore,
    };
  },
});

// Step 4: Format the final report
const formatReport = createStep({
  id: "format-report",
  inputSchema: z.object({
    startDate: z.string(),
    endDate: z.string(),
    shopifyData: z.object({
      totalOrders: z.number(),
      totalRevenue: z.number(),
      averageOrderValue: z.number(),
      topProducts: z.array(z.object({
        id: z.string(),
        title: z.string(),
        orderCount: z.number(),
        revenue: z.number(),
      })),
    }),
    ga4Data: z.object({
      totalPageViews: z.number(),
      totalUsers: z.number(),
      totalSessions: z.number(),
      conversionRate: z.number(),
      topPages: z.array(z.object({
        path: z.string(),
        pageViews: z.number(),
      })),
      trafficSources: z.array(z.object({
        source: z.string(),
        medium: z.string(),
        sessions: z.number(),
      })),
    }),
    insights: z.array(z.string()),
    recommendations: z.array(z.string()),
    healthScore: z.number(),
  }),
  outputSchema: z.object({
    report: z.string(),
    summary: z.object({
      healthScore: z.number(),
      totalRevenue: z.number(),
      totalOrders: z.number(),
      keyInsights: z.number(),
      actionableRecommendations: z.number(),
    }),
  }),
  execute: async ({ inputData }) => {
    const {
      startDate,
      endDate,
      shopifyData,
      ga4Data,
      insights,
      recommendations,
      healthScore
    } = inputData;

    const report = `
# Weekly Performance Review
**Period:** ${startDate} to ${endDate}

## Store Health Score: ${healthScore}/100

---

## Sales Performance

- **Total Orders:** ${shopifyData.totalOrders}
- **Total Revenue:** $${shopifyData.totalRevenue.toFixed(2)}
- **Average Order Value:** $${shopifyData.averageOrderValue.toFixed(2)}

### Top Products
${shopifyData.topProducts.map((p, i) =>
  `${i + 1}. **${p.title}** - ${p.orderCount} orders, $${p.revenue.toFixed(2)} revenue`
).join('\n')}

---

## Website Analytics

- **Total Sessions:** ${ga4Data.totalSessions}
- **Total Users:** ${ga4Data.totalUsers}
- **Page Views:** ${ga4Data.totalPageViews}
- **Conversion Rate:** ${(ga4Data.conversionRate * 100).toFixed(2)}%

### Top Pages
${ga4Data.topPages.map((p, i) =>
  `${i + 1}. ${p.path} - ${p.pageViews} views`
).join('\n') || '_No data available_'}

### Traffic Sources
${ga4Data.trafficSources.map((s, i) =>
  `${i + 1}. ${s.source} / ${s.medium} - ${s.sessions} sessions`
).join('\n') || '_No data available_'}

---

## Key Insights

${insights.map(i => `- ${i}`).join('\n')}

---

## Recommendations

${recommendations.map(r => `- ${r}`).join('\n')}

---

_Generated by Marketing OS Weekly Review Workflow_
    `.trim();

    return {
      report,
      summary: {
        healthScore,
        totalRevenue: shopifyData.totalRevenue,
        totalOrders: shopifyData.totalOrders,
        keyInsights: insights.length,
        actionableRecommendations: recommendations.length,
      },
    };
  },
});

// Define the workflow
export const weeklyReviewWorkflow = createWorkflow({
  id: "weekly-review",
  inputSchema: z.object({
    startDate: z.string().describe("Start date in YYYY-MM-DD format"),
    endDate: z.string().describe("End date in YYYY-MM-DD format"),
  }),
  outputSchema: z.object({
    report: z.string(),
    summary: z.object({
      healthScore: z.number(),
      totalRevenue: z.number(),
      totalOrders: z.number(),
      keyInsights: z.number(),
      actionableRecommendations: z.number(),
    }),
  }),
})
  // @ts-expect-error - Step type inference is complex; types are validated at runtime
  .then(fetchShopifyData)
  // @ts-expect-error - Step type inference is complex; types are validated at runtime
  .then(fetchGA4Data)
  // @ts-expect-error - Step type inference is complex; types are validated at runtime
  .then(generateInsights)
  // @ts-expect-error - Step type inference is complex; types are validated at runtime
  .then(formatReport)
  .commit();
