/**
 * Edit a campaign's subject, preview text or send time in place.
 *
 * Behind the console's auth middleware. A scheduled email is locked while
 * Klaviyo holds its send, so editing one first cancels that send through the
 * gate, in the operator's name — the same thing they would otherwise do by
 * hand before being allowed to fix a typo. It comes back as "In Klaviyo, not
 * scheduled", and one click re-drafts and reschedules what is on screen.
 */
import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../lib/tenant-context";
import { emailRepo } from "../../../../lib/email/repo";
import { campaignPath, parseCampaign } from "../../../../lib/email/artifacts";
import { ownerEditCampaign } from "../../../../lib/email/owner-edit";
import { proposeAndApprove } from "../../../../lib/actions/approve";
import { socialReviewOperator } from "../../../../lib/social/review-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ID_RE = /^[A-Za-z0-9._-]+$/;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const campaignId = typeof body?.campaignId === "string" && ID_RE.test(body.campaignId) ? body.campaignId : null;
  if (!campaignId) return json({ error: "campaignId required" }, 400);
  const edit = {
    ...(typeof body!.subject === "string" ? { subject: body!.subject } : {}),
    ...(typeof body!.previewText === "string" ? { previewText: body!.previewText } : {}),
    ...(typeof body!.scheduledAt === "string" ? { scheduledAt: body!.scheduledAt } : {}),
  };
  if (Object.keys(edit).length === 0) return json({ error: "Nothing to change" }, 400);

  const shop = process.env.SHOPIFY_STORE_URL ?? "";
  const operator = await socialReviewOperator();
  const actor = operator?.email ? `console:${operator.email}` : "dashboard";

  return runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") }, async () => {
    try {
      const raw = await emailRepo.readFile(campaignPath(campaignId));
      if (raw === null) return json({ error: "Campaign not found" }, 404);
      let unscheduled = false;
      if (parseCampaign(raw).status === "scheduled") {
        await proposeAndApprove({ kind: "klaviyo.cancel_send", params: { campaignId, revertToDraft: true } }, actor);
        unscheduled = true;
      }
      const campaign = await ownerEditCampaign(campaignId, edit, actor);
      return json({ ok: true, status: campaign.status, subject: campaign.subject ?? null,
        previewText: campaign.previewText ?? null, scheduledAt: campaign.scheduledAt ?? null, unscheduled });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "The edit did not save." }, 409);
    }
  });
}
