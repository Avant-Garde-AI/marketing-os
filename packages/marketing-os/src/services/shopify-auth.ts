/**
 * Shopify Admin API authentication setup
 * Opens browser to Shopify admin for custom app creation
 */

import chalk from "chalk";
import open from "open";
import { execa } from "execa";

/**
 * Build Shopify admin URL for custom app creation
 */
export function getShopifyAppsUrl(storeUrl: string): string {
  // Convert store URL to admin URL
  // mystore.myshopify.com -> admin.shopify.com/store/mystore/settings/apps/development
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
 * Open Shopify admin for custom app creation
 */
export async function openShopifyAdmin(storeUrl: string): Promise<void> {
  const appsUrl = getShopifyAppsUrl(storeUrl);
  console.log(chalk.dim(`\n  Opening Shopify Admin in your browser...`));
  console.log(chalk.dim(`  URL: ${appsUrl}\n`));

  await open(appsUrl);
}

/**
 * Display instructions for creating a Shopify custom app
 */
export function displayShopifyInstructions(): void {
  console.log(chalk.bold("\n  =Ë To get your Shopify Admin API access token:\n"));
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
];

/**
 * Format scopes for display
 */
export function formatScopes(): string {
  return REQUIRED_SCOPES.join(", ");
}

/**
 * Validate Shopify access token format
 */
export function validateShopifyToken(token: string): {
  valid: boolean;
  error?: string;
} {
  if (!token) {
    return { valid: false, error: "Access token is required" };
  }

  // Shopify access tokens start with "shpat_" for admin tokens
  if (!token.startsWith("shpat_")) {
    return {
      valid: false,
      error: "Access token should start with 'shpat_' (Admin API access token)",
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
    const apiUrl = `https://${storeUrl}/admin/api/2024-01/shop.json`;

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

    const error = await response.json() as { errors?: string };
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
