/**
 * Action execute dispatch (spec 20 A0/A1, WS3-R1) — called ONLY by the
 * platform gate (marketing-os-app decideAction) after a human approval
 * claimed the proposal's nonce.
 *
 * Auth: ACTIONS_GATE_SECRET — a service secret shared with the gate. The
 * agent runtime's model NEVER holds this value; no Mastra tool calls this
 * route. That is the structural enforcement of spec 20 invariant 2 on this
 * side of the seam (the gate enforces nonce single-use on its side).
 *
 * Idempotency: the gate dispatches an approval exactly once (atomic nonce
 * claim); a network retry after failure re-enters execute(), so every
 * registered action's execute() must be resumable (e.g. the Klaviyo draft
 * action records each created id on campaign.md and skips completed steps).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAction } from "../../../../lib/actions/registry";
import { runWithTenant } from "../../../../lib/tenant-context";
// Pack registrations are import side effects, and THIS route's module graph is
// what the gate's dispatch sees — packs must register here explicitly (Next
// bundles per route; a registration that only rides the chat/tools bundle is
// invisible to this one).
import "../../../../lib/social/register-actions";
import "../../../../lib/email/register-actions";

export const maxDuration = 120;

interface ExecuteBody {
  proposalId?: string;
  tenantId?: string;
  shop?: string;
  storeSlug?: string;
  kind?: string;
  params?: unknown;
  previewHash?: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.ACTIONS_GATE_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as ExecuteBody | null;
  if (!body?.kind || !body.proposalId) {
    return NextResponse.json({ error: "kind and proposalId required" }, { status: 400 });
  }
  if (!body.shop || !body.storeSlug) {
    return NextResponse.json({ error: "shop and storeSlug required" }, { status: 400 });
  }

  const action = getAction(body.kind);
  if (!action) {
    return NextResponse.json({ error: `no action registered for kind "${body.kind}"` }, { status: 404 });
  }

  const parsed = action.paramsSchema.safeParse(body.params);
  if (!parsed.success) {
    return NextResponse.json({ error: `invalid params: ${parsed.error.message}` }, { status: 400 });
  }

  try {
    const result = await runWithTenant(
      {
        ...(body.tenantId ? { tenantId: body.tenantId } : {}),
        shop: body.shop,
        storeSlug: body.storeSlug,
      },
      async () => {
        // Preview-hash recheck (defense in depth): the gate already refuses
        // stale nonces; recomputing here catches a gate/runtime version skew
        // where preview material changed shape.
        const preview = await action.preview(parsed.data as never);
        if (body.previewHash && preview.previewHash !== body.previewHash) {
          throw new Error(
            "preview hash mismatch — the content changed since approval; re-propose the action",
          );
        }
        return action.execute(parsed.data as never);
      },
    );
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message, summary: message }, { status: 500 });
  }
}
