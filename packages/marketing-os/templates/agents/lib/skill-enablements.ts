/**
 * mos_skill_enablements read/write (WS4-R4 / 05 H1.1).
 *
 * The per-tenant pack registry the hosted runtime's dynamic tool merge reads:
 * a pack's tools appear only when its row says enabled (AND its required
 * provider is connected — H1.2, enforced in the enable path). The console's
 * Skills page reads rows here and writes toggles/config through the
 * /api/skill-enablements route.
 *
 * Reads degrade to [] (no DB / unapplied migration); WRITES throw — silently
 * dropping an enable/disable would lie to the owner.
 */

import { getTenant } from "./tenant-context";
import { platformPool, safeQuery, tenantIdForShop } from "./platform-db";

export interface SkillEnablement {
  packId: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
  enabledBy: string | null;
  enabledAt: string | null;
}

interface Row {
  pack_id: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  enabled_by: string | null;
  enabled_at: Date | string | null;
}

/** The tenant's enablement rows; null means "no database" (distinct from
 * "database, no rows yet" = []). */
export async function listEnablements(): Promise<SkillEnablement[] | null> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid) return null;
  const rows = await safeQuery<Row>(
    "skill enablements",
    `SELECT pack_id, version, enabled, config, enabled_by, enabled_at
       FROM mos_skill_enablements
      WHERE tenant_id = $1
      ORDER BY pack_id`,
    [tid]
  );
  if (rows === null) return null;
  return rows.map((r) => ({
    packId: r.pack_id,
    version: r.version,
    enabled: r.enabled,
    config: r.config ?? {},
    enabledBy: r.enabled_by,
    enabledAt:
      r.enabled_at === null
        ? null
        : r.enabled_at instanceof Date
          ? r.enabled_at.toISOString()
          : String(r.enabled_at),
  }));
}

export interface UpsertEnablementInput {
  packId: string;
  version: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  actor?: string;
}

/** Upsert the enablement row: toggle, config, or both. Config merges over the
 * existing jsonb (a partial form save never wipes sibling keys). */
export async function upsertEnablement(input: UpsertEnablementInput): Promise<SkillEnablement> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  const p = platformPool();
  if (!p || !tid) {
    throw new Error(
      "Skill enablements need the platform database (SUPABASE_DATABASE_URL) and a linked tenant — nothing was saved."
    );
  }
  const r = await p.query(
    `INSERT INTO mos_skill_enablements (tenant_id, pack_id, version, enabled, config, enabled_by, enabled_at)
     VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5::jsonb, '{}'::jsonb),
             CASE WHEN $4 IS TRUE THEN $6 ELSE NULL END,
             CASE WHEN $4 IS TRUE THEN now() ELSE NULL END)
     ON CONFLICT (tenant_id, pack_id) DO UPDATE SET
       version    = EXCLUDED.version,
       enabled    = COALESCE($4, mos_skill_enablements.enabled),
       config     = CASE WHEN $5 IS NULL THEN mos_skill_enablements.config
                         ELSE mos_skill_enablements.config || $5::jsonb END,
       enabled_by = CASE WHEN $4 IS TRUE THEN $6
                         WHEN $4 IS FALSE THEN mos_skill_enablements.enabled_by
                         ELSE mos_skill_enablements.enabled_by END,
       enabled_at = CASE WHEN $4 IS TRUE THEN now() ELSE mos_skill_enablements.enabled_at END
     RETURNING pack_id, version, enabled, config, enabled_by, enabled_at`,
    [
      tid,
      input.packId,
      input.version,
      input.enabled ?? null,
      input.config ? JSON.stringify(input.config) : null,
      input.actor ?? "console",
    ]
  );
  const row = r.rows[0] as Row;
  return {
    packId: row.pack_id,
    version: row.version,
    enabled: row.enabled,
    config: row.config ?? {},
    enabledBy: row.enabled_by,
    enabledAt:
      row.enabled_at === null
        ? null
        : row.enabled_at instanceof Date
          ? row.enabled_at.toISOString()
          : String(row.enabled_at),
  };
}
