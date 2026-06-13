/**
 * Verify the router-signed proxy handoff (Shopify App Proxy path).
 *
 * When a request arrives via the Shopify App Proxy, the platform router has
 * already verified Shopify's HMAC and signs a short-lived header over the shop +
 * timestamp with the shared MCP_PROXY_SECRET. This deployment trusts that header
 * in lieu of a connector token — possession of a valid Shopify-origin signature
 * IS the credential. The Shopify app secret never reaches this deployment.
 */

import crypto from "node:crypto";

const WINDOW_MS = 2 * 60 * 1000;

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifyProxyHandoff(req: Request): boolean {
  const secret = process.env.MCP_PROXY_SECRET;
  if (!secret) return false;

  const shop = req.headers.get("x-mos-proxy-shop");
  const ts = req.headers.get("x-mos-proxy-ts");
  const sig = req.headers.get("x-mos-proxy-sig");
  if (!shop || !ts || !sig) return false;

  if (!Number(ts) || Math.abs(Date.now() - Number(ts)) > WINDOW_MS) return false;

  // The proxied shop must be this store.
  const myShop = (process.env.SHOPIFY_STORE_URL ?? "").toLowerCase();
  if (myShop && shop.toLowerCase() !== myShop) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${shop}.${ts}`).digest("hex");
  return timingSafeHexEqual(expected, sig);
}
