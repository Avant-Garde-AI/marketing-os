/** Owner controls reuse the console user, exact-body signature and existing gate. */
import { NextRequest, NextResponse } from "next/server";
import { socialReviewOperator } from "../../../../lib/social/review-operator";
import { socialRepo } from "../../../../lib/social/repo";
import { runWithTenant } from "../../../../lib/tenant-context";
import { brokerHeaders, apiBase } from "../../../../lib/broker-client";
import {
  generationRunHeaders,
  runWithGenerationActor,
} from "../../../../lib/social/generation-authority";
import { socialAutopilotPolicySchema } from "../../../../lib/social/autopilot";
const json = (b: unknown, status = 200) =>
  NextResponse.json(b, { status, headers: { "Cache-Control": "no-store" } });
async function proxy(init?: RequestInit) {
  const r = await fetch(`${apiBase()}/api/broker/social-autopilot`, {
    ...init,
    headers: { ...brokerHeaders(), ...init?.headers },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  return json(await r.json(), r.status);
}
export async function GET() {
  if (!(await socialReviewOperator())) return json({ error: "Sign in to manage autopilot" }, 401);
  return proxy();
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin)
    return json({ error: "Same-origin request required" }, 403);
  const user = await socialReviewOperator();
  if (!user) return json({ error: "Sign in to manage autopilot" }, 401);
  const input = await req.json().catch(() => null);
  if (!input || !["enable", "pause", "resume", "hold", "tick"].includes(input.operation))
    return json({ error: "Unknown control" }, 400);
  const shop = process.env.SHOPIFY_STORE_URL ?? "";
  return runWithTenant(
    {
      shop,
      storeSlug: shop.replace(/\.myshopify\.com$/, ""),
      githubRepo: process.env.GITHUB_REPO ?? null,
    },
    async () => {
      let policy;
      if (input.operation === "enable") {
        const raw = await socialRepo.readFile("social/autopilot/policy.json");
        if (!raw) return json({ error: "Store social policy is missing" }, 409);
        policy = socialAutopilotPolicySchema.parse({ ...JSON.parse(raw), enabled: true });
      }
      const actor = { surface: "console" as const, subject: user.id },
        body = JSON.stringify({
          operation: input.operation,
          ...(policy ? { policy } : {}),
          ...(input.postId ? { postId: input.postId } : {}),
          actor,
        });
      return runWithGenerationActor(actor, () =>
        proxy({
          method: "POST",
          body,
          headers: { "Content-Type": "application/json", ...generationRunHeaders(body, shop) },
        })
      );
    }
  );
}
