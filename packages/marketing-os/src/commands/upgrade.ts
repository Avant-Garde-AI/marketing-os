/**
 * upgrade command - Upgrade an existing Marketing OS installation
 * Updates templates, dependencies, and workflows while preserving user content
 */

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import ora from "ora";
import { confirm, select } from "@inquirer/prompts";
import { glob } from "glob";
import Handlebars from "handlebars";
import { CONFIG_FILE_NAME } from "../utils/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Current CLI version - should match package.json
const CLI_VERSION = "0.2.0";

export interface UpgradeOptions {
  force?: boolean;
  dryRun?: boolean;
  skipDeps?: boolean;
  verbose?: boolean;
  yes?: boolean;
}

interface FileUpdate {
  path: string;
  type: "create" | "update" | "skip";
  reason?: string;
}

interface UpgradeResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  filesUpdated: FileUpdate[];
  errors: string[];
}

/**
 * File categories for upgrade behavior
 */
const FILE_CATEGORIES = {
  // Always update without prompting (infrastructure)
  infrastructure: [
    "agents.sh",
    "agents/scripts/**/*",
    ".github/workflows/marketing-os-*.yml",
  ],

  // Update with user confirmation (may have customizations)
  templates: [
    "CLAUDE.md",
    "agents/next.config.ts",
    "agents/tsconfig.json",
    "agents/tailwind.config.ts",
    "agents/postcss.config.mjs",
  ],

  // Merge intelligently (preserve user additions)
  merge: [
    "agents/package.json",
  ],

  // Never touch (user content)
  protected: [
    "docs/**/*",
    "agents/.env",
    "agents/.env.local",
    "agents/src/mastra/skills/*.ts",
    "marketing-os.config.json",
  ],
};

/**
 * Built-in skills that can be updated
 */
const BUILTIN_SKILLS = [
  "ad-copy-generator.ts",
  "store-health-check.ts",
  "weekly-digest.ts",
];

/**
 * Compare semantic versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}

/**
 * Check if an upgrade is available
 */
function isUpgradeAvailable(currentVersion: string): boolean {
  return compareVersions(currentVersion, CLI_VERSION) < 0;
}

/**
 * Get template directory path
 */
function getTemplatesDir(): string {
  return path.resolve(__dirname, "../templates");
}

/**
 * Render a Handlebars template with context
 */
function renderTemplate(content: string, context: Record<string, string>): string {
  const template = Handlebars.compile(content);
  return template(context);
}

/**
 * Merge package.json files, preserving user additions
 */
function mergePackageJson(
  existing: Record<string, unknown>,
  template: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing };

  // Update dependencies (add new ones, update versions of existing)
  if (template.dependencies && typeof template.dependencies === "object") {
    merged.dependencies = {
      ...(existing.dependencies as Record<string, string> || {}),
      ...(template.dependencies as Record<string, string>),
    };
  }

  // Update devDependencies
  if (template.devDependencies && typeof template.devDependencies === "object") {
    merged.devDependencies = {
      ...(existing.devDependencies as Record<string, string> || {}),
      ...(template.devDependencies as Record<string, string>),
    };
  }

  // Update scripts (add new ones, don't overwrite existing)
  if (template.scripts && typeof template.scripts === "object") {
    const existingScripts = existing.scripts as Record<string, string> || {};
    const templateScripts = template.scripts as Record<string, string>;

    merged.scripts = { ...existingScripts };
    for (const [key, value] of Object.entries(templateScripts)) {
      if (!(key in existingScripts)) {
        (merged.scripts as Record<string, string>)[key] = value;
      }
    }
  }

  return merged;
}

/**
 * Check if a file matches any pattern in a list
 */
function matchesPattern(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const pattern of patterns) {
    // Simple glob matching
    const regexPattern = pattern
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\./g, "\\.");

    const regex = new RegExp(`^${regexPattern}$`);
    if (regex.test(normalizedPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if a skill is a built-in skill
 */
function isBuiltinSkill(filename: string): boolean {
  return BUILTIN_SKILLS.includes(filename);
}

/**
 * Main upgrade command
 */
export async function upgradeCommand(options: UpgradeOptions): Promise<void> {
  const workingDir = process.cwd();

  console.log(chalk.bold("\n┌─────────────────────────────────────────┐"));
  console.log(chalk.bold("│  Marketing OS Upgrade                   │"));
  console.log(chalk.bold("└─────────────────────────────────────────┘\n"));

  // Step 1: Verify this is a Marketing OS installation
  const configPath = path.join(workingDir, CONFIG_FILE_NAME);

  if (!(await fs.pathExists(configPath))) {
    console.log(chalk.red("✗ No Marketing OS installation found."));
    console.log(chalk.dim("  Run 'marketing-os init' to set up Marketing OS first."));
    return;
  }

  // Read config directly (support any format)
  let config: Record<string, unknown>;
  try {
    const content = await fs.readFile(configPath, "utf-8");
    config = JSON.parse(content);
  } catch {
    console.log(chalk.red("✗ Failed to read configuration file."));
    return;
  }

  // Step 2: Check versions
  const currentVersion = (config.version as string) || "0.1.0";
  const targetVersion = CLI_VERSION;

  console.log(chalk.dim(`Current version: ${currentVersion}`));
  console.log(chalk.dim(`CLI version: ${targetVersion}`));

  if (!isUpgradeAvailable(currentVersion)) {
    console.log(chalk.green("\n✓ Already up to date!"));
    return;
  }

  console.log(chalk.cyan(`\n→ Upgrade available: ${currentVersion} → ${targetVersion}\n`));

  // Step 3: Dry run analysis
  const spinner = ora("Analyzing installation...").start();
  const templatesDir = getTemplatesDir();

  const result: UpgradeResult = {
    success: false,
    fromVersion: currentVersion,
    toVersion: targetVersion,
    filesUpdated: [],
    errors: [],
  };

  // Prepare template context from existing config (handle both old and new formats)
  const shopify = config.shopify as Record<string, string> | undefined;
  const store = config.store as Record<string, string> | undefined;
  const github = config.github as Record<string, string> | undefined;
  const admin = config.admin as Record<string, string> | undefined;
  const supabase = config.supabase as Record<string, string> | undefined;
  const integrations = config.integrations as Array<{ id: string; enabled: boolean }> | Record<string, { enabled: boolean }> | undefined;

  // Extract enabled integrations (handle both array and object formats)
  let enabledIntegrationIds: string[] = [];
  if (Array.isArray(integrations)) {
    enabledIntegrationIds = integrations.filter(i => i.enabled).map(i => i.id);
  } else if (integrations && typeof integrations === "object") {
    enabledIntegrationIds = Object.entries(integrations)
      .filter(([_, v]) => (v as { enabled: boolean }).enabled)
      .map(([k]) => k);
  }

  const templateContext: Record<string, string> = {
    storeName: shopify?.storeName || store?.name || "store",
    storeUrl: shopify?.storeUrl || store?.url || "store.myshopify.com",
    repoFullName: github?.repo || (config.repository as string) || "owner/repo",
    adminEmail: admin?.email || "admin@example.com",
    supabaseUrl: supabase?.url || "",
    supabaseAnonKey: "",
    enabledIntegrations: JSON.stringify(enabledIntegrationIds),
  };

  // Analyze what needs to be updated
  const filesToUpdate: Array<{
    templatePath: string;
    targetPath: string;
    category: "infrastructure" | "templates" | "merge";
    isHbs: boolean;
  }> = [];

  try {
    // Get all template files
    const templateFiles = await glob("**/*", {
      cwd: templatesDir,
      nodir: true,
      dot: true,
    });

    for (const file of templateFiles) {
      const relativePath = file.replace(/\.hbs$/, "");
      const targetPath = path.join(workingDir, relativePath);
      const templatePath = path.join(templatesDir, file);

      // Skip protected files
      if (matchesPattern(relativePath, FILE_CATEGORIES.protected)) {
        // Exception: update built-in skills
        if (relativePath.includes("mastra/skills/")) {
          const filename = path.basename(relativePath);
          if (isBuiltinSkill(filename)) {
            filesToUpdate.push({
              templatePath,
              targetPath,
              category: "templates",
              isHbs: file.endsWith(".hbs"),
            });
          }
        }
        continue;
      }

      // Categorize the file
      let category: "infrastructure" | "templates" | "merge" = "templates";

      if (matchesPattern(relativePath, FILE_CATEGORIES.infrastructure)) {
        category = "infrastructure";
      } else if (matchesPattern(relativePath, FILE_CATEGORIES.merge)) {
        category = "merge";
      }

      filesToUpdate.push({
        templatePath,
        targetPath,
        category,
        isHbs: file.endsWith(".hbs"),
      });
    }

    spinner.succeed(chalk.green(`Found ${filesToUpdate.length} files to check`));

  } catch (error) {
    spinner.fail(chalk.red("Failed to analyze templates"));
    console.error(error);
    return;
  }

  // Step 4: Show what will be updated
  if (options.dryRun || options.verbose) {
    console.log(chalk.bold("\nFiles to be updated:\n"));

    const infraFiles = filesToUpdate.filter(f => f.category === "infrastructure");
    const templateFiles = filesToUpdate.filter(f => f.category === "templates");
    const mergeFiles = filesToUpdate.filter(f => f.category === "merge");

    if (infraFiles.length > 0) {
      console.log(chalk.cyan("Infrastructure (auto-update):"));
      infraFiles.slice(0, 10).forEach(f => {
        console.log(chalk.dim(`  • ${path.relative(workingDir, f.targetPath)}`));
      });
      if (infraFiles.length > 10) {
        console.log(chalk.dim(`  ... and ${infraFiles.length - 10} more`));
      }
    }

    if (templateFiles.length > 0) {
      console.log(chalk.yellow("\nTemplates (with confirmation):"));
      templateFiles.forEach(f => {
        console.log(chalk.dim(`  • ${path.relative(workingDir, f.targetPath)}`));
      });
    }

    if (mergeFiles.length > 0) {
      console.log(chalk.green("\nMerge (preserve your changes):"));
      mergeFiles.forEach(f => {
        console.log(chalk.dim(`  • ${path.relative(workingDir, f.targetPath)}`));
      });
    }

    console.log();
  }

  if (options.dryRun) {
    console.log(chalk.yellow("Dry run complete. No changes made."));
    return;
  }

  // Step 5: Confirm upgrade
  if (!options.yes && !options.force) {
    const shouldProceed = await confirm({
      message: `Upgrade from ${currentVersion} to ${targetVersion}?`,
      default: true,
    });

    if (!shouldProceed) {
      console.log(chalk.yellow("\nUpgrade cancelled."));
      return;
    }
  }

  // Step 6: Perform the upgrade
  const updateSpinner = ora("Upgrading...").start();

  for (const file of filesToUpdate) {
    const relativePath = path.relative(workingDir, file.targetPath);

    try {
      const targetExists = await fs.pathExists(file.targetPath);

      // Handle merge files specially
      if (file.category === "merge" && targetExists) {
        if (relativePath === "agents/package.json") {
          updateSpinner.text = `Merging ${relativePath}...`;

          const existingContent = await fs.readJson(file.targetPath);
          let templateContent = await fs.readFile(file.templatePath, "utf-8");

          if (file.isHbs) {
            templateContent = renderTemplate(templateContent, templateContext);
          }

          const templateJson = JSON.parse(templateContent);
          const merged = mergePackageJson(existingContent, templateJson);

          await fs.writeJson(file.targetPath, merged, { spaces: 2 });

          result.filesUpdated.push({
            path: relativePath,
            type: "update",
            reason: "merged dependencies",
          });
        }
        continue;
      }

      // Handle template files with confirmation
      if (file.category === "templates" && targetExists && !options.force) {
        if (!options.yes) {
          updateSpinner.stop();

          const action = await select({
            message: `${relativePath} exists. What would you like to do?`,
            choices: [
              { value: "update", name: "Update (overwrite with new version)" },
              { value: "skip", name: "Skip (keep existing file)" },
              { value: "backup", name: "Backup & Update (save .bak and update)" },
            ],
          });

          updateSpinner.start();

          if (action === "skip") {
            result.filesUpdated.push({
              path: relativePath,
              type: "skip",
              reason: "user skipped",
            });
            continue;
          }

          if (action === "backup") {
            await fs.copy(file.targetPath, `${file.targetPath}.bak`);
          }
        }
      }

      // Read and process template
      updateSpinner.text = `Updating ${relativePath}...`;

      let content = await fs.readFile(file.templatePath, "utf-8");

      if (file.isHbs) {
        content = renderTemplate(content, templateContext);
      }

      // Ensure directory exists
      await fs.ensureDir(path.dirname(file.targetPath));

      // Write file
      await fs.writeFile(file.targetPath, content, "utf-8");

      // Make shell scripts executable
      if (file.targetPath.endsWith(".sh")) {
        await fs.chmod(file.targetPath, 0o755);
      }

      result.filesUpdated.push({
        path: relativePath,
        type: targetExists ? "update" : "create",
      });

    } catch (error) {
      result.errors.push(
        `Failed to update ${relativePath}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  // Step 7: Update config version
  try {
    config.version = targetVersion;
    config.lastUpdated = new Date().toISOString();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (error) {
    result.errors.push(`Failed to update config: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // Step 8: Install dependencies if package.json was updated
  if (!options.skipDeps) {
    const packageJsonUpdated = result.filesUpdated.some(
      f => f.path === "agents/package.json" && f.type !== "skip"
    );

    if (packageJsonUpdated) {
      updateSpinner.text = "Installing updated dependencies...";

      try {
        const { execa } = await import("execa");
        const agentsDir = path.join(workingDir, "agents");

        // Detect package manager
        const hasPnpm = await fs.pathExists(path.join(agentsDir, "pnpm-lock.yaml"));
        const hasYarn = await fs.pathExists(path.join(agentsDir, "yarn.lock"));

        const pm = hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";

        await execa(pm, ["install"], { cwd: agentsDir, stdio: "pipe" });
      } catch {
        result.errors.push("Failed to install dependencies. Run 'npm install' in agents/ manually.");
      }
    }
  }

  updateSpinner.stop();

  // Step 9: Report results
  result.success = result.errors.length === 0;

  const created = result.filesUpdated.filter(f => f.type === "create").length;
  const updated = result.filesUpdated.filter(f => f.type === "update").length;
  const skipped = result.filesUpdated.filter(f => f.type === "skip").length;

  console.log();

  if (result.success) {
    console.log(chalk.green(`✓ Upgraded successfully: ${currentVersion} → ${targetVersion}`));
  } else {
    console.log(chalk.yellow(`⚠ Upgrade completed with errors`));
  }

  console.log(chalk.dim(`  Created: ${created} files`));
  console.log(chalk.dim(`  Updated: ${updated} files`));
  if (skipped > 0) {
    console.log(chalk.dim(`  Skipped: ${skipped} files`));
  }

  if (result.errors.length > 0) {
    console.log(chalk.red("\nErrors:"));
    result.errors.forEach(err => {
      console.log(chalk.red(`  • ${err}`));
    });
  }

  // Step 10: Post-upgrade instructions
  console.log(chalk.bold("\n📋 Post-upgrade checklist:\n"));
  console.log("  1. Review changes: " + chalk.cyan("git diff"));
  console.log("  2. Test locally: " + chalk.cyan("cd agents && npm run dev"));
  console.log("  3. Run diagnostics: " + chalk.cyan("marketing-os doctor"));
  console.log("  4. Commit changes: " + chalk.cyan("git add -A && git commit -m 'Upgrade Marketing OS'"));

  if (!options.skipDeps) {
    console.log("\n" + chalk.dim("Dependencies were automatically installed."));
  }
}
