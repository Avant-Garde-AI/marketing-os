/** Session-authenticated review controls. A signed review link alone has no publish authority. */
import { NextRequest, NextResponse } from "next/server";
import { socialReviewOperator } from "../../../../../lib/social/review-operator";
import { runWithTenant } from "../../../../../lib/tenant-context";
import { loadGenerationCarousel } from "../../../../../lib/social/generation-carousel";
import { carouselManifestHash, carouselIntentSchema } from "../../../../../lib/social/generation-publishing";
import { socialRepo } from "../../../../../lib/social/repo";
import { parsePost, postPath } from "../../../../../lib/social/artifacts";
import { instagramIdentity } from "../../../../../lib/social/channels/instagram";
import { brokerTokenSource } from "../../../../../lib/social/channels";
import { proposeAction } from "../../../../../lib/actions/propose";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

const operator = socialReviewOperator;
const tenant = () => ({ shop: process.env.SHOPIFY_STORE_URL ?? "", githubRepo: process.env.GITHUB_REPO ?? null,
  storeSlug: (process.env.SHOPIFY_STORE_URL ?? "").replace(/\.myshopify\.com$/, "") });
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  if (!await operator()) return json({ error: "Sign in to publish or schedule." }, 401);
  const postId = req.nextUrl.searchParams.get("postId") ?? "";
  if (!ID.test(postId)) return json({ error: "Invalid post ID" }, 400);
  try {
    return await runWithTenant(tenant(), async () => {
      const manifest = await loadGenerationCarousel(socialRepo, postId);
      if (!manifest) return json({ error: "Carousel unavailable" }, 404);
      const raw = await socialRepo.readFile(postPath(postId));
      const post = raw ? parsePost(raw) : null;
      const account = await instagramIdentity(brokerTokenSource);
      return json({ account, status: post?.status ?? "asset_ready", platform: post?.platform ?? null,
        scheduledAt: post?.scheduledAt ?? null, attempt: post?.publishAttempt?.state ?? null,
        expectedManifestHash: carouselManifestHash(manifest) });
    });
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Publishing unavailable" }, 409); }
}

export async function POST(req: NextRequest) {
  // Cookies alone are not sufficient for a cross-site write.
  if (req.headers.get("origin") !== req.nextUrl.origin) return json({ error: "Same-origin request required" }, 403);
  const user = await operator();
  if (!user) return json({ error: "Sign in to publish or schedule." }, 401);
  const body = await req.json().catch(() => null);
  if (!body || !ID.test(body.postId ?? "")) return json({ error: "Invalid post ID" }, 400);
  try {
    return await runWithTenant(tenant(), async () => {
      const manifest = await loadGenerationCarousel(socialRepo, body.postId);
      if (!manifest || carouselManifestHash(manifest) !== body.expectedManifestHash)
        return json({ error: "Carousel changed. Reload and review the complete post." }, 409);
      if (body.operation === "propose") {
        if (!["publish", "schedule"].includes(body.mode)) return json({ error: "Choose Publish or Schedule" }, 400);
        const params = carouselIntentSchema.parse({ postId: body.postId, expectedManifestHash: body.expectedManifestHash,
          accountId: body.accountId, accountUsername: body.accountUsername,
          ...(body.mode === "schedule" ? { scheduledAt: body.scheduledAt } : {}) });
        const proposed = await proposeAction({ kind: `social.${body.mode}_carousel`, params });
        return json(proposed);
      }
      if (body.operation !== "decide" || typeof body.approve !== "boolean" || typeof body.proposalId !== "string")
        return json({ error: "Invalid review decision" }, 400);
      const base = process.env.MARKETING_OS_API_URL?.replace(/\/$/, "");
      const secret = process.env.ACTIONS_GATE_SECRET;
      if (!base || !secret) throw new Error("Approval gate unavailable");
      const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
      const pendingResponse = await fetch(`${base}/api/actions/review?shop=${encodeURIComponent(tenant().shop)}`, { headers, cache: "no-store" });
      if (!pendingResponse.ok) throw new Error("Could not verify pending approval");
      const pending = await pendingResponse.json();
      const proposal = pending.proposals?.find((p: any) => p.id === body.proposalId &&
        ["social.publish_carousel", "social.schedule_carousel"].includes(p.kind) &&
        p.params?.postId === body.postId && p.params?.expectedManifestHash === body.expectedManifestHash);
      if (!proposal) return json({ error: "Approval is stale or belongs to another post" }, 409);
      const response = await fetch(`${base}/api/actions/review`, { method: "POST", headers,
        body: JSON.stringify({ proposalId: body.proposalId, approve: body.approve, actor: `social-review:${user.id}` }) });
      const decision = await response.json();
      if (!response.ok) return json(decision, response.status);
      // The shared gate returns HTTP 200 for a recorded decision even when
      // execution fails. Surface its outcome, not a misleading success message.
      const ok = decision.status === "executed" || decision.status === "declined";
      return json({ ...decision, ok, summary: decision.message,
        ...(!ok ? { error: decision.message ?? "Publishing did not complete" } : {}) }, ok ? 200 : 409);
    });
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Publishing failed" }, 409); }
}
