/**
 * Read-side helpers for the console's cross-channel Calendar (WS4-R2 /
 * 02-ARCHITECTURE §6 / 05 H4).
 *
 * The calendar reads ONLY the `mos_calendar_items` projection — one generic
 * index both packs (and any future channel) write through the shared
 * `upsertCalendarItem` helper. `channel` and `status` are pack-owned strings,
 * OPAQUE here: this module never interprets them, it just carries them to
 * chips. That is the H4.2 acceptance: a third channel renders with zero
 * calendar-component changes.
 *
 * Degrade-don't-throw (the lib/social/console-data.ts precedent): no DB, or
 * an unapplied migration, answers [] and the page renders its empty states.
 */

import { getTenant } from "../tenant-context";
import { safeQuery, tenantIdForShop } from "../platform-db";

/** The CalendarItem contract (02 §6) — mirrors mos_calendar_items. */
export interface CalendarItem {
  /** "social" | "email" | future — opaque to the calendar. */
  channel: string;
  packId: string;
  /** detail_ref into the owning pack (post id, campaign id, …). */
  itemId: string;
  /** YYYY-MM. */
  month: string;
  /** ISO datetime; null = planned-but-unscheduled (the backlog lane). */
  scheduledAt: string | null;
  /** Pack lifecycle string; the calendar renders chips, doesn't interpret. */
  status: string;
  title: string;
  intent: string;
  thumbnailUrl: string | null;
}

interface Row {
  channel: string;
  pack_id: string;
  item_id: string;
  month: string;
  scheduled_at: Date | string | null;
  status: string;
  title: string;
  intent: string;
  thumbnail_url: string | null;
}

function toItem(r: Row): CalendarItem {
  return {
    channel: r.channel,
    packId: r.pack_id,
    itemId: r.item_id,
    month: r.month,
    scheduledAt:
      r.scheduled_at === null
        ? null
        : r.scheduled_at instanceof Date
          ? r.scheduled_at.toISOString()
          : String(r.scheduled_at),
    status: r.status,
    title: r.title,
    intent: r.intent,
    thumbnailUrl: r.thumbnail_url,
  };
}

/** Every calendar item for a month (scheduled AND backlog), stable order. */
export async function listCalendarItems(month: string): Promise<CalendarItem[]> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid) return [];
  const rows = await safeQuery<Row>(
    `calendar items ${month}`,
    `SELECT channel, pack_id, item_id, month, scheduled_at, status, title, intent, thumbnail_url
       FROM mos_calendar_items
      WHERE tenant_id = $1 AND month = $2
      ORDER BY scheduled_at NULLS LAST, channel, item_id`,
    [tid, month]
  );
  return (rows ?? []).map(toItem);
}

/** Months that have items, newest first (["2026-08", "2026-07", …]) — feeds
 * the month nav's default and lets adjacent-month links know what exists. */
export async function listCalendarMonths(): Promise<string[]> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid) return [];
  const rows = await safeQuery<{ month: string }>(
    "calendar months",
    `SELECT DISTINCT month FROM mos_calendar_items WHERE tenant_id = $1 ORDER BY month DESC`,
    [tid]
  );
  return (rows ?? []).map((r) => r.month);
}
