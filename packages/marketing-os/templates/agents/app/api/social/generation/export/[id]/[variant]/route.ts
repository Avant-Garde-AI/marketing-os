import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../../../lib/tenant-context";
import { socialRepo } from "../../../../../../../lib/social/repo";
import { loadGenerationJobForPost } from "../../../../../../../lib/social/generation-review";
import { generationDeliveryRepoFromPreview } from "../../../../../../../lib/social/generation-delivery";
import { loadVerifiedLoopExport, parseLoopExportRange, type LoopExportVariant } from "../../../../../../../lib/social/generation-export";
import { verifyLink } from "../../../../../../../lib/social/review-links";

export const runtime = "nodejs";
export const maxDuration = 60;
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const unavailable = () => NextResponse.json({ error: "Loop export unavailable" }, { status: 404, headers: privateHeaders });

/** Same expiring post-room token as the review page; this route only serves verified bytes. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; variant: string }> }) {
  const { id: postId, variant: rawVariant } = await params;
  const shop = req.nextUrl.searchParams.get("shop") ?? "";
  if (!POST_ID.test(postId) || !SHOP.test(shop) || !(rawVariant === "reel" || rawVariant === "feed") ||
      (process.env.MARKETING_OS_MODE !== "hosted" && shop !== process.env.SHOPIFY_STORE_URL) ||
      verifyLink("review", shop, postId, req.nextUrl.searchParams.get("t"), req.nextUrl.searchParams.get("e")) !== "ok")
    return unavailable();

  try {
    return await runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") }, async () => {
      const job = await loadGenerationJobForPost(postId);
      if (!job || job.postId !== postId || job.mechanic !== "artwork-loop" || job.state !== "succeeded" || !job.videoUrl)
        return unavailable();
      const githubRepo = generationDeliveryRepoFromPreview(job);
      return await runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, ""), githubRepo }, async () => {
        const media = await loadVerifiedLoopExport(socialRepo, job, rawVariant as LoopExportVariant);
        const range = parseLoopExportRange(req.headers.get("range"), media.bytes.length);
        if (range === false) return new NextResponse(null, { status: 416, headers: {
          ...privateHeaders, "Accept-Ranges": "bytes", "Content-Range": `bytes */${media.bytes.length}`,
        } });
        const commonHeaders = {
          ...privateHeaders,
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
          "ETag": `"${media.sha256}"`,
          "Content-Disposition": `${rawVariant === "feed" ? "attachment" : "inline"}; filename="${media.filename}"`,
        };
        if (range) {
          const bytes = media.bytes.subarray(range.start, range.end + 1);
          return new NextResponse(new Uint8Array(bytes), { status: 206, headers: {
            ...commonHeaders,
            "Content-Length": String(bytes.length),
            "Content-Range": `bytes ${range.start}-${range.end}/${media.bytes.length}`,
          } });
        }
        return new NextResponse(new Uint8Array(media.bytes), { status: 200, headers: {
          ...commonHeaders, "Content-Length": String(media.bytes.length),
        } });
      });
    });
  } catch {
    return unavailable();
  }
}
