/**
 * Shopify CLI interactions
 * Handles theme pulling and validation
 */

import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";
import path from "path";

export interface ShopifyThemeInfo {
  isTheme: boolean;
  themeName?: string;
  themeVersion?: string;
  error?: string;
}

/**
 * Check if Shopify CLI is installed
 */
export async function checkShopifyCLI(): Promise<{
  installed: boolean;
  version?: string;
}> {
  try {
    const { stdout } = await execa("shopify", ["version"]);
    return {
      installed: true,
      version: stdout.trim(),
    };
  } catch {
    return {
      installed: false,
    };
  }
}

/**
 * Detect if a directory contains a Shopify theme
 */
export async function detectShopifyTheme(
  dir: string
): Promise<ShopifyThemeInfo> {
  try {
    const fs = await import("fs-extra");

    // Check for required Shopify theme files
    const configPath = path.join(dir, "config", "settings_schema.json");
    const layoutPath = path.join(dir, "layout", "theme.liquid");
    const templatesPath = path.join(dir, "templates");

    const hasConfig = await fs.pathExists(configPath);
    const hasLayout = await fs.pathExists(layoutPath);
    const hasTemplates = await fs.pathExists(templatesPath);

    if (!hasConfig || !hasLayout || !hasTemplates) {
      return {
        isTheme: false,
        error: "Not a valid Shopify theme directory",
      };
    }

    // Try to extract theme name from settings_schema.json
    try {
      const config = await fs.readJson(configPath);
      const themeInfo = config.find(
        (item: any) => item.name === "theme_info"
      );

      return {
        isTheme: true,
        themeName: themeInfo?.theme_name,
        themeVersion: themeInfo?.theme_version,
      };
    } catch {
      return {
        isTheme: true,
      };
    }
  } catch (error) {
    return {
      isTheme: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Pull a Shopify theme
 */
export async function pullShopifyTheme(
  store: string,
  targetDir: string,
  themeId?: string
): Promise<{ success: boolean; error?: string }> {
  const spinner = ora("Pulling Shopify theme...").start();

  try {
    const args = ["theme", "pull", "--store", store, "--path", targetDir];

    if (themeId) {
      args.push("--theme", themeId);
    } else {
      // Pull the live theme by default
      args.push("--live");
    }

    const { stderr } = await execa("shopify", args);

    if (stderr && stderr.includes("error")) {
      throw new Error(stderr);
    }

    spinner.succeed(`Theme pulled to ${chalk.cyan(targetDir)}`);

    return { success: true };
  } catch (error) {
    spinner.fail("Failed to pull Shopify theme");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List available themes for a store
 */
export async function listShopifyThemes(store: string): Promise<{
  success: boolean;
  themes?: Array<{ id: string; name: string; role: string }>;
  error?: string;
}> {
  const spinner = ora("Fetching available themes...").start();

  try {
    const { stdout } = await execa("shopify", [
      "theme",
      "list",
      "--store",
      store,
      "--json",
    ]);

    const themes = JSON.parse(stdout);

    spinner.succeed(`Found ${themes.length} theme${themes.length !== 1 ? "s" : ""}`);

    return {
      success: true,
      themes: themes.map((t: any) => ({
        id: t.id.toString(),
        name: t.name,
        role: t.role,
      })),
    };
  } catch (error) {
    spinner.fail("Failed to list themes");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validate Shopify store URL format
 */
export function validateShopifyStoreUrl(url: string): {
  valid: boolean;
  normalized?: string;
  error?: string;
} {
  // Remove protocol if present
  let normalized = url.replace(/^https?:\/\//, "");

  // Remove trailing slash
  normalized = normalized.replace(/\/$/, "");

  // Check if it matches mystore.myshopify.com pattern
  const pattern = /^[a-z0-9-]+\.myshopify\.com$/;

  if (!pattern.test(normalized)) {
    return {
      valid: false,
      error:
        "Invalid Shopify store URL. Expected format: mystore.myshopify.com",
    };
  }

  return {
    valid: true,
    normalized,
  };
}

/**
 * Check if Shopify CLI is authenticated for a store
 */
export async function isShopifyAuthenticated(store: string): Promise<boolean> {
  try {
    await execa("shopify", ["theme", "list", "--store", store]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticate Shopify CLI for a store
 */
export async function authenticateShopify(
  store: string
): Promise<{ success: boolean; error?: string }> {
  const spinner = ora(`Authenticating with ${store}...`).start();

  try {
    // The theme list command will trigger authentication if needed
    await execa("shopify", ["theme", "list", "--store", store]);

    spinner.succeed(`Authenticated with ${store}`);
    return { success: true };
  } catch (error) {
    spinner.fail("Failed to authenticate with Shopify");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Push theme to Shopify
 */
export async function pushShopifyTheme(
  store: string,
  sourceDir: string,
  themeId?: string
): Promise<{ success: boolean; error?: string }> {
  const spinner = ora("Pushing theme to Shopify...").start();

  try {
    const args = ["theme", "push", "--store", store, "--path", sourceDir];

    if (themeId) {
      args.push("--theme", themeId);
    }

    await execa("shopify", args);

    spinner.succeed("Theme pushed to Shopify");
    return { success: true };
  } catch (error) {
    spinner.fail("Failed to push theme");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
