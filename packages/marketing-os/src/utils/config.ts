/**
 * Configuration file reader/writer for marketing-os.config.json
 * Handles reading, writing, and validation of the Marketing OS configuration
 */

import fs from "fs-extra";
import path from "path";

/**
 * Integration configuration type
 */
export interface IntegrationConfig {
  id: string;
  name: string;
  enabled: boolean;
  credentials?: Record<string, string>;
}

/**
 * Marketing OS configuration schema
 */
export interface MarketingOSConfig {
  version: string;
  shopify: {
    storeUrl: string;
    storeName: string;
  };
  github: {
    repo: string;
    owner: string;
    repoName: string;
  };
  supabase?: {
    url: string;
    projectRef: string;
  };
  admin: {
    email: string;
  };
  integrations: IntegrationConfig[];
  agents: {
    enabled: boolean;
    deployUrl?: string;
  };
  createdAt: string;
  lastUpdated: string;
}

/**
 * Default config file name
 */
export const CONFIG_FILE_NAME = "marketing-os.config.json";

/**
 * Create a new configuration object with default values
 */
export function createDefaultConfig(
  storeUrl: string,
  repo: string,
  adminEmail: string,
  supabaseUrl?: string
): MarketingOSConfig {
  const [owner = "", repoName = repo] = repo.includes("/") ? repo.split("/") : ["", repo];
  const storeName = storeUrl.replace(".myshopify.com", "");
  const now = new Date().toISOString();

  return {
    version: "1.0.0",
    shopify: {
      storeUrl,
      storeName,
    },
    github: {
      repo,
      owner,
      repoName,
    },
    supabase: supabaseUrl
      ? {
          url: supabaseUrl,
          projectRef: new URL(supabaseUrl).hostname.split(".")[0] || "",
        }
      : undefined,
    admin: {
      email: adminEmail,
    },
    integrations: [
      {
        id: "shopify-admin",
        name: "Shopify Admin API",
        enabled: true,
      },
    ],
    agents: {
      enabled: true,
    },
    createdAt: now,
    lastUpdated: now,
  };
}

/**
 * Read configuration from a directory
 */
export async function readConfig(dir: string): Promise<MarketingOSConfig | null> {
  const configPath = path.join(dir, CONFIG_FILE_NAME);

  try {
    if (!(await fs.pathExists(configPath))) {
      return null;
    }

    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content) as MarketingOSConfig;

    // Basic validation
    if (!config.version || !config.shopify || !config.github) {
      throw new Error("Invalid configuration structure");
    }

    return config;
  } catch (error) {
    throw new Error(
      `Failed to read configuration: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Write configuration to a directory
 */
export async function writeConfig(dir: string, config: MarketingOSConfig): Promise<void> {
  const configPath = path.join(dir, CONFIG_FILE_NAME);

  try {
    // Update lastUpdated timestamp
    config.lastUpdated = new Date().toISOString();

    // Ensure directory exists
    await fs.ensureDir(dir);

    // Write with pretty formatting
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to write configuration: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Update configuration partially
 */
export async function updateConfig(
  dir: string,
  updates: Partial<MarketingOSConfig>
): Promise<MarketingOSConfig> {
  const existing = await readConfig(dir);

  if (!existing) {
    throw new Error("Configuration file not found. Cannot update.");
  }

  const updated: MarketingOSConfig = {
    ...existing,
    ...updates,
    lastUpdated: new Date().toISOString(),
  };

  await writeConfig(dir, updated);
  return updated;
}

/**
 * Add or update an integration in the configuration
 */
export async function addIntegration(
  dir: string,
  integration: IntegrationConfig
): Promise<MarketingOSConfig> {
  const config = await readConfig(dir);

  if (!config) {
    throw new Error("Configuration file not found. Cannot add integration.");
  }

  // Find existing integration index
  const existingIndex = config.integrations.findIndex(i => i.id === integration.id);

  if (existingIndex >= 0) {
    // Update existing
    config.integrations[existingIndex] = integration;
  } else {
    // Add new
    config.integrations.push(integration);
  }

  await writeConfig(dir, config);
  return config;
}

/**
 * Remove an integration from the configuration
 */
export async function removeIntegration(dir: string, integrationId: string): Promise<MarketingOSConfig> {
  const config = await readConfig(dir);

  if (!config) {
    throw new Error("Configuration file not found. Cannot remove integration.");
  }

  config.integrations = config.integrations.filter(i => i.id !== integrationId);

  await writeConfig(dir, config);
  return config;
}

/**
 * Enable or disable an integration
 */
export async function toggleIntegration(
  dir: string,
  integrationId: string,
  enabled: boolean
): Promise<MarketingOSConfig> {
  const config = await readConfig(dir);

  if (!config) {
    throw new Error("Configuration file not found. Cannot toggle integration.");
  }

  const integration = config.integrations.find(i => i.id === integrationId);

  if (!integration) {
    throw new Error(`Integration '${integrationId}' not found in configuration.`);
  }

  integration.enabled = enabled;

  await writeConfig(dir, config);
  return config;
}

/**
 * Get integration by ID
 */
export async function getIntegration(
  dir: string,
  integrationId: string
): Promise<IntegrationConfig | null> {
  const config = await readConfig(dir);

  if (!config) {
    return null;
  }

  return config.integrations.find(i => i.id === integrationId) || null;
}

/**
 * List all integrations
 */
export async function listIntegrations(dir: string): Promise<IntegrationConfig[]> {
  const config = await readConfig(dir);

  if (!config) {
    return [];
  }

  return config.integrations;
}

/**
 * Set deployment URL
 */
export async function setDeployUrl(dir: string, url: string): Promise<MarketingOSConfig> {
  return updateConfig(dir, {
    agents: {
      enabled: true,
      deployUrl: url,
    },
  } as Partial<MarketingOSConfig>);
}

/**
 * Check if configuration file exists
 */
export async function configExists(dir: string): Promise<boolean> {
  const configPath = path.join(dir, CONFIG_FILE_NAME);
  return fs.pathExists(configPath);
}

/**
 * Validate configuration structure
 */
export function validateConfig(config: unknown): config is MarketingOSConfig {
  if (!config || typeof config !== "object") {
    return false;
  }

  const c = config as Record<string, unknown>;

  // Check required top-level fields
  if (typeof c.version !== "string") return false;
  if (!c.shopify || typeof c.shopify !== "object") return false;
  if (!c.github || typeof c.github !== "object") return false;
  if (!c.admin || typeof c.admin !== "object") return false;
  if (!Array.isArray(c.integrations)) return false;
  if (!c.agents || typeof c.agents !== "object") return false;

  // Check shopify fields
  const shopify = c.shopify as Record<string, unknown>;
  if (typeof shopify.storeUrl !== "string") return false;
  if (typeof shopify.storeName !== "string") return false;

  // Check github fields
  const github = c.github as Record<string, unknown>;
  if (typeof github.repo !== "string") return false;
  if (typeof github.owner !== "string") return false;
  if (typeof github.repoName !== "string") return false;

  // Check admin fields
  const admin = c.admin as Record<string, unknown>;
  if (typeof admin.email !== "string") return false;

  // Check agents fields
  const agents = c.agents as Record<string, unknown>;
  if (typeof agents.enabled !== "boolean") return false;

  return true;
}

/**
 * Migration helper: upgrade old config versions
 */
export async function migrateConfig(dir: string): Promise<MarketingOSConfig | null> {
  const config = await readConfig(dir);

  if (!config) {
    return null;
  }

  // Future: Add migration logic here when config version changes
  // For now, just ensure it has the current structure

  let migrated = false;

  // Example migration: ensure lastUpdated exists
  if (!config.lastUpdated) {
    config.lastUpdated = config.createdAt || new Date().toISOString();
    migrated = true;
  }

  if (migrated) {
    await writeConfig(dir, config);
  }

  return config;
}

/**
 * Export config as environment variables format (for .env files)
 */
export function configToEnv(config: MarketingOSConfig): Record<string, string> {
  const env: Record<string, string> = {
    SHOPIFY_STORE_URL: config.shopify.storeUrl,
    SHOPIFY_STORE_NAME: config.shopify.storeName,
    GITHUB_REPO: config.github.repo,
    ADMIN_EMAIL: config.admin.email,
  };

  if (config.supabase) {
    env.SUPABASE_URL = config.supabase.url;
  }

  if (config.agents.deployUrl) {
    env.DEPLOY_URL = config.agents.deployUrl;
  }

  return env;
}

/**
 * Pretty print configuration summary
 */
export function formatConfigSummary(config: MarketingOSConfig): string[] {
  const lines: string[] = [];

  lines.push("Marketing OS Configuration");
  lines.push("");
  lines.push(`Store: ${config.shopify.storeUrl}`);
  lines.push(`Repository: ${config.github.repo}`);
  lines.push(`Admin: ${config.admin.email}`);

  if (config.supabase) {
    lines.push(`Supabase: ${config.supabase.url}`);
  }

  if (config.agents.deployUrl) {
    lines.push(`Console: ${config.agents.deployUrl}`);
  }

  lines.push("");
  lines.push(`Integrations (${config.integrations.length}):`);
  config.integrations.forEach(integration => {
    const status = integration.enabled ? "enabled" : "disabled";
    lines.push(`  - ${integration.name} (${status})`);
  });

  lines.push("");
  lines.push(`Created: ${new Date(config.createdAt).toLocaleString()}`);
  lines.push(`Updated: ${new Date(config.lastUpdated).toLocaleString()}`);

  return lines;
}
