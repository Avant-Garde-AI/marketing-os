import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../../lib/tenant-context";
import { socialRepo } from "../../../../../../lib/social/repo";
import { loadGenerationJobForPost } from "../../../../../../lib/social/generation-review";
import { loadGenerationDelivery, renderGenerationScene } from "../../../../../../lib/social/generation-delivery";
import { verifyLink } from "../../../../../../lib/social/review-links";

export const runtime = "nodejs";
export const maxDuration = 60;
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const unavailable = () => NextResponse.json({ error: "Scene render unavailable" }, { status: 404, headers: privateHeaders });

/** The post-room token grants one read; it never authorizes a provider call or publish. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const shop = req.nextUrl.searchParams.get("shop") ?? "";
  if (!POST_ID.test(postId) || !SHOP.test(shop) ||
      (process.env.MARKETING_OS_MODE !== "hosted" && shop !== process.env.SHOPIFY_STORE_URL) ||
      verifyLink("review", shop, postId, req.nextUrl.searchParams.get("t"), req.nextUrl.searchParams.get("e")) !== "ok")
    return unavailable();
  try {
    return await runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") }, async () => {
      const job = await loadGenerationJobForPost(postId);
      if (!job || job.mechanic !== "collection-scene" || job.state !== "succeeded" || !job.imageUrl)
        return unavailable();
      const receipt = await loadGenerationDelivery(socialRepo, job);
      if (!receipt?.scene) return unavailable();
      const jpeg = await renderGenerationScene(socialRepo, job, receipt);
      return new NextResponse(new Uint8Array(jpeg), { status: 200, headers: { ...privateHeaders, "Content-Type": "image/jpeg" } });
    });
  } catch {
    // Never return the provider background, artwork bytes, or internal paths on failure.
    return unavailable();
  }
}
