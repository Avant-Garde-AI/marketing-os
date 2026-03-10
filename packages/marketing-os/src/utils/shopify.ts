/**
 * Shopify utilities
 */

import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";

/**
 * Check if Shopify CLI is installed
 */
export async function isShopifyCLIInstalled(): Promise<boolean> {
  try {
    await execa("shopify", ["version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull theme from Shopify store
 */
export async function pullTheme(
  store: string,
  targetDir: string
): Promise<void> {
  const spinner = ora(`Pulling theme from ${store}...`).start();

  try {
    await execa(
      "shopify",
      ["theme", "pull", "--store", store, "--path", targetDir],
      { stdio: "pipe" }
    );

    spinner.succeed(chalk.green(`✓ Theme pulled from ${store}`));
  } catch (error) {
    spinner.fail(chalk.red("✗ Failed to pull theme"));
    throw error;
  }
}

/**
 * Validate Shopify store URL format
 */
export function validateStoreUrl(url: string): boolean {
  return /^[a-z0-9-]+\.myshopify\.com$/.test(url);
}

/**
 * Extract store name from URL
 */
export function extractStoreName(url: string): string {
  return url.replace(".myshopify.com", "").replace(/-/g, " ");
}
