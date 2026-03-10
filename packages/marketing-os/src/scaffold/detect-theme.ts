/**
 * Shopify theme detection
 * Checks for config/settings_schema.json and layout/theme.liquid
 */

import fs from "fs-extra";
import path from "path";

export interface ThemeDetectionResult {
  isShopifyTheme: boolean;
  themeName?: string;
  themeVersion?: string;
  missingFiles: string[];
}

/**
 * Detect if a directory contains a Shopify theme
 * Checks for required theme files and extracts theme metadata
 */
export async function detectShopifyTheme(
  dir: string
): Promise<ThemeDetectionResult> {
  const result: ThemeDetectionResult = {
    isShopifyTheme: false,
    missingFiles: [],
  };

  // Required files for a Shopify theme
  const requiredFiles = [
    "config/settings_schema.json",
    "layout/theme.liquid",
  ];

  // Check for required files
  for (const file of requiredFiles) {
    const filePath = path.join(dir, file);
    const exists = await fs.pathExists(filePath);

    if (!exists) {
      result.missingFiles.push(file);
    }
  }

  // If any required files are missing, it's not a valid Shopify theme
  if (result.missingFiles.length > 0) {
    return result;
  }

  // All required files exist - it's a Shopify theme
  result.isShopifyTheme = true;

  // Try to extract theme name from settings_schema.json
  try {
    const settingsPath = path.join(dir, "config/settings_schema.json");
    const settingsContent = await fs.readJson(settingsPath);

    // settings_schema.json is an array, look for theme_info section
    if (Array.isArray(settingsContent)) {
      const themeInfo = settingsContent.find(
        (section: any) => section.name === "theme_info"
      );

      if (themeInfo && themeInfo.theme_name) {
        result.themeName = themeInfo.theme_name;
      }

      if (themeInfo && themeInfo.theme_version) {
        result.themeVersion = themeInfo.theme_version;
      }
    }
  } catch {
    // If we can't parse settings_schema.json, that's okay
    // We still detected the theme based on file existence
  }

  // Try to detect theme name from config.yml (Dawn and other themes)
  try {
    const configPath = path.join(dir, "config.yml");
    if (await fs.pathExists(configPath)) {
      const configContent = await fs.readFile(configPath, "utf-8");
      const nameMatch = configContent.match(/^name:\s*(.+)$/m);
      if (nameMatch && !result.themeName) {
        result.themeName = nameMatch[1].trim();
      }
    }
  } catch {
    // Ignore config.yml parsing errors
  }

  return result;
}

/**
 * Check if the /agents directory already exists
 * If it does, we should abort to prevent overwriting
 */
export async function checkAgentsDirectory(dir: string): Promise<boolean> {
  const agentsPath = path.join(dir, "agents");
  return await fs.pathExists(agentsPath);
}

/**
 * Check if the /docs directory already exists
 * If it does, we should skip it to avoid overwriting user content
 */
export async function checkDocsDirectory(dir: string): Promise<boolean> {
  const docsPath = path.join(dir, "docs");
  return await fs.pathExists(docsPath);
}

/**
 * Check if specific workflow files already exist
 */
export async function checkWorkflowFiles(
  dir: string
): Promise<{ exists: boolean; files: string[] }> {
  const workflowDir = path.join(dir, ".github/workflows");
  const workflowFiles = [
    "marketing-os-agent.yml",
    "marketing-os-review.yml",
  ];

  const existingFiles: string[] = [];

  for (const file of workflowFiles) {
    const filePath = path.join(workflowDir, file);
    if (await fs.pathExists(filePath)) {
      existingFiles.push(file);
    }
  }

  return {
    exists: existingFiles.length > 0,
    files: existingFiles,
  };
}

/**
 * Check if CLAUDE.md already exists
 */
export async function checkClaudeFile(dir: string): Promise<boolean> {
  const claudePath = path.join(dir, "CLAUDE.md");
  return await fs.pathExists(claudePath);
}

/**
 * Validate that we're in a git repository
 * Required for the init command
 */
export async function isGitRepository(dir: string): Promise<boolean> {
  const gitPath = path.join(dir, ".git");
  return await fs.pathExists(gitPath);
}

/**
 * Get theme statistics for logging
 */
export async function getThemeStats(
  dir: string
): Promise<{
  templateCount: number;
  sectionCount: number;
  snippetCount: number;
}> {
  const stats = {
    templateCount: 0,
    sectionCount: 0,
    snippetCount: 0,
  };

  try {
    const templatesDir = path.join(dir, "templates");
    if (await fs.pathExists(templatesDir)) {
      const templates = await fs.readdir(templatesDir);
      stats.templateCount = templates.filter((f) =>
        f.endsWith(".liquid")
      ).length;
    }

    const sectionsDir = path.join(dir, "sections");
    if (await fs.pathExists(sectionsDir)) {
      const sections = await fs.readdir(sectionsDir);
      stats.sectionCount = sections.filter((f) => f.endsWith(".liquid")).length;
    }

    const snippetsDir = path.join(dir, "snippets");
    if (await fs.pathExists(snippetsDir)) {
      const snippets = await fs.readdir(snippetsDir);
      stats.snippetCount = snippets.filter((f) => f.endsWith(".liquid")).length;
    }
  } catch {
    // Ignore errors, return 0 counts
  }

  return stats;
}
