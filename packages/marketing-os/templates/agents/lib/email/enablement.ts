/**
 * Pack enablement gate (WS3-R7 / 05 H1 minimal version): email tools and
 * Actions exist for a tenant only when
 *   (a) mos_skill_enablements has {pack_id: 'email-campaign', enabled: true}
 *   (b) a live klaviyo provider_connections row exists (H1.2)
 *
 * Hosted mode reads the platform DB per request (TTL-cached per shop — the
 * spec 18 external-MCP pattern). Client-owned deployments are env-driven
 * (EMAIL_PACK_ENABLED=1) since the deployment IS the tenant and there is no
 * enablements table locally.
 */

import { Pool } from "pg";
import { HOSTED, getTenant } from "../tenant-context";

let _pool: Pool | null = null;
function pool(): Pool | null {
  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) return null;
  if (!_pool) _pool = new Pool({ connectionString: cs, max: 2 });
  return _pool;
}

export interface EmailEnablement {
  enabled: boolean;
  /** H1.3 wiring-shaped config from the enablement row. */
  config: { conversion_metric_id?: string; default_from_email?: string; default_from_label?: string };
  reason?: string;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: EmailEnablement }>();

export async function getEmailEnablement(): Promise<EmailEnablement> {
  if (!HOSTED) {
    return process.env.EMAIL_PACK_ENABLED === "1"
      ? { enabled: true, config: {} }
      : { enabled: false, config: {}, reason: "EMAIL_PACK_ENABLED is not set on this deployment" };
  }
  const shop = getTenant().shop;
  const hit = cache.get(shop);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const p = pool();
  if (!p) {
    const value = { enabled: false, config: {}, reason: "no platform database configured" };
    cache.set(shop, { at: Date.now(), value });
    return value;
  }
  try {
    const r = await p.query(
      `SELECT e.enabled, e.config,
              EXISTS (
                SELECT 1 FROM provider_connections pc
                WHERE pc.tenant_id = t.id AND pc.provider = 'klaviyo' AND pc.status = 'active'
              ) AS klaviyo_connected
       FROM "Tenant" t
       LEFT JOIN mos_skill_enablements e ON e.tenant_id = t.id AND e.pack_id = 'email-campaign'
       WHERE t.shop = $1`,
      [shop],
    );
    const row = r.rows[0];
    let value: EmailEnablement;
    if (!row) value = { enabled: false, config: {}, reason: "unknown tenant" };
    else if (!row.enabled) value = { enabled: false, config: {}, reason: "email-campaign pack not enabled" };
    else if (!row.klaviyo_connected)
      value = { enabled: false, config: {}, reason: "Klaviyo is not connected (H1.2 — connect it in settings)" };
    else value = { enabled: true, config: row.config ?? {} };
    cache.set(shop, { at: Date.now(), value });
    return value;
  } catch (e) {
    console.error("[email-enablement] query failed (failing closed):", e instanceof Error ? e.message : e);
    return { enabled: false, config: {}, reason: "enablement lookup failed" };
  }
}
