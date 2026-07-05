/**
 * Client for the Marketing OS credential broker (POST /api/broker/token),
 * tenant-aware for the pooled hosted runtime.
 *
 * Auth modes (env-driven, two-path invariant):
 *  - client-owned: Authorization: Bearer <MARKETING_OS_DEPLOYMENT_KEY>
 *    (the deployment IS the tenant; the broker resolves it from the key)
 *  - hosted:       Authorization: Bearer <MOS_PLATFORM_SERVICE_KEY>
 *                  + x-mos-tenant-shop: <shop>
 *    (one pooled deployment, tenant asserted per request; the service key is
 *    shared platform infra, never a per-tenant secret)
 *
 * Tokens are cached per (tenant, provider, product) with a 60s safety margin.
 */

import { HOSTED, getTenant } from "./tenant-context";

const TTL_SAFETY_MS = 60 * 1000;

export class BrokerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly actionUrl?: string
  ) {
    super(message);
    this.name = "BrokerError";
  }
}

export interface BrokerToken {
  accessToken: string;
  context: Record<string, unknown>;
  expiresAt: number;
}

const cache = new Map<string, BrokerToken>();

export async function getBrokerToken(provider: string, product: string): Promise<BrokerToken> {
  const tenant = getTenant();
  const key = `${tenant.storeSlug}:${provider}:${product}`;

  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const apiUrl = process.env.MARKETING_OS_API_URL;
  if (!apiUrl) {
    throw new BrokerError("MARKETING_OS_API_URL is not configured.", "NOT_CONFIGURED", 500);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (HOSTED) {
    const serviceKey = process.env.MOS_PLATFORM_SERVICE_KEY;
    if (!serviceKey) {
      throw new BrokerError("MOS_PLATFORM_SERVICE_KEY is not configured.", "NOT_CONFIGURED", 500);
    }
    headers.Authorization = `Bearer ${serviceKey}`;
    headers["x-mos-tenant-shop"] = tenant.shop;
  } else {
    const deploymentKey = process.env.MARKETING_OS_DEPLOYMENT_KEY;
    if (!deploymentKey) {
      throw new BrokerError(
        "MARKETING_OS_DEPLOYMENT_KEY is not configured.",
        "NOT_CONFIGURED",
        500
      );
    }
    headers.Authorization = `Bearer ${deploymentKey}`;
  }

  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/broker/token`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider, product }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
      reconnect_url?: string;
      connect_url?: string;
    } | null;
    throw new BrokerError(
      body?.message ?? `Broker error ${res.status}`,
      body?.error ?? "BROKER_ERROR",
      res.status,
      body?.reconnect_url ?? body?.connect_url
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    context?: Record<string, unknown>;
  };

  const token: BrokerToken = {
    accessToken: data.access_token,
    context: data.context ?? {},
    expiresAt: Date.now() + data.expires_in * 1000 - TTL_SAFETY_MS,
  };
  cache.set(key, token);
  return token;
}
