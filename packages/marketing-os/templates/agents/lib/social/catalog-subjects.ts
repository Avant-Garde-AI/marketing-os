/** Read a small, exact set of current products for graph-backed social plans. */

import { getShopifyClient, type GraphQLResponse } from "../shopify";

export interface CatalogSubject {
  handle: string;
  title: string;
  status: string;
  onlineStoreUrl?: string;
  imageUrl?: string;
}

interface ProductNode {
  handle: string;
  title: string;
  status: string;
  onlineStoreUrl?: string | null;
  featuredMedia?: { image?: { url?: string | null } | null } | null;
}

interface ProductsData {
  products?: { nodes?: Array<ProductNode | null> };
}

export type CatalogQuery = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<GraphQLResponse<ProductsData>>;

const MAX_HANDLES = 6;

const PRODUCTS_QUERY = `
  query SocialCatalogSubjects($first: Int!, $query: String!) {
    products(first: $first, query: $query) {
      nodes {
        handle
        title
        status
        onlineStoreUrl
        featuredMedia { ... on MediaImage { image { url } } }
      }
    }
  }
`;

/**
 * Resolve exact product handles in the current tenant's Shopify catalog.
 * Missing products are omitted so the caller can distinguish them from
 * returned products that are inactive, unpublished, or missing an image.
 * Product availability is deliberately not inferred from its status.
 */
export async function readCatalogSubjects(
  handles: string[],
  query: CatalogQuery = (document, variables) =>
    getShopifyClient().graphql<ProductsData>(document, variables),
): Promise<CatalogSubject[]> {
  const uniqueHandles = [...new Set(handles)];
  if (uniqueHandles.length > MAX_HANDLES) {
    throw new Error(`At most ${MAX_HANDLES} catalog handles may be requested`);
  }
  if (uniqueHandles.some((handle) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(handle))) {
    throw new Error("Catalog handles must be non-empty Shopify handles");
  }
  if (uniqueHandles.length === 0) return [];

  // Handle syntax is constrained above, then encoded as a GraphQL variable.
  // No caller-provided text is interpolated into the document or search syntax.
  const search = uniqueHandles.map((handle) => `handle:${handle}`).join(" OR ");
  const response = await query(PRODUCTS_QUERY, { first: MAX_HANDLES, query: search });
  if (response.errors?.length) {
    throw new Error(`Shopify catalog query failed: ${response.errors.map((error) => error.message).join("; ")}`);
  }
  if (!Array.isArray(response.data?.products?.nodes)) throw new Error("Shopify catalog query returned no product result");

  const found = new Map<string, CatalogSubject>();
  for (const product of response.data.products.nodes) {
    if (!product) continue;
    if (!uniqueHandles.includes(product.handle)) {
      throw new Error(`Shopify returned unexpected catalog handle: ${product.handle}`);
    }
    if (found.has(product.handle)) {
      throw new Error(`Shopify returned duplicate catalog handle: ${product.handle}`);
    }
    found.set(product.handle, {
      handle: product.handle,
      title: product.title,
      status: product.status,
      ...(product.onlineStoreUrl ? { onlineStoreUrl: product.onlineStoreUrl } : {}),
      ...(product.featuredMedia?.image?.url
        ? { imageUrl: product.featuredMedia.image.url }
        : {}),
    });
  }

  // Preserve graph candidate order while omitting handles absent from Shopify.
  return uniqueHandles.flatMap((handle) => {
    const subject = found.get(handle);
    return subject ? [subject] : [];
  });
}
