/**
 * Service configuration prompts
 * Handles API keys and Supabase setup
 */

import { input, select, confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import {
  validateSupabaseUrl,
  validateSupabaseKey,
  testSupabaseConnection,
} from "../services/supabase.js";
import { execa } from "execa";

export interface ServicesConfig {
  anthropicKey: string;
  supabaseMode: "new" | "existing" | "skip";
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  adminEmail: string;
}

/**
 * Validate Anthropic API key format
 */
function validateAnthropicKey(key: string): boolean {
  // Should start with sk-ant-api03- or sk-ant-
  return key.startsWith("sk-ant-");
}

/**
 * Test Anthropic API key
 */
async function testAnthropicKey(key: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
    });

    // A 4xx error (except 401) is actually OK - it means the key is valid
    // but the request itself was invalid, which is fine for validation
    return response.status !== 401;
  } catch {
    return false;
  }
}

/**
 * Prompt for Anthropic API key
 */
export async function promptAnthropicKey(): Promise<string> {
  return await password({
    message: "Anthropic API key:",
    mask: "*",
    validate: async (value: string) => {
      if (!value || value.trim().length === 0) {
        return "API key is required";
      }

      if (!validateAnthropicKey(value)) {
        return "Invalid key format. Expected to start with sk-ant-";
      }

      // Test the key
      console.log(chalk.gray("  Validating key..."));
      const isValid = await testAnthropicKey(value);
      if (!isValid) {
        return "Invalid API key. Please check and try again.";
      }

      return true;
    },
  });
}

/**
 * Prompt for Supabase setup mode
 */
export async function promptSupabaseMode(): Promise<
  "new" | "existing" | "skip"
> {
  return await select({
    message: "Set up Supabase? (recommended)",
    choices: [
      {
        name: "Yes — create a new project",
        value: "new" as const,
        description: "Opens Supabase dashboard to create a new project",
      },
      {
        name: "Yes — use an existing project",
        value: "existing" as const,
        description: "Enter credentials for an existing Supabase project",
      },
      {
        name: "No — use local SQLite for development",
        value: "skip" as const,
        description: "Run without Supabase (limited functionality)",
      },
    ],
  });
}

/**
 * Open Supabase dashboard for new project creation
 */
async function openSupabaseDashboard(): Promise<void> {
  console.log(
    chalk.cyan("\nOpening Supabase dashboard to create a new project...")
  );
  console.log(
    chalk.gray(
      "Create your project and return here with the credentials.\n"
    )
  );

  try {
    // Try to open the browser
    const url = "https://supabase.com/dashboard/new";
    if (process.platform === "darwin") {
      await execa("open", [url]);
    } else if (process.platform === "win32") {
      await execa("cmd", ["/c", "start", url]);
    } else {
      await execa("xdg-open", [url]);
    }
  } catch {
    console.log(chalk.yellow(`Please visit: https://supabase.com/dashboard/new`));
  }

  // Wait for user confirmation
  await confirm({
    message: "Press enter when you're ready to enter your credentials",
    default: true,
  });
}

/**
 * Prompt for Supabase project URL
 */
export async function promptSupabaseUrl(): Promise<string> {
  return await input({
    message: "Supabase project URL:",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Project URL is required";
      }

      const validation = validateSupabaseUrl(value);
      if (!validation.valid) {
        return validation.error || "Invalid URL";
      }

      return true;
    },
  });
}

/**
 * Prompt for Supabase anon key
 */
export async function promptSupabaseAnonKey(): Promise<string> {
  return await password({
    message: "Supabase anon key:",
    mask: "*",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Anon key is required";
      }

      const validation = validateSupabaseKey(value);
      if (!validation.valid) {
        return validation.error || "Invalid key format";
      }

      return true;
    },
  });
}

/**
 * Prompt for Supabase service key (optional)
 */
export async function promptSupabaseServiceKey(): Promise<string | undefined> {
  const shouldProvide = await confirm({
    message:
      "Provide service role key? (optional, enables automatic table creation)",
    default: false,
  });

  if (!shouldProvide) {
    return undefined;
  }

  return await password({
    message: "Supabase service role key:",
    mask: "*",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return true; // Optional
      }

      const validation = validateSupabaseKey(value);
      if (!validation.valid) {
        return validation.error || "Invalid key format";
      }

      return true;
    },
  });
}

/**
 * Prompt for admin email
 */
export async function promptAdminEmail(): Promise<string> {
  return await input({
    message: "Admin email for login:",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Email is required";
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return "Invalid email format";
      }

      return true;
    },
  });
}

/**
 * Complete service configuration flow
 */
export async function promptServicesConfig(): Promise<ServicesConfig> {
  console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────────────┐"));
  console.log(chalk.bold.cyan("│  Service Configuration                           │"));
  console.log(chalk.bold.cyan("└─────────────────────────────────────────────────┘\n"));

  // Get Anthropic API key
  const anthropicKey = await promptAnthropicKey();
  console.log(chalk.green("  ✓ Key validated\n"));

  // Get Supabase configuration
  const supabaseMode = await promptSupabaseMode();

  let config: ServicesConfig = {
    anthropicKey,
    supabaseMode,
    adminEmail: "",
  };

  if (supabaseMode === "new") {
    await openSupabaseDashboard();
  }

  if (supabaseMode !== "skip") {
    // Get Supabase credentials
    const supabaseUrl = await promptSupabaseUrl();
    const supabaseAnonKey = await promptSupabaseAnonKey();
    const supabaseServiceKey = await promptSupabaseServiceKey();

    // Test connection
    const connection = await testSupabaseConnection({
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
      serviceKey: supabaseServiceKey,
    });

    if (!connection.connected) {
      console.log(chalk.red(`\n  ✗ Connection failed: ${connection.error}\n`));

      const retry = await confirm({
        message: "Try again?",
        default: true,
      });

      if (retry) {
        return promptServicesConfig(); // Recursive retry
      } else {
        console.log(chalk.yellow("  Continuing without Supabase...\n"));
        config.supabaseMode = "skip";
      }
    } else {
      config.supabaseUrl = supabaseUrl;
      config.supabaseAnonKey = supabaseAnonKey;
      config.supabaseServiceKey = supabaseServiceKey;
    }
  }

  // Get admin email
  config.adminEmail = await promptAdminEmail();
  console.log(chalk.green("  ✓ Admin user will be created on first login\n"));

  return config;
}
