/**
 * Connector-token verification for the store's /api/mcp endpoint.
 *
 * A presented `mos_…` token is verified against the Marketing OS platform
 * (POST /api/connector/verify) and the result cached for 60s, so revocation
 * propagates within a minute. Raw tokens are never logged.
 */

const VERIFY_TTL_MS = 60 * 1000;

export interface ConnectorAuth {
  valid: boolean;
  tenantId?: string;
  shop?: string;
  storeSlug?: string;
  scopes?: string[];
  label?: string;
}

const cache = new Map<string, { result: ConnectorAuth; at: number }>();

/** Extract a connector token from a request: Authorization: Bearer, or ?token=. */
export function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const url = new URL(req.url);
  const q = url.searchParams.get("token");
  return q || null;
}

export async function verifyConnectorToken(token: string): Promise<ConnectorAuth> {
  if (!token) return { valid: false };

  const cached = cache.get(token);
  if (cached && Date.now() - cached.at < VERIFY_TTL_MS) return cached.result;

  const apiUrl = process.env.MARKETING_OS_API_URL;
  if (!apiUrl) {
    // No platform configured — fall back to a local shared token if present.
    const local = process.env.MCP_LOCAL_TOKEN;
    const result: ConnectorAuth = local && token === local ? { valid: true, label: "local" } : { valid: false };
    return result;
  }

  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/connector/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const result = (await res.json().catch(() => ({ valid: false }))) as ConnectorAuth;
    cache.set(token, { result, at: Date.now() });
    return result;
  } catch {
    return { valid: false };
  }
}
