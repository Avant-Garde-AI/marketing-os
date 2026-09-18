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

/**
 * The broker's two-path auth, in one place.
 *
 * Extracted when the WRITE path (storeChannelToken) landed: two copies of
 * this would be two chances for the hosted lane to drift from the
 * client-owned one, and a request that authenticates as the wrong tenant is
 * the worst failure this system has — it does not error, it succeeds against
 * somebody else's store.
 */
function brokerHeaders(): Record<string, string> {
  const tenant = getTenant();
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
  return headers;
}

export async function getBrokerToken(provider: string, product: string): Promise<BrokerToken> {
  const tenant = getTenant();
  const key = `${tenant.storeSlug}:${provider}:${product}`;

  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const apiUrl = process.env.MARKETING_OS_API_URL;
  if (!apiUrl) {
    throw new BrokerError("MARKETING_OS_API_URL is not configured.", "NOT_CONFIGURED", 500);
  }

  const headers = brokerHeaders();

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

// ---------------------------------------------------------------------------
// Channel publish tokens — the write half (POST /api/broker/channel-token)
// ---------------------------------------------------------------------------

export interface ChannelConnectionStatus {
  connected: boolean;
  status: string | null;
  channels: string[];
  expiresAt: string | null;
  lastRefresh: string | null;
  daysRemaining: number | null;
}

function apiBase(): string {
  const apiUrl = process.env.MARKETING_OS_API_URL;
  if (!apiUrl) {
    throw new BrokerError("MARKETING_OS_API_URL is not configured.", "NOT_CONFIGURED", 500);
  }
  return apiUrl.replace(/\/$/, "");
}

async function channelTokenCall<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${apiBase()}/api/broker/channel-token`, {
    method: "POST",
    headers: brokerHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new BrokerError(
      err?.message ?? `Broker error ${res.status}`,
      err?.error ?? "BROKER_ERROR",
      res.status,
    );
  }
  return (await res.json()) as T;
}

/**
 * Persist a renewed publish token for a channel.
 *
 * Invalidates the read cache for that channel: the whole point of storing a
 * new token is that the next publish uses it, and a 60-second cache holding
 * the token we just replaced would make a refresh look like it did nothing.
 */
export async function storeChannelToken(opts: {
  channel: string;
  token: string;
  expiresAt?: Date | null;
  externalAccount?: string | null;
}): Promise<{ created: boolean; channels: string[]; expiresAt: string | null }> {
  const result = await channelTokenCall<{
    ok: boolean;
    created: boolean;
    channels: string[];
    expiresAt: string | null;
  }>({
    action: "store",
    channel: opts.channel,
    token: opts.token,
    expiresAt: opts.expiresAt?.toISOString() ?? null,
    externalAccount: opts.externalAccount ?? null,
  });
  cache.delete(`${getTenant().storeSlug}:meta:${opts.channel}`);
  return result;
}

/** Connection metadata only — never a token. */
export async function channelConnectionStatus(): Promise<ChannelConnectionStatus> {
  return channelTokenCall<ChannelConnectionStatus>({ action: "status" });
}
