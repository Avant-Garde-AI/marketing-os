/**
 * Shared prompt utilities
 */

import { input, confirm, select, checkbox, password } from "@inquirer/prompts";
import chalk from "chalk";
import { validateStoreUrl } from "./shopify.js";
import {
  validateSupabaseUrl,
  validateSupabaseKey,
  testSupabaseConnection,
} from "../services/supabase.js";
import {
  openAnthropicConsole,
  displayAnthropicInstructions,
  validateAnthropicKey,
} from "../services/anthropic.js";
import {
  openShopifyAdmin,
  displayShopifyInstructions,
  validateShopifyToken,
} from "../services/shopify-auth.js";

export interface StoreConfig {
  storeUrl: string;
  storeName: string;
}

export interface RepoConfig {
  hasExistingRepo: boolean;
  repoFullName: string;
  repoName?: string;
  repoOrg?: string;
}

export interface ServiceConfig {
  anthropicKey: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  adminEmail: string;
  useSupabase: boolean;
}

export interface IntegrationConfig {
  enabledIntegrations: string[];
  credentials: Record<string, Record<string, string>>;
}

/**
 * Prompt for store configuration
 */
export async function promptStoreConfig(): Promise<StoreConfig> {
  console.log(chalk.bold("\n📦 Store Configuration\n"));

  const storeUrl = await input({
    message: "Shopify store URL:",
    validate: (value) => {
      if (!value) return "Store URL is required";
      if (!validateStoreUrl(value)) {
        return "Please enter a valid Shopify store URL (e.g., mystore.myshopify.com)";
      }
      return true;
    },
  });

  const storeName = storeUrl.replace(".myshopify.com", "").replace(/-/g, " ");

  return { storeUrl, storeName };
}

/**
 * Prompt for repository configuration
 */
export async function promptRepoConfig(): Promise<RepoConfig> {
  const hasExistingRepo = await confirm({
    message: "Do you have an existing theme repo on GitHub?",
    default: false,
  });

  if (hasExistingRepo) {
    const repoFullName = await input({
      message: "GitHub repository (org/repo):",
      validate: (value) => {
        if (!value) return "Repository is required";
        if (!value.includes("/"))
          return "Please enter in format: org/repo or username/repo";
        return true;
      },
    });

    return { hasExistingRepo: true, repoFullName };
  } else {
    const repoName = await input({
      message: "GitHub repository name:",
      validate: (value) => {
        if (!value) return "Repository name is required";
        if (!/^[a-z0-9-_]+$/i.test(value))
          return "Repository name can only contain letters, numbers, hyphens, and underscores";
        return true;
      },
    });

    const repoOrg = await input({
      message: "GitHub org or username:",
      validate: (value) => {
        if (!value) return "Organization or username is required";
        return true;
      },
    });

    return {
      hasExistingRepo: false,
      repoFullName: `${repoOrg}/${repoName}`,
      repoName,
      repoOrg,
    };
  }
}

/**
 * Prompt for service configuration
 */
export async function promptServiceConfig(): Promise<ServiceConfig> {
  console.log(chalk.bold("\n🔑 Service Configuration\n"));

  // Anthropic API key with browser helper
  const hasAnthropicKey = await confirm({
    message: "Do you have an Anthropic API key?",
    default: true,
  });

  if (!hasAnthropicKey) {
    displayAnthropicInstructions();
    await openAnthropicConsole();

    await confirm({
      message: "Press Enter once you've copied your API key...",
      default: true,
    });
  }

  const anthropicKey = await password({
    message: "Anthropic API key:",
    mask: "*",
    validate: (value) => {
      const result = validateAnthropicKey(value);
      if (!result.valid) return result.error || "Invalid API key";
      return true;
    },
  });

  const supabaseChoice = await select({
    message: "Set up Supabase? (recommended)",
    choices: [
      { name: "Yes — use an existing project", value: "existing" },
      { name: "Yes — I'll create a new project", value: "new" },
      { name: "No — use local SQLite for development", value: "none" },
    ],
  });

  let supabaseUrl: string | undefined;
  let supabaseAnonKey: string | undefined;
  let supabaseServiceKey: string | undefined;
  let useSupabase = supabaseChoice !== "none";

  if (supabaseChoice === "new") {
    console.log(
      chalk.dim(
        "\n→ Opening https://supabase.com/dashboard/new in your browser..."
      )
    );
    console.log(
      chalk.dim(
        "  After creating your project, copy the URL and anon key from Settings > API\n"
      )
    );
  }

  if (supabaseChoice !== "none") {
    supabaseUrl = await input({
      message: "Supabase project URL:",
      validate: (value) => {
        if (!value) return "Supabase URL is required";
        const validation = validateSupabaseUrl(value);
        if (!validation.valid) return validation.error || "Invalid URL";
        return true;
      },
    });

    supabaseAnonKey = await password({
      message: "Supabase anon key:",
      mask: "*",
      validate: (value) => {
        if (!value) return "Supabase anon key is required";
        const validation = validateSupabaseKey(value);
        if (!validation.valid) return validation.error || "Invalid key format";
        return true;
      },
    });

    // Test connection before proceeding
    const connection = await testSupabaseConnection({
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
    });

    if (!connection.connected) {
      console.log(
        chalk.red(`\n  ✗ Connection failed: ${connection.error}\n`)
      );

      const retry = await confirm({
        message: "Try again?",
        default: true,
      });

      if (retry) {
        return promptServiceConfig();
      } else {
        console.log(chalk.yellow("  Continuing without Supabase...\n"));
        useSupabase = false;
        supabaseUrl = undefined;
        supabaseAnonKey = undefined;
      }
    }

    if (useSupabase) {
      const wantsServiceKey = await confirm({
        message:
          "Provide service role key? (recommended for server-side operations)",
        default: true,
      });

      if (wantsServiceKey) {
        supabaseServiceKey = await password({
          message: "Supabase service role key:",
          mask: "*",
          validate: (value) => {
            if (!value) return "Service role key is required";
            const validation = validateSupabaseKey(value);
            if (!validation.valid)
              return validation.error || "Invalid key format";
            return true;
          },
        });
      }
    }
  }

  const adminEmail = await input({
    message: "Admin email for login:",
    validate: (value) => {
      if (!value) return "Admin email is required";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        return "Please enter a valid email address";
      return true;
    },
  });

  return {
    anthropicKey,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceKey,
    adminEmail,
    useSupabase,
  };
}

/**
 * Prompt for integration configuration
 */
export async function promptIntegrationConfig(): Promise<IntegrationConfig> {
  console.log(chalk.bold("\n🔌 Integrations\n"));
  console.log(chalk.dim("You can add more integrations later\n"));

  const integrations = await checkbox({
    message: "Which integrations do you want to enable?",
    choices: [
      { name: "Shopify Admin API (always enabled)", value: "shopify", checked: true, disabled: true },
      { name: "Google Analytics (GA4)", value: "ga4" },
      { name: "Meta Ads", value: "meta" },
      { name: "Google Ads", value: "google-ads" },
      { name: "Klaviyo", value: "klaviyo" },
    ],
  });

  const credentials: Record<string, Record<string, string>> = {};

  // Shopify is always enabled
  if (!integrations.includes("shopify")) {
    integrations.push("shopify");
  }

  // Prompt for credentials for selected integrations
  for (const integration of integrations) {
    if (integration === "shopify") {
      // Shopify with browser helper
      const hasShopifyToken = await confirm({
        message: "Do you have a Shopify Admin API access token?",
        default: false,
      });

      if (!hasShopifyToken) {
        // We need the store URL - this should be passed in or asked for here
        const storeUrlForAuth = await input({
          message: "Shopify store URL (for opening admin):",
          validate: (value) => {
            if (!value) return "Store URL is required";
            if (!validateStoreUrl(value)) {
              return "Please enter a valid Shopify store URL (e.g., mystore.myshopify.com)";
            }
            return true;
          },
        });

        displayShopifyInstructions();
        await openShopifyAdmin(storeUrlForAuth);

        await confirm({
          message: "Press Enter once you've copied your access token...",
          default: true,
        });
      }

      credentials.shopify = {
        accessToken: await password({
          message: "Shopify Admin API access token:",
          mask: "*",
          validate: (value) => {
            const result = validateShopifyToken(value);
            if (!result.valid) return result.error || "Invalid token";
            return true;
          },
        }),
      };
    } else if (integration === "ga4") {
      credentials.ga4 = {
        propertyId: await input({
          message: "GA4 Property ID:",
        }),
        credentialsJson: await password({
          message: "GA4 Service Account JSON (paste full JSON):",
          mask: "*",
        }),
      };
    } else if (integration === "meta") {
      credentials.meta = {
        accessToken: await password({
          message: "Meta Ads access token:",
          mask: "*",
        }),
        adAccountId: await input({
          message: "Meta Ad Account ID:",
        }),
      };
    } else if (integration === "google-ads") {
      credentials["google-ads"] = {
        customerId: await input({
          message: "Google Ads Customer ID:",
        }),
        credentialsJson: await password({
          message: "Google Ads credentials JSON:",
          mask: "*",
        }),
      };
    } else if (integration === "klaviyo") {
      credentials.klaviyo = {
        apiKey: await password({
          message: "Klaviyo API key:",
          mask: "*",
        }),
      };
    }
  }

  return {
    enabledIntegrations: integrations,
    credentials,
  };
}

/**
 * Prompt to deploy to Vercel
 */
export async function promptDeploy(): Promise<boolean> {
  console.log(chalk.bold("\n🚀 Deployment\n"));

  return await confirm({
    message: "Deploy to Vercel now?",
    default: true,
  });
}
