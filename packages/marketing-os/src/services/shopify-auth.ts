/**
 * Shopify authentication setup — supports two modes:
 *
 *   1. OAuth via Partner Dashboard app (recommended)
 *      - Used when the app is deployed as a Shopify embedded app
 *      - Merchant installs via OAuth → token stored in Supabase
 *
 *   2. Legacy custom app token (self-hosted fallback)
 *      - Used when a developer creates a private custom app
 *      - Static shpat_ token stored in .env
 *      - Shopify is deprecating this path — OAuth is preferred
 */

import chalk from "chalk";
import open from "open";
import { execa } from "execa";

// ---------------------------------------------------------------------------
// OAuth / Partner Dashboard flow (primary)
// ---------------------------------------------------------------------------

/**
 * Build the install URL that kicks off OAuth for a given shop.
 * This points at the deployed Next.js app's /api/shopify/auth route.
 */
export function getOAuthInstallUrl(
  appUrl: string,
  shop: string
): string {
  return `${appUrl}/api/shopify/auth?shop=${encodeURIComponent(shop)}`;
}

/**
 * Open the OAuth install URL in the merchant's browser.
 */
export async function openOAuthInstall(
  appUrl: string,
  shop: string
): Promise<void> {
  const installUrl = getOAuthInstallUrl(appUrl, shop);
  console.log(chalk.dim(`\n  Opening Shopify OAuth install in your browser...`));
  console.log(chalk.dim(`  URL: ${installUrl}\n`));
  await open(installUrl);
}

/**
 * Display instructions for the OAuth install flow.
 */
export function displayOAuthInstructions(appUrl: string): void {
  console.log(chalk.bold("\n  Shopify App Installation (OAuth)\n"));
  console.log(chalk.dim("  Your Marketing OS app uses OAuth to connect to Shopify stores."));
  console.log(chalk.dim("  When a merchant installs, they'll be redirected to Shopify to"));
  console.log(chalk.dim("  authorize the app, and we'll securely store their access token.\n"));
  console.log(chalk.dim("  App URL:"), chalk.cyan(appUrl));
  console.log(chalk.dim("  Install endpoint:"), chalk.cyan(`${appUrl}/api/shopify/auth?shop=<store>.myshopify.com`));
  console.log(chalk.dim("  Callback endpoint:"), chalk.cyan(`${appUrl}/api/shopify/auth/callback\n`));
  console.log(chalk.dim("  Configure these URLs in your Shopify Partner Dashboard:\n"));
  console.log(chalk.dim("  1. Go to your app in the Partner Dashboard"));
  console.log(chalk.dim("  2. Under 'App setup', set:"));
  console.log(chalk.cyan(`     App URL: ${appUrl}`));
  console.log(chalk.cyan(`     Allowed redirection URL: ${appUrl}/api/shopify/auth/callback`));
  console.log(chalk.dim("  3. Under 'API access', configure the scopes below"));
  console.log(chalk.dim("  4. Save and test the install flow\n"));
}

// ---------------------------------------------------------------------------
// Legacy custom app flow (deprecated fallback for self-hosted)
// ---------------------------------------------------------------------------

/**
 * Build Shopify admin URL for custom app creation.
 * @deprecated Use OAuth via Partner Dashboard instead.
 */
export function getShopifyAppsUrl(storeUrl: string): string {
  const storeName = storeUrl.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeName}/settings/apps/development`;
}

/**
 * Copy text to clipboard (cross-platform)
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      await execa("pbcopy", { input: text });
    } else if (platform === "linux") {
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

/**
 * Open Shopify admin for custom app creation.
 * @deprecated Use openOAuthInstall instead.
 */
export async function openShopifyAdmin(storeUrl: string): Promise<void> {
  const appsUrl = getShopifyAppsUrl(storeUrl);
  console.log(chalk.dim(`\n  Opening Shopify Admin in your browser...`));
  console.log(chalk.dim(`  URL: ${appsUrl}\n`));
  await open(appsUrl);
}

/**
 * Display instructions for creating a Shopify custom app.
 * @deprecated Use displayOAuthInstructions instead.
 */
export function displayShopifyInstructions(): void {
  console.log(chalk.yellow("\n  ⚠ Custom app tokens are being deprecated by Shopify."));
  console.log(chalk.yellow("  Consider using OAuth via the Partner Dashboard instead.\n"));
  console.log(chalk.bold("  Legacy: Create a custom app token:\n"));
  console.log(chalk.dim("  1. Click 'Create an app' in the Shopify admin (opening in browser)"));
  console.log(chalk.dim("  2. Name it 'Marketing OS' and click 'Create app'"));
  console.log(chalk.dim("  3. Click 'Configure Admin API scopes'"));
  console.log(chalk.dim("  4. Enable these scopes:"));
  console.log(chalk.cyan("     - read_products, write_products"));
  console.log(chalk.cyan("     - read_orders"));
  console.log(chalk.cyan("     - read_customers"));
  console.log(chalk.cyan("     - read_analytics"));
  console.log(chalk.dim("  5. Click 'Save' then 'Install app'"));
  console.log(chalk.dim("  6. Copy the 'Admin API access token'"));
  console.log(chalk.dim("  7. Paste it back here\n"));
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Required Shopify Admin API scopes for Marketing OS.
 * These are configured in the Partner Dashboard for OAuth apps,
 * or selected manually for legacy custom apps.
 */
export const REQUIRED_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_customers",
  "read_analytics",
  "read_inventory",
  "read_marketing_events",
];

export function formatScopes(): string {
  return REQUIRED_SCOPES.join(", ");
}

/**
 * Validate Shopify access token format.
 * Accepts both OAuth tokens and legacy shpat_ tokens.
 */
export function validateShopifyToken(token: string): {
  valid: boolean;
  error?: string;
} {
  if (!token) {
    return { valid: false, error: "Access token is required" };
  }

  // OAuth tokens don't have a fixed prefix, but legacy tokens start with shpat_
  // Accept both formats
  if (token.length < 10) {
    return {
      valid: false,
      error: "Access token appears too short",
    };
  }

  return { valid: true };
}

/**
 * Test Shopify access token by making a simple API request.
 */
export async function testShopifyToken(
  storeUrl: string,
  accessToken: string
): Promise<{ valid: boolean; shopName?: string; error?: string }> {
  try {
    const apiUrl = `https://${storeUrl}/admin/api/2024-10/shop.json`;

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const data = (await response.json()) as { shop?: { name?: string } };
      return {
        valid: true,
        shopName: data.shop?.name,
      };
    }

    const error = (await response.json()) as { errors?: string };
    return {
      valid: false,
      error: error.errors || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
