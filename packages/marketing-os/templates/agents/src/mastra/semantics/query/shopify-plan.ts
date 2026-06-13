// agents/src/mastra/semantics/query/shopify-plan.ts
//
// Compile a ValidatedQuery for the Shopify-backed commerce view into an order
// fetch + client-side aggregation. Shopify has no generic aggregation endpoint,
// so we fetch orders for the date range and group/aggregate in memory. A single
// page (250) is fetched; the envelope reports truncation honestly when hit.

import { getShopifyClient } from "../../../../lib/shopify";
import { bucketDate } from "./time";
import type { ProviderResult } from "./ga4-plan";
import type { ResolvedFilter, ValidatedQuery } from "./types";

const PAGE_LIMIT = 250;

interface ShopifyOrder {
  created_at: string;
  total_price: string;
  current_total_price?: string;
  total_discounts?: string;
  refunds?: { refund_line_items?: { subtotal: number }[]; transactions?: { amount: string; kind: string }[] }[];
  customer?: { orders_count?: number } | null;
  line_items?: { quantity: number; price: string; product_id?: number; title?: string; variant_title?: string }[];
  discount_codes?: { code: string }[];
  landing_site?: string | null;
  referring_site?: string | null;
}

export interface ShopifyPlanDescription {
  endpoint: string;
  params: Record<string, string>;
  groupBy: string[];
  measures: string[];
  note: string;
}

export function buildShopifyPlan(vq: ValidatedQuery): ShopifyPlanDescription {
  return {
    endpoint: "GET /admin/api/orders.json",
    params: {
      status: "any",
      created_at_min: `${vq.time.start}T00:00:00Z`,
      created_at_max: `${vq.time.end}T23:59:59Z`,
      limit: String(PAGE_LIMIT),
    },
    groupBy: vq.dimensions.map((d) => d.name),
    measures: vq.measures.map((m) => m.name),
    note: "Orders are fetched for the range and aggregated in memory (Shopify has no aggregation API). Up to 250 orders per query; larger ranges report truncated=true.",
  };
}

function refundAmount(o: ShopifyOrder): number {
  let total = 0;
  for (const r of o.refunds ?? []) {
    for (const t of r.transactions ?? []) {
      if (t.kind === "refund") total += Number(t.amount) || 0;
    }
  }
  return total;
}

function orderChannel(o: ShopifyOrder): string {
  const ref = o.referring_site ?? "";
  const landing = o.landing_site ?? "";
  if (/utm_medium=cpc|gclid=/.test(landing)) return "Paid Search";
  if (/facebook|instagram|fbclid=/.test(ref + landing)) return "Paid Social";
  if (/google\./.test(ref)) return "Organic Search";
  if (/utm_medium=email|klaviyo/.test(landing)) return "Email";
  if (ref && !ref.includes(o.landing_site ?? "___")) return "Referral";
  if (!ref && !landing) return "Direct";
  return "Other";
}

/** Compute the group key for an order given the requested dimensions (excluding product/variant which explode line items). */
function groupKey(o: ShopifyOrder, vq: ValidatedQuery): Record<string, string> {
  const key: Record<string, string> = {};
  for (const d of vq.dimensions) {
    switch (d.name) {
      case "date":
        key.date = bucketDate(o.created_at.slice(0, 10), vq.time.grain ?? "day");
        break;
      case "customer_type":
        key.customer_type = (o.customer?.orders_count ?? 1) <= 1 ? "new" : "returning";
        break;
      case "discount_code":
        key.discount_code = o.discount_codes?.[0]?.code ?? "(none)";
        break;
      case "referring_channel":
        key.referring_channel = orderChannel(o);
        break;
      // product / variant handled in the line-item path
    }
  }
  return key;
}

interface Accum {
  key: Record<string, string>;
  orders: Set<string>;
  gross: number;
  refunds: number;
  units: number;
  newCustomerOrders: number;
}

export async function runShopifyCommerceQuery(vq: ValidatedQuery): Promise<ProviderResult> {
  const shopify = getShopifyClient();
  const params = new URLSearchParams({
    status: "any",
    created_at_min: `${vq.time.start}T00:00:00Z`,
    created_at_max: `${vq.time.end}T23:59:59Z`,
    limit: String(PAGE_LIMIT),
  });
  const data = await shopify.rest<{ orders: ShopifyOrder[] }>(`orders.json?${params.toString()}`);
  const orders = data.orders ?? [];
  const truncated = orders.length >= PAGE_LIMIT;

  const byProduct = vq.dimensions.some((d) => d.name === "product" || d.name === "variant");
  const groups = new Map<string, Accum>();
  let orderIdx = 0;

  const ensure = (key: Record<string, string>): Accum => {
    const k = JSON.stringify(key);
    let g = groups.get(k);
    if (!g) {
      g = { key, orders: new Set(), gross: 0, refunds: 0, units: 0, newCustomerOrders: 0 };
      groups.set(k, g);
    }
    return g;
  };

  for (const o of orders) {
    const oid = String(orderIdx++);
    const isNew = (o.customer?.orders_count ?? 1) <= 1;

    if (byProduct) {
      // Explode line items; revenue/units attributed per product or variant.
      for (const li of o.line_items ?? []) {
        const base = groupKey(o, vq);
        if (vq.dimensions.some((d) => d.name === "product")) base.product = li.title ?? "(unknown)";
        if (vq.dimensions.some((d) => d.name === "variant")) base.variant = li.variant_title ?? "(default)";
        const g = ensure(base);
        g.orders.add(oid);
        g.gross += (Number(li.price) || 0) * (li.quantity || 0);
        g.units += li.quantity || 0;
        if (isNew) g.newCustomerOrders += 1;
      }
    } else {
      const g = ensure(groupKey(o, vq));
      g.orders.add(oid);
      g.gross += Number(o.total_price) || 0;
      g.refunds += refundAmount(o);
      g.units += (o.line_items ?? []).reduce((s: number, li) => s + (li.quantity || 0), 0);
      if (isNew) g.newCustomerOrders += 1;
    }
  }

  // If there were no group dimensions, collapse to a single total row.
  if (vq.dimensions.length === 0 && groups.size === 0 && orders.length === 0) {
    return { rows: [emptyRow(vq)], rowCount: 1, truncated };
  }
  if (vq.dimensions.length === 0) {
    // single bucket aggregating everything
    const g = ensure({});
    for (const o of orders) {
      g.orders.add(String(orderIdx++));
      g.gross += Number(o.total_price) || 0;
      g.refunds += refundAmount(o);
      g.units += (o.line_items ?? []).reduce((s: number, li) => s + (li.quantity || 0), 0);
      if ((o.customer?.orders_count ?? 1) <= 1) g.newCustomerOrders += 1;
    }
  }

  const rows = [...groups.values()].map((g) => measureRow(g, vq));
  // Apply ordering + limit client-side
  applyOrder(rows, vq);
  const limited = rows.slice(vq.offset, vq.offset + vq.limit);

  return { rows: limited, rowCount: limited.length, truncated: truncated || rows.length > limited.length };
}

function measureRow(g: Accum, vq: ValidatedQuery): Record<string, unknown> {
  const orders = g.orders.size;
  const out: Record<string, unknown> = { ...g.key };
  for (const m of vq.measures) {
    switch (m.name) {
      case "orders":
        out.orders = orders;
        break;
      case "gross_revenue":
        out.gross_revenue = round(g.gross);
        break;
      case "net_revenue":
        out.net_revenue = round(g.gross - g.refunds);
        break;
      case "refunds":
        out.refunds = round(g.refunds);
        break;
      case "units":
        out.units = g.units;
        break;
      case "aov":
        out.aov = orders > 0 ? round(g.gross / orders) : null;
        break;
      case "new_customer_orders":
        out.new_customer_orders = g.newCustomerOrders;
        break;
      default:
        out[m.name] = null;
    }
  }
  return out;
}

function emptyRow(vq: ValidatedQuery): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of vq.measures) out[m.name] = m.name === "aov" ? null : 0;
  return out;
}

function applyOrder(rows: Record<string, unknown>[], vq: ValidatedQuery): void {
  if (!vq.order.length) return;
  rows.sort((a, b) => {
    for (const o of vq.order) {
      const av = a[o.name];
      const bv = b[o.name];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      if (cmp !== 0) return o.dir === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
