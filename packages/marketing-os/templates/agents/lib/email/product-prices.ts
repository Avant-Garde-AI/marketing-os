/**
 * Real prices for the products a campaign shows.
 *
 * Campaign cards carried the literal string "View piece" where money belongs,
 * because the art graph's `price` field comes back empty and nothing else in
 * the email pack could reach Shopify. The artist card changed that — there is a
 * Shopify GraphQL client here now — so a price is one query away.
 *
 * WHY AT AUTHORING TIME, AND WHY THAT IS NOT ENOUGH. A reviewer cannot judge a
 * campaign whose prices are placeholders, so prices resolve on write. But a
 * price is a fact about a moment: an artifact written today and sent in three
 * weeks can advertise a number the store no longer honours. The draft Action
 * must re-resolve before staging to the ESP — resolving here makes the campaign
 * *reviewable*, not *correct at send*.
 *
 * Prices are NEVER invented. A product the store cannot price keeps whatever
 * the caller had, and the caller is told which ones failed.
 */

import { getShopifyClient } from "../shopify";

export interface PriceResult {
  handle: string;
  /** Formatted for display, e.g. "$72.99". Absent when Shopify had no price. */
  display?: string;
  amount?: number;
  currency?: string;
  /**
   * The product's own featured image.
   *
   * Here rather than in a module of its own because it comes back on the same
   * `productByHandle` node the price does — a second query for the same handles
   * would be a round trip to learn what this one already returned. A campaign
   * whose product cards rendered without pictures is what prompted it: the
   * agent supplied handle, name, href and blurb, all of which it can know, and
   * left `imageUrl` empty, which it cannot.
   */
  imageUrl?: string;
  /** Shopify's own alt text, when the store has written one. */
  imageAlt?: string;
}

interface PriceNode {
  handle?: string;
  featuredImage?: { url?: string; altText?: string | null } | null;
  priceRangeV2?: {
    minVariantPrice?: { amount?: string; currencyCode?: string };
    maxVariantPrice?: { amount?: string; currencyCode?: string };
  } | null;
}

/** Batched by alias — one round trip for a whole product row. */
function buildQuery(handles: string[]): string {
  const fields = `
    handle
    featuredImage { url altText }
    priceRangeV2 {
      minVariantPrice { amount currencyCode }
      maxVariantPrice { amount currencyCode }
    }`;
  const parts = handles.map((h, i) => `p${i}: productByHandle(handle: ${JSON.stringify(h)}) { ${fields} }`);
  return `query CampaignPrices { ${parts.join("\n")} }`;
}

function fmt(amount: string | undefined, currency: string | undefined): string | undefined {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      // Art prices are whole-dollar often enough that ".00" reads as noise, but
      // dropping cents on 72.99 would be a lie. Keep cents only when non-zero.
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency || "$"}${n.toFixed(2)}`;
  }
}

/**
 * Look up display prices for product handles.
 *
 * A range (min ≠ max) renders as "From $X" rather than a single figure — a
 * framed size costing more than an unframed one is normal here, and showing the
 * minimum unqualified would understate what most readers actually pay.
 */
export async function readPrices(handles: string[]): Promise<Map<string, PriceResult>> {
  const out = new Map<string, PriceResult>();
  const unique = [...new Set(handles.filter(Boolean))];
  if (unique.length === 0) return out;

  // Aliased batches; keep them modest so one bad handle cannot fail a huge query.
  const BATCH = 12;
  for (let i = 0; i < unique.length; i += BATCH) {
    const slice = unique.slice(i, i + BATCH);
    try {
      const res = await getShopifyClient().graphql<Record<string, PriceNode | null>>(
        buildQuery(slice),
      );
      if (res?.errors?.length) {
        // Permissions or schema problems must not masquerade as "unpriced".
        throw new Error(res.errors.map((e) => e.message).join("; "));
      }
      for (const [key, node] of Object.entries(res?.data ?? {})) {
        const idx = Number(key.slice(1));
        const handle = slice[idx];
        if (!handle || !node) continue;
        const entry: PriceResult = { handle };
        // Image first, and independent of price: a product the store cannot
        // price still has a picture, and a card with a picture and no price is
        // exactly what this store wants. Bailing on a missing price used to
        // skip the image too.
        if (node.featuredImage?.url) entry.imageUrl = node.featuredImage.url;
        if (node.featuredImage?.altText) entry.imageAlt = node.featuredImage.altText;

        const min = node.priceRangeV2?.minVariantPrice;
        const max = node.priceRangeV2?.maxVariantPrice;
        const lo = fmt(min?.amount, min?.currencyCode);
        if (!lo) {
          if (entry.imageUrl) out.set(handle, entry);
          continue;
        }
        const hi = fmt(max?.amount, max?.currencyCode);
        entry.display = hi && hi !== lo ? `From ${lo}` : lo;
        const n = Number(min?.amount);
        if (Number.isFinite(n)) entry.amount = n;
        if (min?.currencyCode) entry.currency = min.currencyCode;
        out.set(handle, entry);
      }
    } catch (e) {
      console.error(
        `[prices] Shopify lookup failed for ${slice.length} handle(s):`,
        e instanceof Error ? e.message : e,
      );
      // Leave this batch unpriced rather than aborting the write. The caller
      // reports what is missing; a campaign with two real prices and one
      // placeholder is still better than no campaign.
    }
  }
  return out;
}

/** Product handle out of a storefront URL. */
export function handleFromHref(href: string): string {
  const last = href.replace(/\/$/, "").split("/").pop() ?? "";
  return last.split("?")[0]!;
}

/** Prices that are obviously not prices — what this exists to replace. */
export function isPlaceholderPrice(price: string | undefined): boolean {
  if (!price) return true;
  return !/\d/.test(price);
}
