/**
 * "Take this campaign to scheduled" — the console's one-click path.
 *
 * The lifecycle is three governed steps (approve → Klaviyo draft → schedule),
 * and each used to need someone to ask for its card and then approve it. An
 * owner who had already decided to send met that as three stalls per campaign:
 * a whole month sat at "approved" for a week because nothing asked for step 2.
 *
 * This does not shorten the gate, it walks it. Every step is still a proposal
 * the platform stores, a nonce it claims, and an audit row — proposed and then
 * approved here, back to back, in the name of the signed-in operator who
 * pressed the button. What is removed is the waiting between steps, not any
 * of the checks inside them: each Action's preview() still runs and still
 * refuses (a missing discount code, a past send time, an unknown audience).
 *
 * Behind the console's auth middleware deliberately. A review link must never
 * reach this — it is the route that sends.
 */

import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../lib/tenant-context";
import { emailRepo } from "../../../../lib/email/repo";
import { campaignPath, parseCampaign } from "../../../../lib/email/artifacts";
import { nextGateStep } from "../../../../lib/email/next-step";
import { proposeAction } from "../../../../lib/actions/propose";
import { approveAtGate, proposeAndApprove } from "../../../../lib/actions/approve";
import { socialReviewOperator } from "../../../../lib/social/review-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The draft step re-hosts every image onto Klaviyo before it returns.
export const maxDuration = 300;

const ID_RE = /^[A-Za-z0-9._-]+$/;
/** Klaviyo needs lead time, and a send "in the past by the time it lands" is refused downstream anyway. */
const MIN_LEAD_MS = 10 * 60 * 1000;

const AFTER: Record<string, string> = {
  "email.approve_campaign": "approved",
  "klaviyo.create_campaign_draft": "drafted",
  "klaviyo.schedule_campaign": "scheduled",
};

type StepResult = { label: string; ok: boolean; message: string };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    campaignId?: unknown;
    sendAt?: unknown;
    through?: unknown;
  } | null;
  const campaignId = typeof body?.campaignId === "string" && ID_RE.test(body.campaignId) ? body.campaignId : null;
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  const through = body?.through !== false;

  let sendAt: string | null = null;
  if (body?.sendAt !== undefined && body.sendAt !== null) {
    const at = typeof body.sendAt === "string" ? new Date(body.sendAt) : null;
    if (!at || Number.isNaN(at.getTime())) return NextResponse.json({ error: "sendAt must be an ISO datetime" }, { status: 400 });
    sendAt = at.toISOString();
  }

  const shop = process.env.SHOPIFY_STORE_URL ?? "";
  const operator = await socialReviewOperator();
  const actor = operator?.email ? `console:${operator.email}` : "dashboard";

  return runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") }, async () => {
    const raw = await emailRepo.readFile(campaignPath(campaignId));
    if (raw === null) return NextResponse.json({ error: `campaign "${campaignId}" not found` }, { status: 404 });
    const campaign = parseCampaign(raw);

    // Settle the send time BEFORE touching anything. Approving and drafting a
    // campaign only to stall at the last step is the failure this route exists
    // to remove.
    const when = sendAt ?? campaign.scheduledAt ?? null;
    if (through && campaign.status !== "scheduled") {
      const at = when ? new Date(when).getTime() : NaN;
      if (Number.isNaN(at) || at < Date.now() + MIN_LEAD_MS) {
        return NextResponse.json(
          { error: when ? "Its send time has passed. Pick a new one." : "No send time set. Pick one.", needsSendAt: true },
          { status: 409 },
        );
      }
    }

    // Tracked locally: the store repo is written by the executor, and reading
    // it straight back can return the previous status.
    let status: string = campaign.status;
    const steps: StepResult[] = [];
    let redrafted = false;
    for (let i = 0; i < 3; i++) {
      const step = nextGateStep({ id: campaignId, status, scheduledAt: when });
      if (!step.ok) break;
      try {
        let proposed;
        try {
          proposed = await proposeAction({ kind: step.kind, params: step.params });
        } catch (e) {
          // The email was edited after it went to Klaviyo. Scheduling refuses a
          // stale draft, correctly; the fix is mechanical, so do it rather than
          // hand the owner an instruction. One retry only.
          if (step.kind !== "klaviyo.schedule_campaign" || redrafted || !/changed since it was drafted/i.test(e instanceof Error ? e.message : "")) throw e;
          redrafted = true;
          await proposeAndApprove({ kind: "klaviyo.create_campaign_draft", params: { campaignId } }, actor);
          steps.push({ label: "Update the Klaviyo draft", ok: true, message: "Pushed the latest edits to Klaviyo" });
          proposed = await proposeAction({ kind: step.kind, params: step.params });
        }
        const decision = await approveAtGate(proposed.proposalId, actor);
        if (decision.status !== "executed") {
          steps.push({ label: step.label, ok: false, message: decision.message || decision.status });
          return NextResponse.json({ ok: false, status, steps }, { status: 409 });
        }
        steps.push({ label: step.label, ok: true, message: proposed.summary });
        status = AFTER[step.kind] ?? status;
      } catch (e) {
        steps.push({ label: step.label, ok: false, message: e instanceof Error ? e.message : String(e) });
        return NextResponse.json({ ok: false, status, steps }, { status: 409 });
      }
      if (!through) break;
    }
    return NextResponse.json({ ok: true, status, steps, ...(status === "scheduled" && when ? { sendAt: when } : {}) });
  });
}
