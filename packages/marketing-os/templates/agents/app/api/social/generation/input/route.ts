import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../lib/tenant-context";
import { socialRepo } from "../../../../../lib/social/repo";
import { readGenerationInput } from "../../../../../lib/social/generation-input";
import { socialGenerationReviewLink } from "../../../../../lib/social/review-links";
export const runtime = "nodejs";
export const maxDuration = 60;
const repoName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Service-only read. The platform owns OAuth, approval and provider writes. */
export async function POST(req: NextRequest) {
  const secret = process.env.ACTIONS_GATE_SECRET;
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string" || typeof body.shop !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(body.shop) ||
      (process.env.MARKETING_OS_MODE === "hosted" && (typeof body.githubRepo !== "string" || !repoName.test(body.githubRepo))))
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  if (process.env.MARKETING_OS_MODE !== "hosted" && body.shop !== process.env.SHOPIFY_STORE_URL)
    return NextResponse.json({ error: "tenant mismatch" }, { status: 403 });
  try {
    const githubRepo = process.env.MARKETING_OS_MODE === "hosted" ? body.githubRepo as string : null;
    const result = await runWithTenant({ shop: body.shop, storeSlug: body.shop.replace(/\.myshopify\.com$/, ""), githubRepo },
      () => readGenerationInput(socialRepo, body.id));
    return NextResponse.json({ plan: result.plan, prepared: result.prepared, inputHash: result.inputHash,
      ...(body.includeBytes === true ? { base64: result.base64 } : {}),
      previewUrl: socialGenerationReviewLink(body.shop, body.id, result.inputHash, githubRepo).url,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Generation input missing, changed or invalid" }, { status: 409 });
  }
}
