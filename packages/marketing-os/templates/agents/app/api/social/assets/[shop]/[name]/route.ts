import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../../lib/tenant-context";
import { socialRepo } from "../../../../../../lib/social/repo";
import { readSocialFile } from "../../../../../../lib/social/repo";
import { readSocialImage } from "../../../../../../lib/storyboard/assets";

export const runtime = "nodejs";

/** Public image bytes for review and channel fetches; never serves planning context or approval authority. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ shop: string; name: string }> }) {
  const { shop, name } = await ctx.params;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !/^[a-f0-9]{64}\.jpeg$/.test(name))
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
      () => readSocialImage(repo, name.slice(0, -5)));
    if (!bytes) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/jpeg", "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "asset unavailable" }, { status: 503 });
  }
}
