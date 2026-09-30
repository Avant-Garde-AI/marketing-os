import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../../../lib/tenant-context";
import { socialRepo } from "../../../../../../../lib/social/repo";
import { loadGenerationJobForPost } from "../../../../../../../lib/social/generation-review";
import { generationDeliveryRepoFromPreview, loadGenerationDelivery, renderGenerationScene } from "../../../../../../../lib/social/generation-delivery";
import { loadGenerationCarousel, readPersistedCarouselImage } from "../../../../../../../lib/social/generation-carousel";
import { readGenerationInput } from "../../../../../../../lib/social/generation-input";
import { verifyCarouselReviewLink } from "../../../../../../../lib/social/review-links";

export const runtime = "nodejs";
export const maxDuration = 60;
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const unavailable = () => NextResponse.json({ error: "Carousel slide unavailable" }, { status: 404, headers: privateHeaders });

/** A parent token reads only one member of its immutable ordered manifest. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id: parentPostId, index } = await params;
  const shop = req.nextUrl.searchParams.get("shop") ?? "";
  const repo = req.nextUrl.searchParams.get("repo");
  if (!SHOP.test(shop) || !/^[123]$/.test(index) ||
      (process.env.MARKETING_OS_MODE !== "hosted" && shop !== process.env.SHOPIFY_STORE_URL) ||
      verifyCarouselReviewLink(shop, parentPostId, repo,
        req.nextUrl.searchParams.get("t"), req.nextUrl.searchParams.get("e")) !== "ok") return unavailable();
  try {
    return await runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, ""), githubRepo: repo }, async () => {
      const manifest = await loadGenerationCarousel(socialRepo, parentPostId);
      const slide = manifest?.slides[Number(index) - 1];
      if (!slide) return unavailable();
      const job = await loadGenerationJobForPost(slide.postId);
      if (!job || job.artifactId !== slide.artifactId || job.inputHash !== slide.inputHash ||
          job.mechanic !== "collection-scene" || job.state !== "succeeded" || !job.imageUrl ||
          generationDeliveryRepoFromPreview(job) !== repo) return unavailable();
      const input = await readGenerationInput(socialRepo, slide.artifactId);
      if (input.inputHash !== slide.inputHash || input.plan.postId !== slide.postId ||
          input.plan.sceneComposition !== "single-artwork") return unavailable();
      const delivery = await loadGenerationDelivery(socialRepo, job);
      if (!delivery?.scene) return unavailable();
      const jpeg = slide.finalImage
        ? await readPersistedCarouselImage(socialRepo, slide)
        : await renderGenerationScene(socialRepo, job, delivery);
      return new NextResponse(new Uint8Array(jpeg), { status: 200,
        headers: { ...privateHeaders, "Content-Type": "image/jpeg" } });
    });
  } catch { return unavailable(); }
}
