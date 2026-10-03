import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../../lib/tenant-context";
import { socialRepo } from "../../../../../../lib/social/repo";
import { readSocialFile } from "../../../../../../lib/social/repo";
import { readSocialVideo } from "../../../../../../lib/social/video-assets";
import { parseLoopExportRange } from "../../../../../../lib/social/generation-export";
import { readSocialImage } from "../../../../../../lib/storyboard/assets";

export const runtime = "nodejs";

/** Public image bytes for review and channel fetches; never serves planning context or approval authority. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ shop: string; name: string }> }) {
  const { shop, name } = await ctx.params;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !/^[a-f0-9]{64}\.(?:jpeg|mp4)$/.test(name))
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  // A client-owned deployment cannot expose another shop by choosing a path.
  if (process.env.MARKETING_OS_MODE !== "hosted" && shop !== process.env.SHOPIFY_STORE_URL)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    // Hosted public requests have no trusted GitHub repo binding. Read the tenant-keyed
    // working store, rather than falling back to a deployment-wide git credential.
    const repo = process.env.MARKETING_OS_MODE === "hosted"
      ? { ...socialRepo, readFile: (path: string) => readSocialFile(shop, path) }
      : socialRepo;
    const bytes = await runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") },
      () => name.endsWith(".mp4") ? readSocialVideo(repo, name.slice(0, -4)) : readSocialImage(repo, name.slice(0, -5)));
    if (!bytes) return NextResponse.json({ error: "not found" }, { status: 404 });
    const video = name.endsWith(".mp4");
    const range = video ? parseLoopExportRange(req.headers.get("range"), bytes.length) : null;
    if (range === false) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}` } });
    const content = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    return new NextResponse(new Uint8Array(content), { status: range ? 206 : 200, headers: {
      ...(video ? { "Accept-Ranges": "bytes" } : {}),
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}` } : {}),
      "Content-Type": video ? "video/mp4" : "image/jpeg", "Content-Length": String(content.length),
      "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "asset unavailable" }, { status: 503 });
  }
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ shop: string; name: string }> }) {
  const response = await GET(req, ctx);
  return new NextResponse(null, { status: response.status, headers: response.headers });
}
