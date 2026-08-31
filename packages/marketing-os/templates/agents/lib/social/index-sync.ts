/**
 * Artifact → index projection, the IMPURE half (spec 22 D1; spec 26 §2
 * ⟨BUILD⟩ 1). Mirrors lib/email/index-sync.ts.
 *
 * The pack owns the semantics (lib/social/projection.ts — month, title,
 * thumbnail, row shape, all pure and unit-tested upstream); this module owns
 * the plumbing: pool, tenant resolution, and the two writes —
 * `pack_social.posts` (pack-private, spec 26 D2) and `mos_calendar_items`
 * (the shared cross-channel view).
 *
 * WHY IT MUST BE CALLED AT THE AUTHORING WRITE (spec 26 §5, failure mode 2):
 * the email pack shipped an upsert that wrote the artifact and never synced.
 * Campaigns rendered perfectly at their preview URL and appeared nowhere in
 * the console or calendar — those surfaces read the projection, never the
 * artifact store — and nothing errored. The cron sweep is the BACKSTOP, not
 * the mechanism.
 *
 * DEGRADE LOUDLY (spec 26 §5, the unifying lesson). Every read path here
 * degrades rather than throws, which is right for resilience and catastrophic
 * for diagnosis: empty is indistinguishable from broken. So every degrade
 * logs with the `[social-index]` tag and its cause, and the return type
 * distinguishes "wrote it" from "couldn't reach the index" — a caller that
 * wants to surface index health can, instead of guessing from silence.
 *
 * A failing index must NEVER fail an authoring write: files are truth, and
 * losing the projection loses speed, not content.
 */

import { Pool } from "pg";
import { upsertCalendarItem } from "../calendar";
import { postCalendarProjection, postIndexRow } from "./projection";
import type { SocialPost } from "./types";

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

/** Public base URL the design-surface export route is served from — the
 * thumbnail's host. Same resolution as the design-surface tools. */
function publicUrl(): string {
  return (
    process.env.MOS_AGENTS_PUBLIC_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  ).replace(/\/$/, "");
}

/**
 * Resolve the platform `Tenant.id` from a shop domain (cached per process).
 *
 * Resolves BY SHOP deliberately (spec 26 §5, failure mode 3): a tenant id
 * carried on the request context is correct hosted and wrong self-hosted,
 * where it came from a different database's token verification. Trusting it
 * made writes succeed and reads return [] — data saved correctly and read
 * back empty. The shop is the one identifier that means the same thing in
 * both deployments.
 */
const tenantIdCache = new Map<string, string | null>();
export async function tenantIdForShop(shop: string): Promise<string | null> {
  if (tenantIdCache.has(shop)) return tenantIdCache.get(shop)!;
  const p = pool();
  if (!p) return null;
  try {
    const r = await p.query(`SELECT id FROM "Tenant" WHERE shop = $1`, [shop]);
    const id = (r.rows[0]?.id as string | undefined) ?? null;
    if (!id) {
      console.error(
        `[social-index] no Tenant row for shop "${shop}" — projection skipped (files remain truth). ` +
          `Self-hosted? seed Account + Tenant via templates/supabase/self-hosted-bootstrap.sql.`,
      );
    }
    tenantIdCache.set(shop, id);
    return id;
  } catch (e) {
    // NOT cached: a transient DB error must not pin this shop to "no tenant"
    // for the life of the process.
    console.error(`[social-index] tenant lookup failed for "${shop}":`, errMsg(e));
    return null;
  }
}

/** Distinguishes "indexed" from "could not reach the index" — never silence. */
export type SocialIndexOutcome =
  | { ok: true }
  | { ok: false; reason: "no-database" | "no-tenant" | "write-failed"; message: string };

/**
 * Write a post through to both indexes. Called at the authoring write and by
 * any lifecycle write that changes what the calendar shows.
 */
export async function syncPostIndex(shop: string, post: SocialPost): Promise<SocialIndexOutcome> {
  const p = pool();
  if (!p) {
    const message =
      "no SUPABASE_DATABASE_URL/DATABASE_URL — post saved to the repo but the console and calendar will not show it until an index rebuild";
    console.error(`[social-index] ${message}`);
    return { ok: false, reason: "no-database", message };
  }
  const tenantId = await tenantIdForShop(shop);
  if (!tenantId) {
    const message = `no Tenant row for shop "${shop}" — post saved to the repo but not indexed`;
    return { ok: false, reason: "no-tenant", message };
  }

  const row = postIndexRow(post);
  try {
    await p.query(
      `INSERT INTO pack_social.posts
         (tenant_id, id, channel, calendar_month, status, scheduled_at, target_link, copy,
          surface_file_id, surface_page_id, surface_revn, approval_hash, approval_at,
          platform_id, platform_permalink, published_at, failure, repo_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         channel = EXCLUDED.channel,
         calendar_month = EXCLUDED.calendar_month,
         status = EXCLUDED.status,
         scheduled_at = EXCLUDED.scheduled_at,
         target_link = EXCLUDED.target_link,
         copy = EXCLUDED.copy,
         surface_file_id = EXCLUDED.surface_file_id,
         surface_page_id = EXCLUDED.surface_page_id,
         surface_revn = EXCLUDED.surface_revn,
         approval_hash = EXCLUDED.approval_hash,
         approval_at = EXCLUDED.approval_at,
         -- Publish write-back is append-only: a later authoring write must not
         -- erase the record of what actually shipped.
         platform_id = COALESCE(EXCLUDED.platform_id, pack_social.posts.platform_id),
         platform_permalink = COALESCE(EXCLUDED.platform_permalink, pack_social.posts.platform_permalink),
         published_at = COALESCE(EXCLUDED.published_at, pack_social.posts.published_at),
         failure = EXCLUDED.failure,
         repo_path = EXCLUDED.repo_path,
         updated_at = now()`,
      [
        tenantId,
        row.id,
        row.channel,
        row.calendarMonth,
        row.status,
        row.scheduledAt,
        row.targetLink,
        row.copy,
        row.surfaceFileId,
        row.surfacePageId,
        row.surfaceRevn,
        row.approvalHash,
        row.approvalAt,
        row.platformId,
        row.platformPermalink,
        row.publishedAt,
        row.failure,
        row.repoPath,
      ],
    );
  } catch (e) {
    const message = errMsg(e);
    // A missing relation is the self-hosted-bootstrap gap (failure mode 4) and
    // deserves to say so rather than scroll past as a generic SQL error.
    const hint = /relation .*pack_social.* does not exist/i.test(message)
      ? " — pack_social is not installed; run templates/supabase/migrations/009_pack_social.sql (or the bootstrap file)"
      : "";
    console.error(`[social-index] pack_social.posts upsert failed (files remain truth): ${message}${hint}`);
    return { ok: false, reason: "write-failed", message: message + hint };
  }

  // The shared cross-channel view. upsertCalendarItem swallows + logs its own
  // failures, so a calendar problem cannot fail the pack index write above.
  await upsertCalendarItem(postCalendarProjection(post, publicUrl()), tenantId);
  return { ok: true };
}
