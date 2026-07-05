// agents/src/mastra/tenant-storage.ts
//
// Per-tenant Mastra storage for the pooled hosted runtime (spec 11 §3.2).
//
// Schema-per-tenant on shared Postgres: ONE shared pg.Pool for the deployment,
// one lightweight PostgresStore per tenant wrapping it with
// schemaName=tenant_<slug>. @mastra/pg schema-QUALIFIES every table identifier
// (it does not rely on session search_path for storage), which is what makes
// this safe under pgbouncer transaction pooling — verified by the H2 spike.
//
// Client-owned deployments keep using src/mastra/storage.ts (single store,
// public schema); this module is only consulted in hosted mode.

import { Pool } from "pg";
import { PostgresStore } from "@mastra/pg";
import { getTenant, tenantSchemaName } from "../../lib/tenant-context";

let _pool: Pool | null = null;

function sharedPool(): Pool {
  if (!_pool) {
    const connectionString =
      process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("SUPABASE_DATABASE_URL is required for hosted storage.");
    }
    _pool = new Pool({ connectionString, max: 10 });
  }
  return _pool;
}

const _stores = new Map<string, PostgresStore>();
const _initialized = new Set<string>();

/**
 * The current tenant's storage. First use per tenant runs init() (idempotent
 * CREATE SCHEMA / CREATE TABLE IF NOT EXISTS) — provision-on-first-request for
 * the H2 milestone; explicit provisioning at install can adopt disableInit later.
 */
export async function getTenantStorage(): Promise<PostgresStore> {
  const { storeSlug } = getTenant();
  const schema = tenantSchemaName(storeSlug);

  let store = _stores.get(schema);
  if (!store) {
    store = new PostgresStore({
      id: `mos-${schema}`,
      schemaName: schema,
      pool: sharedPool(),
    });
    _stores.set(schema, store);
  }
  if (!_initialized.has(schema)) {
    await store.init();
    _initialized.add(schema);
  }
  return store;
}
