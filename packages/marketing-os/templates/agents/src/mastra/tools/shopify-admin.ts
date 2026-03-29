// agents/src/mastra/tools/shopify-admin.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createShopifyClient } from "../../../lib/shopify";
import { getAccessToken, normalizeShop } from "@/lib/shopify/session";

/**
 * Resolve the shop domain and create an authenticated Shopify client.
 *
 * Priority:
 *   1. Per-merchant token from Supabase (multi-tenant / OAuth)
 *   2. Env-var fallback (single-tenant / self-hosted)
 */
async function getClientForShop(shopOverride?: string) {
  const shop = normalizeShop(
    shopOverride ?? process.env.SHOPIFY_STORE_URL ?? ""
  );
  if (!shop) throw new Error("No shop domain available");

  // Try per-merchant token from Supabase first
  const token = await getAccessToken(shop);
  if (token) {
    return createShopifyClient({ storeUrl: shop, accessToken: token });
  }

  // Fall back to env vars (single-tenant)
  if (process.env.SHOPIFY_ACCESS_TOKEN) {
    return createShopifyClient({ storeUrl: shop, accessToken: process.env.SHOPIFY_ACCESS_TOKEN });
  }

  throw new Error(
    `No access token found for ${shop}. Install the app via OAuth or set SHOPIFY_ACCESS_TOKEN.`
  );
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const getStoreInfo = createTool({
  id: "shopify-get-store-info",
  description: "Get basic information about the Shopify store",
  inputSchema: z.object({
    shop: z.string().optional().describe("Shop domain override (optional)"),
  }),
  outputSchema: z.object({
    name: z.string(),
    domain: z.string(),
    plan: z.string(),
    currency: z.string(),
  }),
  execute: async ({ inputData }) => {
    const shopify = await getClientForShop(inputData.shop);
    const data = await shopify.rest<{ shop: any }>("shop.json");
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
    shop: z.string().optional().describe("Shop domain override (optional)"),
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
    const shopify = await getClientForShop(inputData.shop);
    const data = await shopify.rest<{ orders: any[] }>(
      `orders.json?limit=${inputData.limit}&status=${inputData.status}`
    );
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
    shop: z.string().optional().describe("Shop domain override (optional)"),
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
    const shopify = await getClientForShop(inputData.shop);
    const data = await shopify.rest<{ products: any[] }>(
      `products.json?limit=${inputData.limit}`
    );
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
