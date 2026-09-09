/**
 * /api/cron/email (WS3-R6, 02 §5) — reconcile + readback. Klaviyo EXECUTES
 * scheduled sends itself (the schedule lives in Klaviyo once the high-risk
 * Action ran); unlike a publish cron this one never sends — it verifies:
 *
 *  1. INDEX SYNC — rebuild mos_email_campaigns + mos_calendar_items from the
 *     campaign artifacts (files are truth; the index is a projection).
 *  2. SEND WATCH — for `scheduled` campaigns: confirm the Klaviyo campaign
 *     still exists with the approved send time; an out-of-band change (someone
 *     edited in Klaviyo's UI) is flagged loudly — the approval nonce's
 *     premise broke. When Klaviyo reports the send happened, mark `sent`.
 *  3. READBACK SWEEP — `sent` campaigns past the maturation window pull
 *     campaign-values (conversion metric from the broker's connection
 *     context), write the rollup, mark `measured`.
 *
 * Idempotent by construction: every step converges on observed state;
 * double-firing re-observes and rewrites the same values. Self-limiting via
 * the shared cron frame (05 H7). Weekly/monthly ritual cards ride this cron
 * once the Slack card seam lands (TODO H7 — the queue data is already in
 * mos_calendar_items).
 */

import { NextRequest } from "next/server";
import { Pool } from "pg";
import { cronGate, cronSweep } from "../../../../lib/cron-frame";
import { runWithTenant } from "../../../../lib/tenant-context";
import { emailRepo } from "../../../../lib/email/repo";
import { campaignPath, parseCampaign, serializeCampaign } from "../../../../lib/email/artifacts";
import { createKlaviyoClient } from "../../../../lib/email/klaviyo-client";
import { syncCampaignIndex } from "../../../../lib/email/index-sync";
import { getBrokerToken } from "../../../../lib/broker-client";
import type { EmailCampaign } from "../../../../lib/email/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hours after send before the FIRST readback.
 *
 * This was 72, chosen when a read happened once and froze. Now that the sweep
 * re-reads until the attribution window closes, an early number is corrected
 * rather than kept, so the cost of reading sooner is gone and the benefit is
 * real: nobody wants to wait three days to learn how a send did. Opens and
 * clicks are largely settled inside a day; revenue keeps accruing, and the
 * refresh below is what catches it.
 */
const MATURATION_HOURS = 24;
/** Klaviyo's conversion window here is 14 days, so the numbers move until then. */
const ATTRIBUTION_WINDOW_DAYS = 14;
const SHOPS_PER_FIRING = 3;
const CAMPAIGNS_PER_SHOP = 10;

let _pool: Pool | null = null;
function pool(): Pool | null {
  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) return null;
  if (!_pool) _pool = new Pool({ connectionString: cs, max: 2 });
  return _pool;
}

async function shopsWithEmailArtifacts(): Promise<string[]> {
  const p = pool();
  if (!p) return [];
  const r = await p.query(
    `SELECT DISTINCT shop FROM mos_email_artifacts WHERE path LIKE 'email/campaigns/%' ORDER BY shop`,
  );
  return r.rows.map((row: { shop: string }) => row.shop);
}

interface CampaignSweepOutcome {
  id: string;
  action: string;
}

async function sweepShop(shop: string): Promise<CampaignSweepOutcome[]> {
  return runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") }, async () => {
    const outcomes: CampaignSweepOutcome[] = [];
    const paths = (await emailRepo.list("email/campaigns/")).filter((p) => p.endsWith("/campaign.md"));
    const klaviyo = createKlaviyoClient();

    for (const path of paths.slice(0, CAMPAIGNS_PER_SHOP)) {
      const raw = await emailRepo.readFile(path);
      if (raw === null) continue;
      let campaign: EmailCampaign;
      try {
        campaign = parseCampaign(raw);
      } catch (e) {
        outcomes.push({ id: path, action: `unparseable: ${e instanceof Error ? e.message : e}` });
        continue;
      }

      let action = "indexed";

      // 2 — send watch
      if (campaign.status === "scheduled" && campaign.klaviyo?.campaignId) {
        try {
          const live = await klaviyo.getCampaignStatus(campaign.klaviyo.campaignId);
          const liveStatus = live.status.toLowerCase();
          if (["sent", "complete", "completed"].some((s) => liveStatus.includes(s))) {
            const sent: EmailCampaign = { ...campaign, status: "sent" };
            await emailRepo.writeFile(campaignPath(campaign.id), serializeCampaign(sent));
            campaign = sent;
            action = "marked-sent";
          } else if (
            live.scheduledAt &&
            campaign.scheduledAt &&
            live.scheduledAt !== campaign.scheduledAt
          ) {
            // Out-of-band change: what was approved is no longer what will
            // send. Flag loudly; the schedule Action must be re-proposed.
            action = `OUT-OF-BAND: klaviyo says ${live.scheduledAt}, approved ${campaign.scheduledAt}`;
            console.error(`[cron-email] ${shop}/${campaign.id} ${action}`);
          } else if (["cancelled", "draft"].some((s) => liveStatus.includes(s))) {
            action = `OUT-OF-BAND: klaviyo status "${live.status}" for a scheduled campaign`;
            console.error(`[cron-email] ${shop}/${campaign.id} ${action}`);
          }
        } catch (e) {
          action = `send-watch error: ${e instanceof Error ? e.message : e}`;
        }
      }

      // 3 — readback sweep
      let extras: { sentAt?: string; readback?: Record<string, unknown> } | undefined;
      if (
        (campaign.status === "sent" || campaign.status === "measured") &&
        campaign.klaviyo?.campaignId &&
        campaign.scheduledAt
      ) {
        const sinceSend = Date.now() - Date.parse(campaign.scheduledAt);
        const matured = sinceSend > MATURATION_HOURS * 60 * 60 * 1000;
        // A first read at 72h freezes a number that is still moving: the
        // conversion window this very request asks for is 14 days wide, so
        // attributed orders keep landing after a campaign is marked `measured`.
        // Keep re-reading until that window closes, then stop.
        const stillAccruing = sinceSend < ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        if (matured && (campaign.status === "sent" || stillAccruing)) {
          try {
            const broker = await getBrokerToken("klaviyo", "email");
            const metricId = (broker.context as { conversion_metric_id?: string }).conversion_metric_id;
            if (metricId) {
              const rows = await klaviyo.campaignValuesReport({
                campaignIds: [campaign.klaviyo.campaignId],
                timeframe: {
                  start: campaign.scheduledAt,
                  end: new Date(Date.parse(campaign.scheduledAt) + 14 * 24 * 3600 * 1000).toISOString(),
                },
                conversionMetricId: metricId,
              });
              const row = rows[0];
              if (row) {
                extras = {
                  sentAt: campaign.scheduledAt,
                  readback: {
                    ...row,
                    conversionMetricId: metricId,
                    attributionBasis: "klaviyo campaign-values-report, by send date",
                  },
                };
                if (campaign.status === "sent") {
                  const measured: EmailCampaign = { ...campaign, status: "measured" };
                  await emailRepo.writeFile(campaignPath(campaign.id), serializeCampaign(measured));
                  campaign = measured;
                  action = "measured";
                } else {
                  // Already measured — the artifact does not change, only the
                  // numbers the index carries.
                  action = "readback refreshed";
                }
              }
            } else {
              action = "readback skipped: no conversion_metric_id on the connection";
            }
          } catch (e) {
            action = `readback error: ${e instanceof Error ? e.message : e}`;
          }
        }
      }

      // 1 — index sync (always; the projection converges on file truth)
      await syncCampaignIndex(shop, campaign, extras);
      outcomes.push({ id: campaign.id, action });
    }
    return outcomes;
  });
}

export async function GET(req: NextRequest) {
  const denied = cronGate(req);
  if (denied) return denied;

  const shops = await shopsWithEmailArtifacts();
  const report = await cronSweep(
    "cron-email",
    shops,
    SHOPS_PER_FIRING,
    (shop) => shop,
    async (shop) => {
      const outcomes = await sweepShop(shop);
      const flagged = outcomes.filter((o) => o.action.startsWith("OUT-OF-BAND"));
      return `${outcomes.length} campaign(s)${flagged.length ? `, ${flagged.length} FLAGGED` : ""}: ${outcomes
        .map((o) => `${o.id}=${o.action}`)
        .join("; ")}`;
    },
  );
  return Response.json(report);
}
