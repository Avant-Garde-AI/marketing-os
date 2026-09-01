/**
 * Serves a campaign's stored imagery.
 *
 * The counterpart to lib/store-repo/assets.ts: `imagery_resolve` hands back a
 * signed GCS URL good for 24 hours, the campaign upsert copies those bytes into
 * the store, and this route serves them at a URL that does not rot. Before it
 * existed, every review link older than a day rendered a page of broken images
 * — the link lived 30 days, the pictures inside it did not.
 *
 * Cached hard and immutably: asset names carry a content hash, so a given name
 * always means the same bytes. Changing the image changes the name.
 */

import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../../lib/tenant-context";
import { emailRepo } from "../../../../../../lib/email/repo";
import { readAsset } from "../../../../../../lib/store-repo/assets";
import { verifyLink } from "../../../../../../lib/email/review-links";

export const runtime = "nodejs";

const ID_RE = /^[A-Za-z0-9._-]+$/;
const NAME_RE = /^[A-Za-z0-9._-]+$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const shop = q.get("shop") ?? process.env.SHOPIFY_STORE_URL ?? "";

  if (!shop || !ID_RE.test(id) || !NAME_RE.test(name)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const verdict = verifyLink("asset", shop, `${id}/${name}`, q.get("t"), q.get("e"));
  if (verdict !== "ok") {
    return NextResponse.json(
      { error: verdict === "expired" ? "asset link expired" : "invalid asset token" },
      { status: verdict === "expired" ? 410 : 403 },
    );
  }

  const asset = await runWithTenant(
    { shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") },
    () => readAsset(emailRepo, id, name),
  );

  if (!asset) {
    // Say which of the two it is. "Not found" and "the store is unreachable"
    // look identical in a broken-image icon, and telling them apart is the
    // difference between a five-minute fix and an afternoon.
    return NextResponse.json({ error: `no stored asset "${name}" for campaign "${id}"` }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.bytes.length),
      // Content-addressed name ⇒ safe to cache forever.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
