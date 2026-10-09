/** A signed-in owner edits a caption or send time in place. A review link alone cannot. */
import { NextRequest, NextResponse } from "next/server";
import { socialReviewOperator } from "../../../../lib/social/review-operator";
import { runWithTenant } from "../../../../lib/tenant-context";
import { ownerEditPost } from "../../../../lib/social/owner-edit";
export const runtime = "nodejs";
export const maxDuration = 60;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

/** Is the person looking at this review page a signed-in owner? Decides whether the controls show. */
export async function GET() {
  return json({ signedIn: (await socialReviewOperator().catch(() => null)) !== null });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return json({ error: "Same-origin request required" }, 403);
  const user = await socialReviewOperator();
  if (!user) return json({ error: "Sign in to edit." }, 401);
  const body = (await req.json().catch(() => null)) as { postId?: unknown; copy?: unknown; plannedAt?: unknown } | null;
  if (!body || typeof body.postId !== "string" || !POST_ID.test(body.postId) ||
      (body.copy !== undefined && typeof body.copy !== "string") ||
      (body.plannedAt !== undefined && typeof body.plannedAt !== "string") ||
      (body.copy === undefined && body.plannedAt === undefined))
    return json({ error: "Nothing to change" }, 400);
  const shop = process.env.SHOPIFY_STORE_URL ?? "";
  try {
    const result = await runWithTenant(
      { shop, storeSlug: shop.replace(/\.myshopify\.com$/, ""), githubRepo: process.env.GITHUB_REPO ?? null },
      () => ownerEditPost(body.postId as string, {
        ...(typeof body.copy === "string" ? { copy: body.copy } : {}),
        ...(typeof body.plannedAt === "string" ? { plannedAt: body.plannedAt } : {}),
      }, user.email ?? user.id),
    );
    return json({ ok: true, status: result.post.status, copy: result.post.copy,
      plannedAt: result.post.plannedAt ?? null, unscheduled: result.unscheduled });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "The edit did not save." }, 409);
  }
}
