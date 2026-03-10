/**
 * Utility modules for create-marketing-os CLI
 * Exports logger, validators, and config management
 */

export * from "./logger";
export * from "./validate";
export * from "./config";
export * from "./prerequisites";
export * from "./github";
export * from "./shopify";
export * from "./vercel";
export * from "./scaffold";

// Re-export prompts with renamed IntegrationConfig to avoid conflict with config.ts
export {
  type StoreConfig,
  type RepoConfig,
  type ServiceConfig,
  type IntegrationConfig as PromptIntegrationConfig,
  promptStoreConfig,
  promptRepoConfig,
  promptServiceConfig,
  promptIntegrationConfig,
  promptDeploy,
} from "./prompts";
