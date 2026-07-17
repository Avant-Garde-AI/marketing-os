/**
 * Assembled-email preview (02 §7, WS4-R3's iframe source) — OUR renderer,
 * not Klaviyo's, so previews work before anything exists in Klaviyo.
 *
 * Access model: campaign ids are guessable (unlike design-surface UUIDs), so
 * this route requires an HMAC token derived from (shop, campaignId) — the
 * preview URLs minted by email_render_preview / the Actions carry it. The
 * response is the real assembled HTML in a locked-down document (CSP header:
 * images only, no scripts) suitable for the console's sandboxed iframe.
 */

import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../lib/tenant-context";
import { emailRepo } from "../../../../../lib/email/repo";
import { campaignPath, parseCampaign } from "../../../../../lib/email/artifacts";
import { assembleCampaign } from "../../../../../lib/email/assemble";
import { emailPreviewToken } from "../../../../../lib/email/preview-url";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const shop = req.nextUrl.searchParams.get("shop") ?? process.env.SHOPIFY_STORE_URL ?? "";
  if (!shop) return NextResponse.json({ error: "shop required" }, { status: 400 });

  // Token check — skipped only when no secret is configured (dev).
  const expected = emailPreviewToken(shop, id);
  if (expected && req.nextUrl.searchParams.get("t") !== expected) {
    return NextResponse.json({ error: "invalid preview token" }, { status: 403 });
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
        // Belt-and-braces with the console's iframe sandbox: images/styles
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
