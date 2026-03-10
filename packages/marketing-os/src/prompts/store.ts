/**
 * Store connection prompts
 * Handles Shopify store URL and GitHub repository selection
 */

import { input, select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  validateShopifyStoreUrl,
  checkShopifyCLI,
  listShopifyThemes,
} from "../services/shopify.js";
import { checkGitHubRepo } from "../services/github.js";

export interface StoreConnectionConfig {
  storeUrl: string;
  hasExistingRepo: boolean;
  repoName?: string;
  repoOrg?: string;
  repoFullName?: string;
  themeId?: string;
}

/**
 * Prompt for Shopify store URL
 */
export async function promptStoreUrl(): Promise<string> {
  const storeUrl = await input({
    message: "Shopify store URL:",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Store URL is required";
      }

      const validation = validateShopifyStoreUrl(value);
      if (!validation.valid) {
        return validation.error || "Invalid store URL";
      }

      return true;
    },
    transformer: (value: string) => {
      // Remove protocol and normalize
      return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
    },
  });

  // Return normalized URL
  const validation = validateShopifyStoreUrl(storeUrl);
  return validation.normalized || storeUrl;
}

/**
 * Prompt for existing repository choice
 */
export async function promptExistingRepo(): Promise<boolean> {
  return await select({
    message: "Do you have an existing theme repo on GitHub?",
    choices: [
      {
        name: "Yes — I'll enter the repo",
        value: true,
      },
      {
        name: "No — pull my theme and create a new repo",
        value: false,
      },
    ],
  });
}

/**
 * Prompt for GitHub repository (existing)
 */
export async function promptGitHubRepo(): Promise<string> {
  return await input({
    message: "GitHub repository (org/repo or URL):",
    validate: async (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Repository is required";
      }

      // Extract org/repo from URL or use as-is
      let repoPath = value;
      if (value.includes("github.com")) {
        const match = value.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
        if (match) {
          repoPath = `${match[1]}/${match[2]}`;
        }
      }

      // Validate format
      if (!/^[\w-]+\/[\w-]+$/.test(repoPath)) {
        return "Invalid format. Expected: org/repo";
      }

      // Check if repo exists
      const { exists, error } = await checkGitHubRepo(repoPath);
      if (!exists) {
        return error || "Repository not found. Make sure you have access.";
      }

      return true;
    },
    transformer: (value: string) => {
      // Extract and normalize repo path
      if (value.includes("github.com")) {
        const match = value.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
        if (match) {
          return `${match[1]}/${match[2]}`;
        }
      }
      return value;
    },
  });
}

/**
 * Prompt for new repository details
 */
export async function promptNewRepo(): Promise<{
  name: string;
  org: string;
}> {
  const name = await input({
    message: "GitHub repository name:",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Repository name is required";
      }

      if (!/^[\w-]+$/.test(value)) {
        return "Invalid name. Use only letters, numbers, hyphens, and underscores.";
      }

      return true;
    },
  });

  const org = await input({
    message: "GitHub org or username:",
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Organization or username is required";
      }

      if (!/^[\w-]+$/.test(value)) {
        return "Invalid name. Use only letters, numbers, hyphens, and underscores.";
      }

      return true;
    },
  });

  return { name, org };
}

/**
 * Prompt for theme selection (when pulling from Shopify)
 */
export async function promptThemeSelection(
  storeUrl: string
): Promise<string | undefined> {
  // Check if Shopify CLI is available
  const { installed } = await checkShopifyCLI();
  if (!installed) {
    console.log(
      chalk.yellow(
        "\nShopify CLI not found. Will pull the live theme by default."
      )
    );
    return undefined;
  }

  // List available themes
  const { success, themes } = await listShopifyThemes(storeUrl);
  if (!success || !themes || themes.length === 0) {
    console.log(chalk.yellow("\nCouldn't fetch themes. Will pull live theme."));
    return undefined;
  }

  // Ask if user wants to select a theme
  const shouldSelect = await confirm({
    message: "Select a specific theme to pull?",
    default: false,
  });

  if (!shouldSelect) {
    return undefined;
  }

  // Prompt for theme selection
  const themeId = await select({
    message: "Select theme:",
    choices: themes.map((theme) => ({
      name: `${theme.name} ${theme.role === "main" ? chalk.green("(live)") : ""}`,
      value: theme.id,
      description: `Role: ${theme.role}`,
    })),
  });

  return themeId;
}

/**
 * Complete store connection flow
 */
export async function promptStoreConnection(): Promise<StoreConnectionConfig> {
  console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────────────┐"));
  console.log(chalk.bold.cyan("│  Marketing OS Setup                              │"));
  console.log(chalk.bold.cyan("└─────────────────────────────────────────────────┘\n"));

  // Get store URL
  const storeUrl = await promptStoreUrl();

  // Check for existing repo
  const hasExistingRepo = await promptExistingRepo();

  let config: StoreConnectionConfig = {
    storeUrl,
    hasExistingRepo,
  };

  if (hasExistingRepo) {
    // Get existing repo details
    const repoFullName = await promptGitHubRepo();
    const [org, name] = repoFullName.split("/");

    config.repoFullName = repoFullName;
    config.repoOrg = org;
    config.repoName = name;
  } else {
    // Get new repo details
    const { name, org } = await promptNewRepo();

    config.repoName = name;
    config.repoOrg = org;
    config.repoFullName = `${org}/${name}`;

    // Optionally select theme
    const themeId = await promptThemeSelection(storeUrl);
    if (themeId) {
      config.themeId = themeId;
    }
  }

  return config;
}
