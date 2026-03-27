// agents/src/mastra/tools/shopify-admin.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const getStoreInfo = createTool({
  id: "shopify-get-store-info",
  description: "Get basic information about the Shopify store",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    domain: z.string(),
    plan: z.string(),
    currency: z.string(),
  }),
  execute: async () => {
    const res = await fetch(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
        },
      }
    );
    const data = await res.json();
    return {
      name: data.shop.name,
      domain: data.shop.domain,
      plan: data.shop.plan_display_name,
      currency: data.shop.currency,
    };
  },
});

const getRecentOrders = createTool({
  id: "shopify-get-recent-orders",
  description: "Get recent orders from the Shopify store",
  inputSchema: z.object({
    limit: z.number().min(1).max(50).default(10),
    status: z.enum(["any", "open", "closed", "cancelled"]).default("any"),
  }),
  outputSchema: z.object({
    orders: z.array(z.object({
      id: z.string(),
      total_price: z.string(),
      created_at: z.string(),
      financial_status: z.string(),
      fulfillment_status: z.string().nullable(),
      line_items_count: z.number(),
    })),
    total_count: z.number(),
  }),
  execute: async ({ inputData }) => {
    const res = await fetch(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/orders.json?limit=${inputData.limit}&status=${inputData.status}`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
        },
      }
    );
    const data = await res.json();
    return {
      orders: data.orders.map((o: any) => ({
        id: String(o.id),
        total_price: o.total_price,
        created_at: o.created_at,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        line_items_count: o.line_items.length,
      })),
      total_count: data.orders.length,
    };
  },
});

const getProducts = createTool({
  id: "shopify-get-products",
  description: "Get products from the Shopify store",
  inputSchema: z.object({
    limit: z.number().min(1).max(50).default(10),
  }),
  outputSchema: z.object({
    products: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      variants_count: z.number(),
      images_count: z.number(),
    })),
  }),
  execute: async ({ inputData }) => {
    const res = await fetch(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/products.json?limit=${inputData.limit}`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
        },
      }
    );
    const data = await res.json();
    return {
      products: data.products.map((p: any) => ({
        id: String(p.id),
        title: p.title,
        status: p.status,
        variants_count: p.variants.length,
        images_count: p.images.length,
      })),
    };
  },
});

export const shopifyAdminTools = {
  getStoreInfo,
  getRecentOrders,
  getProducts,
};
