/**
 * Shopify Admin API authentication setup
 * Supports both OAuth (recommended) and manual custom app token flows
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

/**
 * Build Shopify admin URL for custom app creation
 */
export function getShopifyAppsUrl(storeUrl: string): string {
  const storeName = storeUrl.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeName}/settings/apps/development`;
}

/**
 * Open Shopify admin for custom app creation
 */
export async function openShopifyAdmin(storeUrl: string): Promise<void> {
  const appsUrl = getShopifyAppsUrl(storeUrl);
  console.log(chalk.dim(`\n  Opening Shopify Admin in your browser...`));
  console.log(chalk.dim(`  URL: ${appsUrl}\n`));

  await open(appsUrl);
}

/**
 * Display instructions for creating a Shopify custom app (manual flow)
 */
export function displayShopifyInstructions(): void {
  console.log(
    chalk.bold("\n  To get your Shopify Admin API access token:\n")
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

/**
 * Required Shopify Admin API scopes for Marketing OS
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

/**
 * Format scopes for display
 */
export function formatScopes(): string {
  return REQUIRED_SCOPES.join(", ");
}

/**
 * Validate Shopify access token format.
 * Accepts both legacy Admin API tokens (shpat_) and custom app tokens (shpca_).
 * OAuth offline tokens may not have a known prefix, so we also accept those.
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
 * Test Shopify access token by making a simple API request
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
