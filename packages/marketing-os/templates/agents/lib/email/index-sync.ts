/**
 * Artifact → index projection (spec 22 D1: files are truth, DB is the
 * rebuildable index). Maps an email/campaigns/{id}/campaign.md artifact to
 * its mos_email_campaigns row + mos_calendar_items projection entry.
 *
 * Called by the email cron's sweep (the index is rebuilt from files on every
 * pass — the doctrine's test, 05 H4.3) and usable by any write path that
 * wants the index fresh immediately.
 */

import { Pool } from "pg";
import { upsertCalendarItem } from "../calendar";
import type { EmailCampaign } from "./types";
import { campaignPath } from "./artifacts";

let _pool: Pool | null = null;
function pool(): Pool | null {
  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) return null;
  if (!_pool) _pool = new Pool({ connectionString: cs, max: 3 });
  return _pool;
}

/** Resolve platform Tenant.id from a shop domain (cached per process). */
const tenantIdCache = new Map<string, string | null>();
export async function tenantIdForShop(shop: string): Promise<string | null> {
  if (tenantIdCache.has(shop)) return tenantIdCache.get(shop)!;
  const p = pool();
  if (!p) return null;
  try {
    const r = await p.query(`SELECT id FROM "Tenant" WHERE shop = $1`, [shop]);
    const id = r.rows[0]?.id ?? null;
    tenantIdCache.set(shop, id);
    return id;
  } catch {
    return null;
  }
}

/** Month a campaign belongs to: its schedule when set, else its id prefix
 * (plan-created ids are `{YYYY-MM}-…`), else "unscheduled". */
export function campaignMonth(campaign: EmailCampaign): string {
  if (campaign.scheduledAt) return campaign.scheduledAt.slice(0, 7);
  const m = campaign.id.match(/^(\d{4}-(?:0[1-9]|1[0-2]))/);
  return m?.[1] ?? "unscheduled";
}

export async function syncCampaignIndex(
  shop: string,
  campaign: EmailCampaign,
  extras?: { sentAt?: string; readback?: Record<string, unknown> },
): Promise<void> {
  const p = pool();
  const tenantId = await tenantIdForShop(shop);
  if (!p || !tenantId) return; // degrade: files remain truth
  const month = campaignMonth(campaign);
  try {
    await p.query(
      `INSERT INTO mos_email_campaigns
         (id, tenant_id, calendar_month, archetype, audience_refs, subject, scheduled_at, status,
          skeleton_ref, klaviyo_template_id, klaviyo_campaign_id, klaviyo_message_id, sent_at, readback, repo_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         calendar_month = EXCLUDED.calendar_month,
         archetype = EXCLUDED.archetype,
         audience_refs = EXCLUDED.audience_refs,
         subject = EXCLUDED.subject,
         scheduled_at = EXCLUDED.scheduled_at,
         status = EXCLUDED.status,
         skeleton_ref = EXCLUDED.skeleton_ref,
         klaviyo_template_id = EXCLUDED.klaviyo_template_id,
         klaviyo_campaign_id = EXCLUDED.klaviyo_campaign_id,
         klaviyo_message_id = EXCLUDED.klaviyo_message_id,
         sent_at = COALESCE(EXCLUDED.sent_at, mos_email_campaigns.sent_at),
         readback = COALESCE(EXCLUDED.readback, mos_email_campaigns.readback),
         updated_at = now()`,
      [
        campaign.id,
        tenantId,
        month,
        campaign.archetype,
        JSON.stringify(campaign.audience.included),
        campaign.subject ?? null,
        campaign.scheduledAt ?? null,
        campaign.status,
        campaign.skeletonRef,
        campaign.klaviyo?.templateId ?? null,
        campaign.klaviyo?.campaignId ?? null,
        campaign.klaviyo?.messageId ?? null,
        extras?.sentAt ?? null,
        extras?.readback ? JSON.stringify(extras.readback) : null,
        campaignPath(campaign.id),
      ],
    );
  } catch (e) {
    console.error("[email-index] campaign upsert failed (files remain truth):", e instanceof Error ? e.message : e);
  }

  await upsertCalendarItem(
    {
      channel: "email",
      packId: "email-campaign",
      itemId: campaign.id,
      month,
      ...(campaign.scheduledAt ? { scheduledAt: campaign.scheduledAt } : {}),
      status: campaign.status,
      title: campaign.subject ?? campaign.id,
      intent: campaign.archetype,
    },
    tenantId,
  );
}
