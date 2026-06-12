import { PostgresStore } from "@mastra/pg";

/**
 * Shared Mastra storage backed by Supabase Postgres.
 *
 * Undefined when no database URL is configured so the console still
 * builds and runs (without persistence) before Supabase is set up.
 */
const connectionString =
  process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;

export const storage = connectionString
  ? new PostgresStore({ id: "marketing-os", connectionString })
  : undefined;
