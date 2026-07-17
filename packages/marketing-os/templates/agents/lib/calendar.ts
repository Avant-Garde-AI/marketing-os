/**
 * The cross-channel calendar projection writer (02 §6 / 05 H4.1).
 *
 * ONE shared helper both packs (and every future channel) write through;
 * the console calendar reads ONLY mos_calendar_items and renders channels it
 * has never heard of — `channel`, `status`, `itemId` are pack-owned strings,
 * opaque to the calendar (05 H4.2's acceptance: a synthetic third channel
 * renders with zero component changes).
 *
 * Files stay per-pack truth (email/calendar/, social/calendar/); this
 * projection is rebuildable from them (the rebuild script exercises that
 * doctrine — 05 H4.3). Degrade-don't-throw mirrors lib/social/repo.ts: with
 * no database configured the projection is silently skipped — the artifact
 * write (truth) has already happened.
 */

import { Pool } from "pg";
import { getTenant } from "./tenant-context";

export interface CalendarItem {
  /** "social" | "email" | future — opaque to the calendar. */
  channel: string;
  packId: string;
  /** detail_ref into the owning pack (post id | campaign id). */
  itemId: string;
  /** YYYY-MM. */
  month: string;
  /** ISO; absent = planned-but-unscheduled (renders in the backlog lane). */
  scheduledAt?: string;
  /** Pack lifecycle string; the calendar renders chips, never interprets. */
  status: string;
  title: string;
  intent: string;
  thumbnailUrl?: string;
}

let _pool: Pool | null = null;

function pool(): Pool | null {
  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) return null;
  if (!_pool) _pool = new Pool({ connectionString: cs, max: 3 });
  return _pool;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Tenant id resolution: mos_calendar_items keys on the platform Tenant.id;
 * the pooled runtime's context carries it when the request came through a
 * platform-resolved seam, else we key on shop via the Tenant table lookup the
 * caller performed. For v1 the projection accepts either and stores what it
 * was given — the rebuild script normalizes. */
export async function upsertCalendarItem(item: CalendarItem, tenantId?: string): Promise<void> {
  const p = pool();
  if (!p) return; // degrade: files are truth; the index catches up on rebuild
  const tid = tenantId ?? getTenant().tenantId;
  if (!tid) {
    console.error("[calendar] no tenant id in scope — projection skipped (files remain truth)");
    return;
  }
  try {
    await p.query(
      `INSERT INTO mos_calendar_items
         (tenant_id, channel, item_id, pack_id, month, scheduled_at, status, title, intent, thumbnail_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, channel, item_id) DO UPDATE SET
         pack_id = EXCLUDED.pack_id,
         month = EXCLUDED.month,
         scheduled_at = EXCLUDED.scheduled_at,
         status = EXCLUDED.status,
         title = EXCLUDED.title,
         intent = EXCLUDED.intent,
         thumbnail_url = EXCLUDED.thumbnail_url,
         updated_at = now()`,
      [
        tid,
        item.channel,
        item.itemId,
        item.packId,
        item.month,
        item.scheduledAt ?? null,
        item.status,
        item.title,
        item.intent,
        item.thumbnailUrl ?? null,
      ],
    );
  } catch (e) {
    console.error("[calendar] projection upsert failed (files remain truth):", errMsg(e));
  }
}

/** Remove an item from the projection (declined/purged artifacts). */
export async function deleteCalendarItem(channel: string, itemId: string, tenantId?: string): Promise<void> {
  const p = pool();
  if (!p) return;
  const tid = tenantId ?? getTenant().tenantId;
  if (!tid) return;
  try {
    await p.query(
      `DELETE FROM mos_calendar_items WHERE tenant_id = $1 AND channel = $2 AND item_id = $3`,
      [tid, channel, itemId],
    );
  } catch (e) {
    console.error("[calendar] projection delete failed:", errMsg(e));
  }
}
