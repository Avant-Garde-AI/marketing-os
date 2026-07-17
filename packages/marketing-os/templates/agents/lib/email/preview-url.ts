/**
 * Preview-URL minting for the assembled-email route (one place, so the token
 * scheme can't drift between the tool, the Actions, and the route).
 * Campaign ids are guessable — unlike design-surface UUIDs — so preview URLs
 * carry an HMAC token over (shop, campaignId).
 */

import { createHmac } from "node:crypto";

export function emailPreviewToken(shop: string, campaignId: string): string | null {
  const secret = process.env.ACTIONS_GATE_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return null; // dev without secrets: route skips the check too
  return createHmac("sha256", secret)
    .update(`email-preview:${shop}:${campaignId}`)
    .digest("base64url")
    .slice(0, 32);
}

export function emailPreviewUrl(shop: string, campaignId: string): string {
  const base = (process.env.MOS_AGENTS_PUBLIC_URL ?? "").replace(/\/$/, "");
  const token = emailPreviewToken(shop, campaignId);
  const t = token ? `&t=${token}` : "";
  return `${base}/api/email/preview/${encodeURIComponent(campaignId)}?shop=${encodeURIComponent(shop)}${t}`;
}
