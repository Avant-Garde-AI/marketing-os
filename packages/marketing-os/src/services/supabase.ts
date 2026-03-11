/**
 * Supabase validation and setup
 * Handles connection testing and table creation via direct PostgreSQL connection
 */

import ora from "ora";
import pg from "pg";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey?: string;
  dbPassword?: string;
}

export interface SupabaseConnection {
  connected: boolean;
  error?: string;
  version?: string;
}

/**
 * Extract project reference from Supabase URL
 */
export function extractProjectRef(url: string): string | null {
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co$/);
  return match ? match[1] : null;
}

/**
 * Build PostgreSQL connection string from Supabase config
 */
export function buildConnectionString(config: SupabaseConfig): string | null {
  if (!config.dbPassword) return null;

  const projectRef = extractProjectRef(config.url);
  if (!projectRef) return null;

  // Use the pooler connection string (works with IPv4)
  // Format: postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
  // We use the session mode pooler on port 5432 for DDL operations
  return `postgres://postgres.${projectRef}:${encodeURIComponent(config.dbPassword)}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
}

/**
 * Validate Supabase URL format
 */
export function validateSupabaseUrl(url: string): {
  valid: boolean;
  error?: string;
} {
  // Should match https://<project-ref>.supabase.co
  const pattern = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;

  if (!pattern.test(url)) {
    return {
      valid: false,
      error:
        "Invalid Supabase URL format. Expected: https://<project-ref>.supabase.co",
    };
  }

  return { valid: true };
}

/**
 * Validate Supabase key format
 */
export function validateSupabaseKey(key: string): {
  valid: boolean;
  error?: string;
} {
  // Basic JWT format check
  const parts = key.split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      error: "Invalid key format. Expected a JWT token.",
    };
  }

  // Check if it's base64-like
  const base64Pattern = /^[A-Za-z0-9_-]+$/;
  if (!parts.every((part) => base64Pattern.test(part))) {
    return {
      valid: false,
      error: "Invalid key format. Expected a valid JWT token.",
    };
  }

  return { valid: true };
}

/**
 * Test connection to Supabase
 */
export async function testSupabaseConnection(
  config: SupabaseConfig
): Promise<SupabaseConnection> {
  const spinner = ora("Testing Supabase connection...").start();

  try {
    // Validate URL and key format first
    const urlValidation = validateSupabaseUrl(config.url);
    if (!urlValidation.valid) {
      spinner.fail("Invalid Supabase URL");
      return {
        connected: false,
        error: urlValidation.error,
      };
    }

    const keyValidation = validateSupabaseKey(config.anonKey);
    if (!keyValidation.valid) {
      spinner.fail("Invalid Supabase key");
      return {
        connected: false,
        error: keyValidation.error,
      };
    }

    // Test connection by fetching the REST API root
    const response = await fetch(`${config.url}/rest/v1/`, {
      method: "GET",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get OpenAPI spec to confirm it's a valid Supabase instance
    const data = (await response.json()) as { info?: { version?: string } };

    spinner.succeed(
      `Connected to Supabase${data.info?.version ? ` (${data.info.version})` : ""}`
    );

    return {
      connected: true,
      version: data.info?.version,
    };
  } catch (error) {
    spinner.fail("Failed to connect to Supabase");
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run Supabase migrations
 *
 * WARNING: This function requires a custom `exec_sql` PostgreSQL function
 * to be created in your Supabase project first. This is NOT a built-in
 * Supabase function. For most use cases, run migrations directly via
 * Supabase CLI or the SQL Editor instead.
 *
 * @deprecated Use Supabase CLI migrations or SQL Editor for table setup
 */
export async function runSupabaseMigrations(
  config: SupabaseConfig,
  migrationsDir: string
): Promise<{ success: boolean; error?: string }> {
  const spinner = ora("Running Supabase migrations...").start();

  try {
    if (!config.serviceKey) {
      throw new Error("Service key required for running migrations");
    }

    // Read migration files
    const fs = await import("fs-extra");
    const path = await import("path");

    const migrationFiles = await fs.readdir(migrationsDir);
    const sqlFiles = migrationFiles
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (sqlFiles.length === 0) {
      spinner.warn("No migration files found");
      return { success: true };
    }

    // Execute each migration
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, "utf-8");

      spinner.text = `Running migration: ${file}`;

      const response = await fetch(`${config.url}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          apikey: config.serviceKey,
          Authorization: `Bearer ${config.serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Migration ${file} failed: ${error}`);
      }
    }

    spinner.succeed(`Ran ${sqlFiles.length} migration${sqlFiles.length !== 1 ? "s" : ""}`);
    return { success: true };
  } catch (error) {
    spinner.fail("Failed to run migrations");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Core schema SQL for Marketing OS tables
 */
export const SCHEMA_SQL = `
-- Users table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Skills execution log
CREATE TABLE IF NOT EXISTS public.skill_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL,
  user_id UUID REFERENCES public.users(id),
  status TEXT NOT NULL,
  input JSONB,
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Agent conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id),
  title TEXT,
  messages JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integration credentials (encrypted)
CREATE TABLE IF NOT EXISTS public.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  credentials JSONB NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- RLS Policies (use IF NOT EXISTS pattern via DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own data' AND tablename = 'users') THEN
    CREATE POLICY "Users can view own data" ON public.users FOR SELECT USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own data' AND tablename = 'users') THEN
    CREATE POLICY "Users can update own data" ON public.users FOR UPDATE USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own skills' AND tablename = 'skill_executions') THEN
    CREATE POLICY "Users can view own skills" ON public.skill_executions FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own conversations' AND tablename = 'conversations') THEN
    CREATE POLICY "Users can view own conversations" ON public.conversations FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage integrations' AND tablename = 'integrations') THEN
    CREATE POLICY "Admins can manage integrations" ON public.integrations FOR ALL USING (
      EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );
  END IF;
END $$;
`.trim();

/**
 * Create Supabase tables using direct PostgreSQL connection
 * Connects via the Supabase pooler to execute DDL statements
 */
export async function createSupabaseTables(
  config: SupabaseConfig
): Promise<{ success: boolean; error?: string }> {
  const spinner = ora("Creating Supabase tables...").start();

  try {
    if (!config.dbPassword) {
      throw new Error("Database password required for creating tables");
    }

    const connectionString = buildConnectionString(config);
    if (!connectionString) {
      throw new Error("Could not build connection string from Supabase URL");
    }

    // Connect directly to PostgreSQL
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    try {
      // Execute the schema SQL
      await client.query(SCHEMA_SQL);
      spinner.succeed("Supabase tables created");
      return { success: true };
    } finally {
      await client.end();
    }
  } catch (error) {
    spinner.fail("Failed to create Supabase tables");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if Supabase tables exist
 *
 * WARNING: This function requires a custom `get_tables` PostgreSQL function
 * to be created in your Supabase project first. This is NOT a built-in
 * Supabase function.
 *
 * @deprecated Use Supabase Dashboard or CLI to check table existence
 */
export async function checkSupabaseTables(
  config: SupabaseConfig
): Promise<{ exists: boolean; tables?: string[]; error?: string }> {
  try {
    // Query for tables in the public schema
    const response = await fetch(
      `${config.url}/rest/v1/rpc/get_tables?schema=public`,
      {
        method: "GET",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const tables = (await response.json()) as Array<{ table_name: string }>;

    return {
      exists: tables.length > 0,
      tables: tables.map((t) => t.table_name),
    };
  } catch (error) {
    return {
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
