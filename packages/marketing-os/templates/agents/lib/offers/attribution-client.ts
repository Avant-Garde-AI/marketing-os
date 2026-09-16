/**
 * OfferAttributionClient binding (spec 32 OF0) — Shopify capture-tag
 * attribution: customers tagged `<surfaceId>`, `arm:<arm>` by the capture
 * endpoint (app/api/surfaces/capture), looked up per arm.
 */

import { createShopifyClient } from "../shopify";
import type { OfferAttributionClient } from "./types";

export const offerAttributionClient: OfferAttributionClient = {
  async findCapturedCustomers(surfaceId: string, arm: string) {
    const shopify = createShopifyClient();
    const found = await shopify.rest<{
      customers: { orders_count: number; total_spent: string }[];
    }>(
      `customers/search.json?query=${encodeURIComponent(`tag:'${surfaceId}' AND tag:'arm:${arm}'`)}&limit=250`,
    );
    return found.customers ?? [];
  },
};
