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

/** Current stable Shopify Admin API version */
export const SHOPIFY_API_VERSION = "2025-04";

/**
 * Marketing OS default Shopify App credentials (unlisted / custom distribution).
 * Store owners install via OAuth — no manual custom app creation needed.
 * These can be overridden via env vars SHOPIFY_APP_CLIENT_ID / SHOPIFY_APP_CLIENT_SECRET.
 */
export const DEFAULT_APP_CLIENT_ID =
  process.env.SHOPIFY_APP_CLIENT_ID ?? "marketing-os-default";
export const DEFAULT_APP_CLIENT_SECRET =
  process.env.SHOPIFY_APP_CLIENT_SECRET ?? "";

export type ShopifyAuthMode = "oauth" | "custom_app";

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
 * Display instructions for creating a Shopify custom app (manual flow).
 * @deprecated Use displayOAuthInstructions instead.
 */
export function displayShopifyInstructions(): void {
  console.log(chalk.yellow("\n  Warning: Custom app tokens are being deprecated by Shopify."));
  console.log(chalk.yellow("  Consider using OAuth via the Partner Dashboard instead.\n"));
  console.log(
    chalk.bold("  To get your Shopify Admin API access token:\n")
  );
  console.log(
    chalk.dim(
      "  0. In Shopify Admin, go to Settings > Apps and sales channels > Develop apps"
    )
  );
  console.log(
    chalk.dim(
      '     If you see "Allow custom app development", click it to enable (requires store owner)'
    )
  );
  console.log(
    chalk.dim(
      "  1. Click 'Create an app' (opening in browser)"
    )
  );
  console.log(
    chalk.dim("  2. Name it 'Marketing OS' and click 'Create app'")
  );
  console.log(
    chalk.dim("  3. Click 'Configure Admin API scopes'")
  );
  console.log(chalk.dim("  4. Enable these scopes:"));
  console.log(
    chalk.cyan("     - read_products, write_products")
  );
  console.log(chalk.cyan("     - read_orders, read_customers"));
  console.log(chalk.cyan("     - read_analytics, read_inventory"));
  console.log(
    chalk.cyan("     - read_marketing_events, write_marketing_events")
  );
  console.log(chalk.dim("  5. Click 'Save' then 'Install app'"));
  console.log(
    chalk.dim(
      "  6. Copy the 'Admin API access token' (shown only once — save it securely)"
    )
  );
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
  "write_marketing_events",
];

export function formatScopes(): string {
  return REQUIRED_SCOPES.join(", ");
}

/**
 * Validate Shopify access token format.
 * Accepts both legacy Admin API tokens (shpat_), custom app tokens (shpca_),
 * and OAuth offline tokens which may not have a known prefix.
 */
export function validateShopifyToken(token: string): {
  valid: boolean;
  error?: string;
} {
  if (!token) {
    return { valid: false, error: "Access token is required" };
  }

  // Shopify Admin API tokens: shpat_ (legacy/custom app), shpca_ (newer custom app)
  // OAuth offline tokens may use other prefixes — accept any non-empty token
  // but warn if the prefix is unrecognized
  const knownPrefixes = ["shpat_", "shpca_", "shpua_"];
  const hasKnownPrefix = knownPrefixes.some((p) => token.startsWith(p));

  if (!hasKnownPrefix && token.length < 20) {
    return {
      valid: false,
      error:
        "Access token looks too short. Expected a Shopify Admin API token (starts with shpat_ or shpca_)",
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
    const apiUrl = `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}/shop.json`;

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
