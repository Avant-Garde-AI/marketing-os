/** Read-only planning/preview seam. All writes execute via /api/actions/execute. */
import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { runWithTenant } from "../../../../../lib/tenant-context";
import { instagramIdentity } from "../../../../../lib/social/channels/instagram";
import { brokerTokenSource } from "../../../../../lib/social/channels";
import { parsePost, postPath } from "../../../../../lib/social/artifacts";
import { socialRepo } from "../../../../../lib/social/repo";
import { getAction } from "../../../../../lib/actions/registry";
import {
  planSocialWindow,
  inspectSocialWindow,
} from "../../../../../lib/social/autopilot-production";
export const maxDuration = 300;
const allowed = new Set([
  "social.autopilot_prepare",
  "social.autopilot_realize",
  "social.autopilot_bind",
  "social.schedule_post",
  "social.cancel_post",
]);
export async function POST(req: NextRequest) {
  const secret = process.env.ACTIONS_GATE_SECRET,
    provided = req.headers.get("authorization") ?? "",
    expected = `Bearer ${secret}`;
  if (
    !secret ||
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  )
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body?.shop || !body.storeSlug)
    return NextResponse.json({ error: "Tenant required" }, { status: 400 });
  try {
    return await runWithTenant(
      {
        shop: body.shop,
        storeSlug: body.storeSlug,
        ...(body.githubRepo ? { githubRepo: body.githubRepo } : {}),
      },
      async () => {
        if (body.operation === "identity")
          return NextResponse.json({ account: await instagramIdentity(brokerTokenSource) });
        if (body.operation === "recipes") {
          const raw = await socialRepo.readFile("social/autopilot/recipes.json");
          if (!raw) throw Error("Store social recipes missing");
          return NextResponse.json({ recipeHash: createHash("sha256").update(raw).digest("hex") });
        }
        if (body.operation === "plan")
          return NextResponse.json(await planSocialWindow(body.params));
        if (body.operation === "inspect")
          return NextResponse.json({ production: await inspectSocialWindow(body.from) });
        if (!allowed.has(body.kind)) throw Error("Action is not a social production step");
        if (body.kind === "social.schedule_post") {
          const raw = await socialRepo.readFile(postPath(body.params?.postId ?? ""));
          const post = raw ? parsePost(raw) : null;
          if (
            !post ||
            !post.automation ||
            post.automation.grantId !== body.grantId ||
            post.automation.batchId !== body.batchId ||
            post.plannedAt !== body.params?.scheduledAt
          )
            throw Error("Scheduled post differs from the delegated batch");
        }
        const action = getAction(body.kind);
        if (!action) throw Error("Unknown action");
        const params = action.paramsSchema.parse(body.params);
        return NextResponse.json({
          kind: action.kind,
          title: action.title,
          risk: action.risk,
          scopes: action.scopes,
          params,
          preview: await action.preview(params as never),
        });
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Production preview unavailable" },
      { status: 409 }
    );
  }
}
