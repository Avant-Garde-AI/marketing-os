import { PostgresStore } from "@mastra/pg";

/**
 * Shared Mastra storage backed by Supabase Postgres (client-owned path).
 *
 * Undefined when no database URL is configured so the console still
 * builds and runs (without persistence) before Supabase is set up.
 *
 * HOSTED (pooled) mode: always undefined — a deployment-wide store would
 * write every tenant's memory into one public schema. Hosted memory is
 * per-tenant via src/mastra/tenant-storage.ts (schema-per-tenant); until the
 * agent wires dynamic per-tenant memory, hosted chat runs stateless.
 */
const connectionString =
  process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;

export const storage =
  connectionString && process.env.MARKETING_OS_MODE !== "hosted"
    ? new PostgresStore({ id: "marketing-os", connectionString })
    : undefined;
