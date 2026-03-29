/**
 * Shopify OAuth 2.0 helpers.
 *
 * Implements the standard Shopify OAuth handshake:
 *   1. Build authorization URL → redirect merchant to Shopify consent screen
 *   2. Exchange authorization code for access token on callback
 *   3. Verify HMAC signature on callback params
 */

import crypto from "crypto";

// ---------------------------------------------------------------------------
// Config — read from env
// ---------------------------------------------------------------------------
function getConfig() {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const scopes = process.env.SHOPIFY_SCOPES ?? "read_products,read_orders,read_customers,read_analytics,read_inventory,read_marketing_events,write_products";
  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (!clientId || !clientSecret) {
    throw new Error("SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are required");
  }

  return { clientId, clientSecret, scopes, appUrl };
}

// ---------------------------------------------------------------------------
// 1. Build authorization URL
// ---------------------------------------------------------------------------
export function buildAuthUrl(shop: string, nonce: string): string {
  const { clientId, scopes, appUrl } = getConfig();
  const redirectUri = `${appUrl}/api/shopify/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state: nonce,
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// 2. Exchange code for access token
// ---------------------------------------------------------------------------
export async function exchangeCodeForToken(
  shop: string,
  code: string
): Promise<{ accessToken: string; scope: string }> {
  const { clientId, clientSecret } = getConfig();

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    scope: string;
  };

  return { accessToken: data.access_token, scope: data.scope };
}

// ---------------------------------------------------------------------------
// 3. Verify HMAC signature on callback query params
// ---------------------------------------------------------------------------
export function verifyHmac(query: Record<string, string>): boolean {
  const { clientSecret } = getConfig();
  const hmac = query.hmac;
  if (!hmac) return false;

  // Build message from sorted params (excluding hmac itself)
  const entries = Object.entries(query)
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b));

  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");

  const digest = crypto
    .createHmac("sha256", clientSecret)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

// ---------------------------------------------------------------------------
// 4. Validate shop domain format
// ---------------------------------------------------------------------------
export function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}
