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
/** Context tenant ids already checked against THIS database. */
const contextIdVerified = new Set<string>();

export async function tenantIdForShop(
  shop: string,
  contextTenantId?: string
): Promise<string | null> {
  // A context tenant id is only usable if it names a row in THIS database.
  //
  // It used to be trusted outright, which is correct on the hosted platform —
  // the runtime and the projections share one database, so the id in the
  // request context is the id in the table. It is NOT correct for a
  // self-hosted deployment: there the id arrives from the platform's connector
  // -token verification (a different database entirely) while the local
  // "Tenant" row has its own uuid. Reads carrying a context id then queried a
  // tenant that does not exist locally and returned [] — with no error, since
  // every caller degrades rather than throws. Writes were unaffected, because
  // lib/email/index-sync.ts resolves by shop and ignores context. The result
  // was data that saved correctly and read back empty.
  //
  // So: verify once per id, then fall back to the shop lookup. One cheap query
  // buys back the invariant that a read and a write agree on who the tenant is.
  if (contextTenantId) {
    if (contextIdVerified.has(contextTenantId)) return contextTenantId;
    const hit = await safeQuery<{ id: string }>(
      "tenant context check",
      `SELECT id FROM "Tenant" WHERE id = $1`,
      [contextTenantId]
    );
    if (hit?.[0]) {
      contextIdVerified.add(contextTenantId);
      return contextTenantId;
    }
    // Not ours — a platform id in a self-hosted database. Resolve by shop.
  }

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
