/**
 * Integration selection prompts
 * Handles GA4, Meta, Google Ads, and other integrations
 */

import { checkbox, input, password, confirm, select } from "@inquirer/prompts";
import chalk from "chalk";

import type { ShopifyAuthMode } from "../services/shopify-auth.js";
import {
  displayShopifyInstructions,
  openShopifyAdmin,
  testShopifyToken,
  validateShopifyToken,
  formatScopes,
} from "../services/shopify-auth.js";
import { runOAuthFlow } from "../services/shopify-oauth.js";

export type IntegrationType =
  | "shopify"
  | "ga4"
  | "meta"
  | "google-ads"
  | "klaviyo";

export interface IntegrationCredentials {
  ga4?: {
    propertyId: string;
    serviceAccountJson: string;
  };
  meta?: {
    accessToken: string;
    adAccountId: string;
  };
  googleAds?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    developerToken: string;
    customerId: string;
  };
  klaviyo?: {
    apiKey: string;
  };
  shopify?: {
    accessToken: string;
    storeName: string;
    authMode: ShopifyAuthMode;
  };
}

export interface IntegrationsConfig {
  enabled: IntegrationType[];
  credentials: IntegrationCredentials;
}

/**
 * Prompt for integration selection
 */
export async function promptIntegrationSelection(): Promise<IntegrationType[]> {
  const selected = await checkbox({
    message: "Which integrations do you want to enable?",
    choices: [
      {
        name: "Shopify Admin API (always enabled)",
        value: "shopify",
        checked: true,
        disabled: true,
      },
      {
        name: "Google Analytics (GA4)",
        value: "ga4",
        checked: false,
      },
      {
        name: "Meta Ads",
        value: "meta",
        checked: false,
      },
      {
        name: "Google Ads",
        value: "google-ads",
        checked: false,
      },
      {
        name: "Klaviyo",
        value: "klaviyo",
        checked: false,
      },
    ],
  });

  // Ensure shopify is always included
  if (!selected.includes("shopify")) {
    selected.push("shopify");
  }

  return selected as IntegrationType[];
}

/**
 * Prompt for Shopify auth method and credentials.
 *
 * Offers two paths:
 *   1. Automatic (OAuth) — opens browser, one-click install, token returned
 *   2. Manual (Custom App) — user creates custom app and pastes shpat_ token
 */
export async function promptShopifyCredentials(
  storeUrl: string
): Promise<IntegrationCredentials["shopify"]> {
  console.log(chalk.cyan("\n→ Shopify Admin API"));

  const authMode = await select<ShopifyAuthMode>({
    message: "How would you like to connect your Shopify store?",
    choices: [
      {
        name: "Automatic (recommended) — opens browser, authorize in one click",
        value: "oauth" as ShopifyAuthMode,
      },
      {
        name: "Manual — create a custom app and paste the access token",
        value: "custom_app" as ShopifyAuthMode,
      },
    ],
    default: "oauth" as ShopifyAuthMode,
  });

  if (authMode === "oauth") {
    return promptShopifyOAuth(storeUrl);
  }

  return promptShopifyManualToken(storeUrl);
}

/**
 * OAuth flow: open browser, authorize, receive token via local callback.
 */
async function promptShopifyOAuth(
  storeUrl: string
): Promise<IntegrationCredentials["shopify"]> {
  console.log(
    chalk.gray(
      "  This will open your browser to authorize Marketing OS on your Shopify store."
    )
  );
  console.log(
    chalk.gray(`  Scopes requested: ${formatScopes()}\n`)
  );

  try {
    const result = await runOAuthFlow(storeUrl);

    // Validate the token actually works
    const test = await testShopifyToken(storeUrl, result.accessToken);
    if (test.valid) {
      console.log(
        chalk.green(`  ✓ Connected to ${test.shopName ?? storeUrl}`)
      );
    }

    return {
      accessToken: result.accessToken,
      storeName: storeUrl.replace(".myshopify.com", ""),
      authMode: "oauth",
    };
  } catch (err) {
    console.log(
      chalk.yellow(
        `\n  OAuth flow failed: ${err instanceof Error ? err.message : String(err)}`
      )
    );

    const fallback = await confirm({
      message: "Would you like to try the manual token flow instead?",
      default: true,
    });

    if (fallback) {
      return promptShopifyManualToken(storeUrl);
    }

    throw err;
  }
}

/**
 * Manual flow: user creates a custom app in Shopify Admin and pastes the token.
 */
async function promptShopifyManualToken(
  storeUrl: string
): Promise<IntegrationCredentials["shopify"]> {
  displayShopifyInstructions();

  const shouldOpen = await confirm({
    message: "Open Shopify Admin in your browser?",
    default: true,
  });

  if (shouldOpen) {
    await openShopifyAdmin(storeUrl);
  }

  const accessToken = await password({
    message: "Shopify Admin API access token:",
    mask: "*",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Access token is required";
      }
      const validation = validateShopifyToken(value.trim());
      if (!validation.valid) {
        return validation.error ?? "Invalid token format";
      }
      return true;
    },
  });

  // Test the token
  const test = await testShopifyToken(storeUrl, accessToken.trim());
  if (test.valid) {
    console.log(
      chalk.green(`  ✓ Connected to ${test.shopName ?? storeUrl}`)
    );
  } else {
    console.log(
      chalk.yellow(
        `  ⚠ Token test failed: ${test.error}. You can update it later in .env.local`
      )
    );
  }

  return {
    accessToken: accessToken.trim(),
    storeName: storeUrl.replace(".myshopify.com", ""),
    authMode: "custom_app",
  };
}

/**
 * Prompt for GA4 credentials
 */
export async function promptGA4Credentials(): Promise<
  IntegrationCredentials["ga4"]
> {
  console.log(chalk.cyan("\n→ Google Analytics (GA4)"));
  console.log(
    chalk.gray(
      "  Create a service account in Google Cloud Console and download the JSON key."
    )
  );
  console.log(
    chalk.gray(
      "  Visit: https://console.cloud.google.com/iam-admin/serviceaccounts\n"
    )
  );

  const propertyId = await input({
    message: "GA4 Property ID (e.g., 123456789):",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Property ID is required";
      }
      if (!/^\d+$/.test(value)) {
        return "Property ID should be numeric";
      }
      return true;
    },
  });

  const serviceAccountJson = await input({
    message: "Path to service account JSON file:",
    validate: async (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Service account JSON is required";
      }

      // Check if file exists
      try {
        const fs = await import("fs-extra");
        const exists = await fs.pathExists(value);
        if (!exists) {
          return "File not found";
        }

        // Validate JSON
        const content = await fs.readFile(value, "utf-8");
        JSON.parse(content);

        return true;
      } catch {
        return "Invalid JSON file";
      }
    },
  });

  return {
    propertyId,
    serviceAccountJson,
  };
}

/**
 * Prompt for Meta Ads credentials
 */
export async function promptMetaCredentials(): Promise<
  IntegrationCredentials["meta"]
> {
  console.log(chalk.cyan("\n→ Meta Ads"));
  console.log(
    chalk.gray("  Generate a long-lived access token from Meta Business Manager.")
  );
  console.log(
    chalk.gray("  Visit: https://business.facebook.com/settings/system-users\n")
  );

  const accessToken = await password({
    message: "Meta access token:",
    mask: "*",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Access token is required";
      }
      return true;
    },
  });

  const adAccountId = await input({
    message: "Ad Account ID (e.g., act_123456789):",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Ad Account ID is required";
      }
      if (!value.startsWith("act_")) {
        return "Ad Account ID should start with 'act_'";
      }
      return true;
    },
  });

  return {
    accessToken,
    adAccountId,
  };
}

/**
 * Prompt for Google Ads credentials
 */
export async function promptGoogleAdsCredentials(): Promise<
  IntegrationCredentials["googleAds"]
> {
  console.log(chalk.cyan("\n→ Google Ads"));
  console.log(
    chalk.gray("  Set up OAuth 2.0 credentials and get a refresh token.")
  );
  console.log(
    chalk.gray("  Visit: https://console.cloud.google.com/apis/credentials\n")
  );

  const clientId = await input({
    message: "OAuth Client ID:",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Client ID is required";
      }
      return true;
    },
  });

  const clientSecret = await password({
    message: "OAuth Client Secret:",
    mask: "*",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Client Secret is required";
      }
      return true;
    },
  });

  const refreshToken = await password({
    message: "Refresh Token:",
    mask: "*",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Refresh Token is required";
      }
      return true;
    },
  });

  const developerToken = await password({
    message: "Developer Token:",
    mask: "*",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Developer Token is required";
      }
      return true;
    },
  });

  const customerId = await input({
    message: "Customer ID (e.g., 123-456-7890):",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Customer ID is required";
      }
      return true;
    },
  });

  return {
    clientId,
    clientSecret,
    refreshToken,
    developerToken,
    customerId,
  };
}

/**
 * Prompt for Klaviyo credentials
 */
export async function promptKlaviyoCredentials(): Promise<
  IntegrationCredentials["klaviyo"]
> {
  console.log(chalk.cyan("\n→ Klaviyo"));
  console.log(
    chalk.gray("  Create a private API key in your Klaviyo account settings.")
  );
  console.log(
    chalk.gray("  Visit: https://www.klaviyo.com/account#api-keys-tab\n")
  );

  const apiKey = await password({
    message: "Klaviyo Private API Key:",
    mask: "*",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "API Key is required";
      }
      return true;
    },
  });

  return { apiKey };
}

/**
 * Complete integrations configuration flow
 */
export async function promptIntegrationsConfig(
  storeUrl: string
): Promise<IntegrationsConfig> {
  console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────────────┐"));
  console.log(chalk.bold.cyan("│  Integrations (you can add more later)           │"));
  console.log(chalk.bold.cyan("└─────────────────────────────────────────────────┘\n"));

  // Get selected integrations
  const enabled = await promptIntegrationSelection();

  const credentials: IntegrationCredentials = {};

  // Prompt for credentials for each selected integration
  for (const integration of enabled) {
    switch (integration) {
      case "shopify":
        credentials.shopify = await promptShopifyCredentials(storeUrl);
        break;
      case "ga4":
        credentials.ga4 = await promptGA4Credentials();
        break;
      case "meta":
        credentials.meta = await promptMetaCredentials();
        break;
      case "google-ads":
        credentials.googleAds = await promptGoogleAdsCredentials();
        break;
      case "klaviyo":
        credentials.klaviyo = await promptKlaviyoCredentials();
        break;
    }
  }

  console.log(chalk.green("\n  ✓ Integrations configured\n"));

  return {
    enabled,
    credentials,
  };
}

/**
 * Prompt to skip integrations (for quick setup)
 */
export async function promptSkipIntegrations(): Promise<boolean> {
  return await confirm({
    message: "Skip integration setup for now? (you can add them later)",
    default: false,
  });
}
