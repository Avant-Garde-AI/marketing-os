/**
 * Supabase validation and setup
 * Handles connection testing and table creation via Supabase CLI or browser
 */

import ora from "ora";
import { execa } from "execa";
import fs from "fs-extra";
import path from "path";
import open from "open";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey?: string;
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
 * Check if Supabase CLI is installed
 */
export async function isSupabaseCLIInstalled(): Promise<boolean> {
  try {
    await execa("supabase", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if user is logged into Supabase CLI
 */
export async function isSupabaseCLILoggedIn(): Promise<boolean> {
  try {
    // `supabase projects list` will fail if not logged in
    await execa("supabase", ["projects", "list"], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
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
 * Create Supabase tables using the Supabase CLI
 * Uses `supabase login`, `supabase link`, and `supabase db push`
 */
export async function createSupabaseTablesViaCLI(
  projectRef: string,
  workingDir: string
): Promise<{ success: boolean; error?: string; usedCLI: boolean }> {
  const spinner = ora("Setting up Supabase database...").start();

  try {
    // Check if Supabase CLI is installed
    const cliInstalled = await isSupabaseCLIInstalled();
    if (!cliInstalled) {
      spinner.info("Supabase CLI not installed - will open browser instead");
      return { success: false, error: "CLI not installed", usedCLI: false };
    }

    // Check if logged in
    spinner.text = "Checking Supabase CLI authentication...";
    const loggedIn = await isSupabaseCLILoggedIn();
    if (!loggedIn) {
      spinner.text = "Opening browser for Supabase login...";
      // This will open a browser for OAuth login
      await execa("supabase", ["login"], { stdio: "inherit" });
    }

    // Create supabase directory structure
    const supabaseDir = path.join(workingDir, "supabase");
    const migrationsDir = path.join(supabaseDir, "migrations");
    await fs.ensureDir(migrationsDir);

    // Create migration file with timestamp
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const migrationFile = path.join(migrationsDir, `${timestamp}_init_marketing_os.sql`);
    await fs.writeFile(migrationFile, SCHEMA_SQL);

    // Link to the project
    spinner.text = "Linking to Supabase project...";
    try {
      await execa("supabase", ["link", "--project-ref", projectRef], {
        cwd: workingDir,
        stdio: "inherit",
      });
    } catch (linkError) {
      // Link might fail if already linked or need password - that's ok
      spinner.text = "Project link attempted...";
    }

    // Push the migration
    spinner.text = "Pushing database migration...";
    await execa("supabase", ["db", "push"], {
      cwd: workingDir,
      stdio: "inherit",
    });

    spinner.succeed("Supabase tables created via CLI");
    return { success: true, usedCLI: true };
  } catch (error) {
    spinner.fail("Failed to create tables via CLI");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      usedCLI: true,
    };
  }
}

/**
 * Open Supabase SQL Editor in browser with schema ready to paste
 */
export async function openSupabaseSQLEditor(projectRef: string): Promise<void> {
  const sqlEditorUrl = `https://supabase.com/dashboard/project/${projectRef}/sql/new`;

  console.log("\n  Opening Supabase SQL Editor in your browser...");
  console.log(`  URL: ${sqlEditorUrl}\n`);

  await open(sqlEditorUrl);
}

/**
 * Copy text to clipboard (cross-platform)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      await execa("pbcopy", { input: text });
    } else if (platform === "linux") {
      // Try xclip first, then xsel
      try {
        await execa("xclip", ["-selection", "clipboard"], { input: text });
      } catch {
        await execa("xsel", ["--clipboard", "--input"], { input: text });
      }
    } else if (platform === "win32") {
      await execa("clip", { input: text });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

