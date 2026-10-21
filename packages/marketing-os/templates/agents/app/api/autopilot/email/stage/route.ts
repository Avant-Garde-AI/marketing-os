/**
 * Email autopilot stager (docs/plans/EMAIL-AUTOPILOT.md) — called ONLY by the
 * platform's autopilot cron, with the granted policy and the window it owns.
 *
 * Auth: ACTIONS_GATE_SECRET, the same service seam as /api/actions/execute.
 * The model never holds it and no tool calls this route. Everything raised
 * here goes back through the gate with `delegation`, where the platform
 * re-checks the grant; this route cannot approve anything by itself.
 */
import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../../lib/tenant-context";
import { emailRepo } from "../../../../../lib/email/repo";
import { emailAutopilotPolicySchema, stageWindow } from "../../../../../lib/email/autopilot";
// Registrations are import side effects; this route's bundle must see them.
import "../../../../../lib/email/register-actions";

export const maxDuration = 300;

/** Leave headroom under the platform's 240s wait for the response. */
const BUDGET_MS = 180_000;

interface StageBody {
  shop?: string;
  storeSlug?: string;
  grantId?: string;
  batchId?: string;
  policy?: unknown;
  window?: { from?: string; through?: string; slots?: string[] };
}

export async function POST(req: NextRequest) {
  const secret = process.env.ACTIONS_GATE_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as StageBody | null;
  const window = body?.window;
  if (!body?.shop || !body.storeSlug || !body.grantId || !body.batchId || !window?.from || !window.through || !window.slots) {
    return NextResponse.json({ error: "shop, storeSlug, grantId, batchId and window required" }, { status: 400 });
  }
  const policy = emailAutopilotPolicySchema.safeParse(body.policy);
  if (!policy.success) return NextResponse.json({ error: `invalid policy: ${policy.error.message}` }, { status: 400 });

  try {
    const result = await runWithTenant({ shop: body.shop, storeSlug: body.storeSlug }, () =>
      stageWindow({
        repo: emailRepo,
        shop: body.shop!,
        grantId: body.grantId!,
        batchId: body.batchId!,
        policy: policy.data,
        window: { from: window.from!, through: window.through!, slots: window.slots! },
        deadline: Date.now() + BUDGET_MS,
      }),
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
