/**
 * Shared Shopify API client for Marketing OS agents.
 *
 * Provides both REST and GraphQL Admin API access through a single interface.
 * All tools and skills should use this client instead of making direct fetch calls.
 *
 * Authentication resolves in order:
 *   1. An explicit accessToken passed to createShopifyClient
 *   2. Hosted mode: the credential broker (provider=shopify) with the platform
 *      service key + per-request tenant context
 *   3. Client-owned: the platform token broker via MARKETING_OS_API_URL and
 *      MARKETING_OS_API_KEY (the token comes from the Marketing OS Shopify app
 *      installed on the store)
 *   4. SHOPIFY_ACCESS_TOKEN (manual token, legacy setup)
 *
 * The store URL resolves from the per-request tenant context (hosted) or env
 * (client-owned) — see lib/tenant-context.ts.
 */

import { HOSTED, getTenant } from "./tenant-context";
import { getBrokerToken } from "./broker-client";

const SHOPIFY_API_VERSION = "2025-04";
const BROKER_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface ShopifyClientConfig {
  storeUrl?: string;
  accessToken?: string;
}

export interface GraphQLResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
  extensions?: Record<string, unknown>;
}

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

let _brokerToken: { token: string; fetchedAt: number } | null = null;

async function fetchBrokerToken(): Promise<string> {
  const apiUrl = process.env.MARKETING_OS_API_URL!;
  const apiKey = process.env.MARKETING_OS_API_KEY!;

  if (_brokerToken && Date.now() - _brokerToken.fetchedAt < BROKER_TOKEN_TTL_MS) {
    return _brokerToken.token;
  }

  const response = await fetch(
    `${apiUrl.replace(/\/$/, "")}/api/shopify-token`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ShopifyApiError(
      `Marketing OS token broker error: ${response.status} ${response.statusText}`,
      response.status,
      body
    );
  }

  const { accessToken } = (await response.json()) as { accessToken: string };
  _brokerToken = { token: accessToken, fetchedAt: Date.now() };
  return accessToken;
}

async function resolveAccessToken(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (HOSTED) {
    // Pooled runtime: per-tenant offline token from the broker (never env).
    const token = await getBrokerToken("shopify", "admin");
    return token.accessToken;
  }
  if (process.env.MARKETING_OS_API_URL && process.env.MARKETING_OS_API_KEY) {
    return fetchBrokerToken();
  }
  return process.env.SHOPIFY_ACCESS_TOKEN!;
}

/**
 * Create a Shopify API client.
 *
 * Falls back to the tenant context (hosted) or environment variables
 * (client-owned) when config values are not provided.
 */
export function createShopifyClient(config?: ShopifyClientConfig) {
  const storeUrl = config?.storeUrl ?? (getTenant().shop || process.env.SHOPIFY_STORE_URL!);

  const baseUrl = `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}`;
  const getHeaders = async (): Promise<Record<string, string>> => ({
    "X-Shopify-Access-Token": await resolveAccessToken(config?.accessToken),
    "Content-Type": "application/json",
  });

  return {
    /**
     * Make a REST Admin API request.
     *
     * @param endpoint - Resource path without version prefix (e.g. "shop.json", "orders.json?limit=10")
     * @param options - Additional fetch options (method, body, etc.)
     */
    async rest<T = Record<string, unknown>>(
      endpoint: string,
      options?: RequestInit
    ): Promise<T> {
      const url = `${baseUrl}/${endpoint}`;
      const response = await fetch(url, {
        ...options,
        headers: { ...(await getHeaders()), ...options?.headers },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ShopifyApiError(
          `Shopify REST API error: ${response.status} ${response.statusText}`,
          response.status,
          body
        );
      }

      return response.json() as Promise<T>;
    },

    /**
     * Make a GraphQL Admin API request.
     *
     * @param query - GraphQL query or mutation string
     * @param variables - Optional query variables
     */
    async graphql<T = Record<string, unknown>>(
      query: string,
      variables?: Record<string, unknown>
    ): Promise<GraphQLResponse<T>> {
      const url = `${baseUrl}/graphql.json`;
      const response = await fetch(url, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ShopifyApiError(
          `Shopify GraphQL API error: ${response.status} ${response.statusText}`,
          response.status,
          body
        );
      }

      const result = (await response.json()) as GraphQLResponse<T>;

      if (result.errors?.length) {
        const messages = result.errors.map((e) => e.message).join("; ");
        throw new ShopifyApiError(
          `Shopify GraphQL errors: ${messages}`,
          200,
          result
        );
      }

      return result;
    },

    /** The resolved store URL */
    storeUrl,
    /** The API version in use */
    apiVersion: SHOPIFY_API_VERSION,
  };
}

/**
 * Default client for use in tools and skills.
 *
 * Client-owned: a lazily-initialized singleton (the deployment IS the tenant).
 * Hosted: cached PER TENANT, keyed by store slug — a client captures its
 * store URL at construction, so sharing one across tenants would leak requests
 * to the wrong shop.
 */
const _clients = new Map<string, ReturnType<typeof createShopifyClient>>();

export function getShopifyClient(): ReturnType<typeof createShopifyClient> {
  const key = HOSTED ? getTenant().storeSlug : "__default__";
  let client = _clients.get(key);
  if (!client) {
    client = createShopifyClient();
    _clients.set(key, client);
  }
  return client;
}
