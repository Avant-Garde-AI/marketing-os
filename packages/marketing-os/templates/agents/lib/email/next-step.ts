/**
 * The next gate step for a campaign, from its lifecycle status alone.
 *
 * proposed → approve for drafting → drafted in Klaviyo → scheduled. Each step is
 * its own approval; this only names which one comes next, so a surface that
 * offers "send for approval" cannot offer the wrong card.
 */

export type GateStep =
  | { ok: true; kind: string; params: Record<string, unknown>; label: string }
  | { ok: false; reason: string };

export function nextGateStep(
  campaign: { id: string; status: string; scheduledAt: string | null },
  now: number = Date.now(),
): GateStep {
  switch (campaign.status) {
    case "proposed":
      return { ok: true, kind: "email.approve_campaign", params: { campaignId: campaign.id }, label: "Approve for drafting" };
    case "approved":
      return { ok: true, kind: "klaviyo.create_campaign_draft", params: { campaignId: campaign.id }, label: "Create Klaviyo draft" };
    case "drafted": {
      if (!campaign.scheduledAt) return { ok: false, reason: "No send time set" };
      const at = new Date(campaign.scheduledAt);
      if (Number.isNaN(at.getTime()) || at.getTime() <= now) return { ok: false, reason: "Send time has passed" };
      return {
        ok: true,
        kind: "klaviyo.schedule_campaign",
        params: { campaignId: campaign.id, sendAt: at.toISOString() },
        label: "Schedule the send",
      };
    }
    case "scheduled":
      return { ok: false, reason: "Already scheduled" };
    default:
      return { ok: false, reason: "Already sent" };
  }
}
