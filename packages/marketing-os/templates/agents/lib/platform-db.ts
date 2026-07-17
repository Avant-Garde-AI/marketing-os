/**
 * Read-side access to the platform's `mos_*` projection tables (WS4 console
 * surfaces). The console reads the SAME database the hosted runtime writes
 * (SUPABASE_DATABASE_URL / DATABASE_URL, connecting as owner — the mos_*
 * tables carry RLS with authenticated/anon revoked, per the 003/004/005/007
 * governance, so reads go through the server-side connection string, never
 * the browser Supabase client).
 *
 * Degrade-don't-throw (the lib/social/repo.ts precedent): with no database
 * configured — or with the platform tables not yet migrated — every helper
 * answers "nothing here yet" (null / []) so pages render their editorial
 * empty states instead of crashing.
 */

import { Pool } from "pg";

let _pool: Pool | null = null;

/** Shared small pool; null when no database is configured. */
export function platformPool(): Pool | null {
  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) return null;
  if (!_pool) _pool = new Pool({ connectionString: cs, max: 3 });
  return _pool;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run a query, degrading to null on any failure (missing table included). */
export async function safeQuery<Row>(
  label: string,
  text: string,
  values: unknown[]
): Promise<Row[] | null> {
  const p = platformPool();
  if (!p) return null;
  try {
    const r = await p.query(text, values);
    return r.rows as Row[];
  } catch (e) {
    console.error(`[platform-db] ${label} failed (degrading to empty):`, errMsg(e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tenant id resolution
// ---------------------------------------------------------------------------
// The mos_* tables key on "Tenant"(id) (the platform's tenant uuid), while
// the console's request context carries the myshopify domain. Hosted requests
// may already carry tenantId (runWithTenant); otherwise resolve it from the
// platform's Tenant table by shop — cached, degrade to null.

const tenantIdCache = new Map<string, string>();

export async function tenantIdForShop(
  shop: string,
  contextTenantId?: string
): Promise<string | null> {
  if (contextTenantId) return contextTenantId;
  if (!shop) return null;
  const cached = tenantIdCache.get(shop);
  if (cached) return cached;
  const rows = await safeQuery<{ id: string }>(
    "tenant lookup",
    `SELECT id FROM "Tenant" WHERE shop = $1`,
    [shop]
  );
  const id = rows?.[0]?.id ?? null;
  if (id) tenantIdCache.set(shop, id);
  return id;
}
