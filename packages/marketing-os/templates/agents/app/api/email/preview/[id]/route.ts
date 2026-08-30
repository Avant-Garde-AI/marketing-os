/**
 * Assembled-email preview (02 §7) — OUR renderer, not Klaviyo's, so previews
 * work before anything exists in Klaviyo. This is the RAW document: exactly
 * what the ESP will receive, nothing around it. The reviewer-facing surface
 * with context and notes is /review/email/[id]; this route is what its frame
 * points at, and what "open full size" opens.
 *
 * Access model: campaign ids are guessable, so the URL carries an HMAC over
 * (scope, shop, id, expiry) — see lib/email/review-links.ts. The token is
 * minted by the tools and by the console page; it expires.
 */

import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../lib/tenant-context";
import { emailRepo } from "../../../../../lib/email/repo";
import { campaignPath, parseCampaign } from "../../../../../lib/email/artifacts";
import { assembleCampaign } from "../../../../../lib/email/assemble";
import { verifyLink } from "../../../../../lib/email/review-links";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const shop = q.get("shop") ?? process.env.SHOPIFY_STORE_URL ?? "";
  if (!shop) return NextResponse.json({ error: "shop required" }, { status: 400 });

  const verdict = verifyLink("preview", shop, id, q.get("t"), q.get("e"));
  if (verdict !== "ok") {
    // Distinguish the two: an expired link is a normal, expected end-of-life
    // that a reviewer can fix by asking for a fresh one. A flat 403 for both
    // reads as a bug and generates a support round-trip.
    return NextResponse.json(
      {
        error: verdict === "expired" ? "preview link expired" : "invalid preview token",
        hint:
          verdict === "expired"
            ? "Ask for a fresh review link — these expire so they can't outlive the campaign."
            : undefined,
      },
      { status: verdict === "expired" ? 410 : 403 },
    );
  }

  try {
    const html = await runWithTenant(
      { shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") },
      async () => {
        const raw = await emailRepo.readFile(campaignPath(id));
        if (raw === null) throw new Error(`campaign "${id}" not found`);
        const campaign = parseCampaign(raw);
        const assembled = await assembleCampaign(campaign);
        return assembled.html;
      },
    );
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Belt-and-braces with the embedding iframe's sandbox: images/styles
        // only (assembled email carries inline CSS + remote images).
        "Content-Security-Policy":
          "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:",
        "X-Frame-Options": "SAMEORIGIN",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
