/**
 * Provider connection health (WS4-R4) — the way the template already checks
 * GA4/Shopify: ask the platform's credential broker for a token. A token
 * back = live connection; PROVIDER_NOT_CONNECTED (with its connect_url) =
 * not connected; RECONNECT_REQUIRED = connected-but-broken. No platform link
 * configured degrades to "unknown" and the UI says so instead of guessing.
 *
 * (The broker probe IS the health check the agent's own tools live by —
 * lib/ga4.ts and lib/shopify.ts resolve through the same endpoint — so the
 * Skills page reports exactly what the tools will experience.)
 */

import { getBrokerToken, BrokerError } from "./broker-client";

export type ConnectionState = "connected" | "not_connected" | "reconnect_required" | "unknown";

export interface ConnectionHealth {
  provider: string;
  state: ConnectionState;
  message?: string;
  /** The platform's connect/reconnect page for this provider, when it told us. */
  actionUrl?: string;
}

export async function checkProviderConnection(
  provider: string,
  product: string
): Promise<ConnectionHealth> {
  if (!process.env.MARKETING_OS_API_URL) {
    return {
      provider,
      state: "unknown",
      message: "Platform link not configured (MARKETING_OS_API_URL) — connection status unavailable.",
    };
  }
  try {
    await getBrokerToken(provider, product);
    return { provider, state: "connected" };
  } catch (e) {
    if (e instanceof BrokerError) {
      const base = { provider, message: e.message, ...(e.actionUrl ? { actionUrl: e.actionUrl } : {}) };
      if (e.code === "PROVIDER_NOT_CONNECTED") return { ...base, state: "not_connected" };
      if (e.code === "RECONNECT_REQUIRED") return { ...base, state: "reconnect_required" };
      return { ...base, state: "unknown" };
    }
    return {
      provider,
      state: "unknown",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
