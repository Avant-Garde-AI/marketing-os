/** Verified merchant session -> existing gate. Review tokens do not grant scheduling authority. */
import { NextRequest, NextResponse } from "next/server";
import { socialReviewOperator } from "../../../../lib/social/review-operator";
import { runWithTenant } from "../../../../lib/tenant-context";
import { pendingScheduleBatch, scheduleBatchSchema } from "../../../../lib/social/schedule-batch";
import { hashPreview } from "../../../../lib/actions/hash";
import { proposeAction } from "../../../../lib/actions/propose";
export const runtime = "nodejs";
export const maxDuration = 300;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return json({ error: "Same-origin request required" }, 403);
  const user = await socialReviewOperator();
  if (!user) return json({ error: "Sign in to approve schedules." }, 401);
  const body = await req.json().catch(() => null);
  try {
    const params = scheduleBatchSchema.parse(body?.params);
    const shop = process.env.SHOPIFY_STORE_URL ?? "";
    return await runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, ""), githubRepo: process.env.GITHUB_REPO ?? null }, async () => {
      if (body.operation === "propose") {
        const pending = await pendingScheduleBatch(params);
        return json(pending ?? await proposeAction({ kind: "social.schedule_batch", params }));
      }
      if (body.operation !== "decide" || typeof body.approve !== "boolean" || typeof body.proposalId !== "string")
        return json({ error: "Invalid schedule decision" }, 400);
      const base = process.env.MARKETING_OS_API_URL?.replace(/\/$/, ""), secret = process.env.ACTIONS_GATE_SECRET;
      if (!base || !secret) throw new Error("Approval gate unavailable");
      const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
      const response = await fetch(`${base}/api/actions/review?shop=${encodeURIComponent(shop)}`, { headers, cache: "no-store" });
      if (!response.ok) throw new Error("Could not verify pending schedule approval");
      const pending = await response.json();
      const proposal = pending.proposals?.find((p: any) => p.id === body.proposalId &&
        p.kind === "social.schedule_batch" && hashPreview(p.params) === hashPreview(params));
      if (!proposal) return json({ error: "Schedule approval is stale or belongs to different posts" }, 409);
      const decisionResponse = await fetch(`${base}/api/actions/review`, { method: "POST", headers,
        body: JSON.stringify({ proposalId: body.proposalId, approve: body.approve, actor: `social-review:${user.id}` }) });
      const decision = await decisionResponse.json();
      const ok = decisionResponse.ok && ["executed", "declined"].includes(decision.status);
      return json({ ...decision, ok, summary: decision.message, ...(!ok ? { error: decision.message ?? "Scheduling did not complete" } : {}) }, ok ? 200 : 409);
    });
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Scheduling unavailable" }, 409); }
}
