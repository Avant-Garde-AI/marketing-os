/** A signed-in owner can replace an invalid credential. Review links grant no access here. */
import { NextRequest, NextResponse } from "next/server";
import { socialReviewOperator } from "../../../../lib/social/review-operator";
import { existingInstagramDestination, verifyInstagramReplacement } from "../../../../lib/social/connection";
import { socialRepo } from "../../../../lib/social/repo";
import { channelConnectionStatus, storeChannelToken } from "../../../../lib/broker-client";
import { instagramIdentity } from "../../../../lib/social/channels/instagram";
import { brokerTokenSource } from "../../../../lib/social/channels";
import { runWithTenant } from "../../../../lib/tenant-context";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const tenant = () => ({shop: process.env.SHOPIFY_STORE_URL ?? "", storeSlug: (process.env.SHOPIFY_STORE_URL ?? "").replace(/\.myshopify\.com$/, ""), githubRepo: process.env.GITHUB_REPO ?? null});
export async function GET() {
  if (!await socialReviewOperator()) return json({error: "Sign in to inspect the connection."}, 401);
  try { return await runWithTenant(tenant(), async () => {
    const expected = await existingInstagramDestination(socialRepo);
    const metadata = await channelConnectionStatus();
    try {
      const account = await instagramIdentity(brokerTokenSource);
      const connected = account.id === expected.id && account.username.toLowerCase() === expected.username.toLowerCase();
      return json({account: expected, connected, status: connected ? "connected" : "account_changed", expiresAt: metadata.expiresAt});
    } catch { return json({account: expected, connected: false, status: "reconnect_required", expiresAt: metadata.expiresAt}); }
  }); } catch { return json({error: "Connection status unavailable. Check the tenant account and broker configuration."}, 409); }
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return json({error: "Same-origin request required"}, 403);
  if (!await socialReviewOperator()) return json({error: "Sign in to reconnect Instagram."}, 401);
  const raw = await req.text();
  if (raw.length > 10000) return json({error: "Request too large"}, 413);
  const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
  if (!body || typeof body.token !== "string") return json({error: "A new Instagram Login token is required"}, 400);
  try { return await runWithTenant(tenant(), async () => {
    const expected = await existingInstagramDestination(socialRepo);
    const account = await verifyInstagramReplacement(body.token.trim(), expected);
    // This is the existing credential-connect seam, with verified owner intent.
    // Only the broker persists the durable credential in Vault. No post consent changes.
    await storeChannelToken({channel: "instagram", token: body.token.trim(), externalAccount: account.id, expiresAt: null});
    return json({ok: true, account, message: `Instagram @${account.username} reconnected. Existing posts still require their publishing decision.`});
  }); } catch (error) {
    // Only verifier messages are safe to return; broker/provider errors may carry secrets.
    const message = error instanceof Error ? error.message : "";
    const safe = message.startsWith("This token does not belong") || message.startsWith("The token is missing") || message.startsWith("Instagram rejected") || message.startsWith("Enter a valid");
    return json({error: safe ? message : "Instagram could not be reconnected. Nothing was scheduled; check the account and broker configuration."}, 409);
  }
}
