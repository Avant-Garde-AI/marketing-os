/**
 * Scaffolding utilities
 */

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import chalk from "chalk";
import ora from "ora";
import { glob } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ScaffoldContext {
  storeName: string;
  storeUrl: string;
  supabaseUrl?: string;
  adminEmail?: string;
  repoFullName: string;
  enabledIntegrations: string[];
  dbPassword?: string;
}

/**
 * Detect if directory contains a Shopify theme
 */
export async function detectShopifyTheme(
  targetDir: string
): Promise<boolean> {
  const requiredFiles = [
    "config/settings_schema.json",
    "layout/theme.liquid",
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(targetDir, file);
    if (!(await fs.pathExists(filePath))) {
      return false;
    }
  }

  const templatesDir = path.join(targetDir, "templates");
  return await fs.pathExists(templatesDir);
}

/**
 * Get theme name from settings_schema.json
 */
export async function getThemeName(targetDir: string): Promise<string | null> {
  try {
    const schemaPath = path.join(targetDir, "config/settings_schema.json");
    const schema = await fs.readJson(schemaPath);
    return schema[0]?.theme_name || null;
  } catch {
    return null;
  }
}

/**
 * Check if agents directory already exists
 */
export async function checkForExistingInstall(
  targetDir: string
): Promise<boolean> {
  const agentsDir = path.join(targetDir, "agents");
  return await fs.pathExists(agentsDir);
}

/**
 * Render template with context
 */
function renderTemplate(template: string, context: ScaffoldContext): string {
  const compiled = Handlebars.compile(template);
  return compiled(context);
}

/**
 * Scaffold Marketing OS into target directory
 */
export async function scaffold(
  targetDir: string,
  context: ScaffoldContext
): Promise<void> {
  const spinner = ora("Scaffolding Marketing OS...").start();

  try {
    // Get template directory
    // __dirname in the built bundle points to dist/, so templates is at ../templates
    const templatesDir = path.resolve(__dirname, "../templates");

    // Copy agents directory
    spinner.text = "Creating /agents (Next.js + Mastra project)";
    const agentsSourceDir = path.join(templatesDir, "agents");
    const agentsTargetDir = path.join(targetDir, "agents");

    // Get all files in agents template
    const agentFiles = await glob("**/*", {
      cwd: agentsSourceDir,
      dot: true,
      nodir: true,
    });

    for (const file of agentFiles) {
      const sourcePath = path.join(agentsSourceDir, file);
      const targetPath = path.join(agentsTargetDir, file);

      await fs.ensureDir(path.dirname(targetPath));

      if (file.endsWith(".hbs")) {
        const content = await fs.readFile(sourcePath, "utf-8");
        const rendered = renderTemplate(content, context);
        const finalPath = targetPath.replace(/\.hbs$/, "");
        await fs.writeFile(finalPath, rendered, "utf-8");
      } else {
        await fs.copy(sourcePath, targetPath);
      }

      // Make scripts executable
      const resolvedTarget = file.endsWith(".hbs")
        ? targetPath.replace(/\.hbs$/, "")
        : targetPath;
      if (file.startsWith("scripts/") && file.endsWith(".sh")) {
        await fs.chmod(resolvedTarget, 0o755);
      }
    }

    // Copy agents.sh CLI to project root
    spinner.text = "Creating agents.sh CLI";
    const agentsShSource = path.join(templatesDir, "agents.sh");
    const agentsShTarget = path.join(targetDir, "agents.sh");
    if (await fs.pathExists(agentsShSource)) {
      await fs.copy(agentsShSource, agentsShTarget);
      await fs.chmod(agentsShTarget, 0o755);
    }

    // Create docs directory
    spinner.text = "Creating /docs";
    const docsSourceDir = path.join(templatesDir, "docs");
    const docsDir = path.join(targetDir, "docs");

    if (!(await fs.pathExists(docsDir))) {
      await fs.ensureDir(docsDir);

      // Process docs files (handle .hbs templates)
      const docFiles = await glob("**/*", {
        cwd: docsSourceDir,
        dot: true,
        nodir: true,
      });

      for (const file of docFiles) {
        const sourcePath = path.join(docsSourceDir, file);
        const targetPath = path.join(docsDir, file);

        if (file.endsWith(".hbs")) {
          const content = await fs.readFile(sourcePath, "utf-8");
          const rendered = renderTemplate(content, context);
          const finalPath = targetPath.replace(/\.hbs$/, "");
          await fs.writeFile(finalPath, rendered, "utf-8");
        } else {
          await fs.copy(sourcePath, targetPath);
        }
      }
    } else {
      spinner.info(chalk.dim("Skipping /docs (already exists)"));
    }

    // Create .github/workflows
    spinner.text = "Creating /.github/workflows";
    const workflowsDir = path.join(targetDir, ".github/workflows");
    await fs.ensureDir(workflowsDir);

    const workflowFiles = [
      "marketing-os-agent.yml",
      "marketing-os-review.yml",
    ];

    for (const file of workflowFiles) {
      // Try both .yml and .yml.hbs
      let sourcePath = path.join(templatesDir, ".github/workflows", file + ".hbs");
      let isTemplate = true;
      if (!(await fs.pathExists(sourcePath))) {
        sourcePath = path.join(templatesDir, ".github/workflows", file);
        isTemplate = false;
      }

      const targetPath = path.join(workflowsDir, file);

      if (await fs.pathExists(targetPath)) {
        // Prompt handled by caller
        spinner.warn(chalk.dim(`Skipping ${file} (already exists)`));
      } else {
        const content = await fs.readFile(sourcePath, "utf-8");
        const rendered = isTemplate ? renderTemplate(content, context) : content;
        await fs.writeFile(targetPath, rendered, "utf-8");
      }
    }

    // Create CLAUDE.md
    spinner.text = "Creating CLAUDE.md";
    const claudeMdPath = path.join(targetDir, "CLAUDE.md");
    if (!(await fs.pathExists(claudeMdPath))) {
      // Try both CLAUDE.md.hbs and CLAUDE.md
      let claudeMdTemplatePath = path.join(templatesDir, "CLAUDE.md.hbs");
      if (!(await fs.pathExists(claudeMdTemplatePath))) {
        claudeMdTemplatePath = path.join(templatesDir, "CLAUDE.md");
      }

      const claudeMdTemplate = await fs.readFile(claudeMdTemplatePath, "utf-8");
      const rendered = renderTemplate(claudeMdTemplate, context);
      await fs.writeFile(claudeMdPath, rendered, "utf-8");
    } else {
      spinner.warn(chalk.dim("Skipping CLAUDE.md (already exists)"));
    }

    // Copy supabase directory (migrations and seed)
    spinner.text = "Creating /supabase";
    const supabaseSourceDir = path.join(templatesDir, "supabase");
    const supabaseTargetDir = path.join(targetDir, "supabase");

    if (await fs.pathExists(supabaseSourceDir)) {
      const supabaseFiles = await glob("**/*", {
        cwd: supabaseSourceDir,
        dot: true,
        nodir: true,
      });

      for (const file of supabaseFiles) {
        const sourcePath = path.join(supabaseSourceDir, file);
        const targetPath = path.join(supabaseTargetDir, file);

        await fs.ensureDir(path.dirname(targetPath));

        if (file.endsWith(".hbs")) {
          const content = await fs.readFile(sourcePath, "utf-8");
          const rendered = renderTemplate(content, context);
          const finalPath = targetPath.replace(/\.hbs$/, "");
          await fs.writeFile(finalPath, rendered, "utf-8");
        } else {
          await fs.copy(sourcePath, targetPath);
        }
      }
    }

    // Create marketing-os.config.json
    spinner.text = "Creating marketing-os.config.json";
    const configPath = path.join(targetDir, "marketing-os.config.json");
    const config = {
      version: "0.1.0",
      store: {
        name: context.storeName,
        url: context.storeUrl,
      },
      integrations: context.enabledIntegrations,
      supabase: context.supabaseUrl
        ? {
            url: context.supabaseUrl,
          }
        : undefined,
      repository: context.repoFullName,
    };
    await fs.writeJson(configPath, config, { spaces: 2 });

    spinner.succeed(chalk.green("✓ Scaffolding complete"));
  } catch (error) {
    spinner.fail(chalk.red("✗ Scaffolding failed"));
    throw error;
  }
}

export interface EnvLocalConfig {
  anthropicKey: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  storeUrl: string;
  repoFullName: string;
  integrationCredentials: Record<string, Record<string, string>>;
}

/**
 * Write agents/.env.local with actual credential values.
 * This is the file Next.js loads for local development (gitignored).
 */
export async function writeEnvLocal(
  targetDir: string,
  config: EnvLocalConfig
): Promise<void> {
  const spinner = ora("Writing agents/.env.local...").start();

  try {
    const envPath = path.join(targetDir, "agents", ".env.local");

    const lines: string[] = [
      "# Generated by Marketing OS init — do not commit this file",
      "",
      "# Required",
      `ANTHROPIC_API_KEY=${config.anthropicKey}`,
      "",
    ];

    if (config.supabaseUrl && config.supabaseAnonKey) {
      lines.push(
        "# Supabase",
        `SUPABASE_URL=${config.supabaseUrl}`,
        `SUPABASE_ANON_KEY=${config.supabaseAnonKey}`,
      );
      if (config.supabaseServiceKey) {
        lines.push(`SUPABASE_SERVICE_ROLE_KEY=${config.supabaseServiceKey}`);
      }
      lines.push(
        `NEXT_PUBLIC_SUPABASE_URL=${config.supabaseUrl}`,
        `NEXT_PUBLIC_SUPABASE_ANON_KEY=${config.supabaseAnonKey}`,
        "",
      );
    }

    lines.push(
      "# Shopify",
      `SHOPIFY_STORE_URL=${config.storeUrl}`,
    );
    if (config.integrationCredentials.shopify?.accessToken) {
      lines.push(
        `SHOPIFY_ACCESS_TOKEN=${config.integrationCredentials.shopify.accessToken}`,
      );
    }
    lines.push("");

    lines.push(
      "# GitHub",
      `GITHUB_REPO=${config.repoFullName}`,
      "",
    );

    // Optional integrations
    if (config.integrationCredentials.ga4) {
      lines.push(
        "# GA4",
        `GA4_PROPERTY_ID=${config.integrationCredentials.ga4.propertyId}`,
        `GA4_CREDENTIALS_JSON=${config.integrationCredentials.ga4.credentialsJson}`,
        "",
      );
    }

    if (config.integrationCredentials.meta) {
      lines.push(
        "# Meta Ads",
        `META_ACCESS_TOKEN=${config.integrationCredentials.meta.accessToken}`,
        `META_AD_ACCOUNT_ID=${config.integrationCredentials.meta.adAccountId}`,
        "",
      );
    }

    if (config.integrationCredentials["google-ads"]) {
      lines.push(
        "# Google Ads",
        `GOOGLE_ADS_CUSTOMER_ID=${config.integrationCredentials["google-ads"].customerId}`,
        `GOOGLE_ADS_CREDENTIALS_JSON=${config.integrationCredentials["google-ads"].credentialsJson}`,
        "",
      );
    }

    if (config.integrationCredentials.klaviyo) {
      lines.push(
        "# Klaviyo",
        `KLAVIYO_API_KEY=${config.integrationCredentials.klaviyo.apiKey}`,
        "",
      );
    }

    await fs.writeFile(envPath, lines.join("\n"), "utf-8");
    spinner.succeed(chalk.green("✓ agents/.env.local created"));
  } catch (error) {
    spinner.fail(chalk.red("✗ Failed to write .env.local"));
    throw error;
  }
}

/**
 * Update seed.sql with admin credentials after database setup.
 * Called after we have the database password from `supabase link`.
 */
export async function updateSeedWithCredentials(
  targetDir: string,
  adminEmail: string,
  dbPassword: string
): Promise<void> {
  const seedPath = path.join(targetDir, "supabase", "seed.sql");

  // Read template from source
  const templatesDir = path.resolve(__dirname, "../templates");
  const templatePath = path.join(templatesDir, "supabase", "seed.sql.hbs");

  if (await fs.pathExists(templatePath)) {
    const template = await fs.readFile(templatePath, "utf-8");
    const compiled = Handlebars.compile(template);
    const rendered = compiled({ adminEmail, dbPassword });
    await fs.ensureDir(path.dirname(seedPath));
    await fs.writeFile(seedPath, rendered, "utf-8");
  }
}

/**
 * Install dependencies in agents directory
 */
export async function installDependencies(
  targetDir: string,
  packageManager: "npm" | "pnpm" | "yarn" = "npm"
): Promise<void> {
  const spinner = ora(`Installing dependencies with ${packageManager}...`).start();

  try {
    const { execa } = await import("execa");
    const agentsDir = path.join(targetDir, "agents");

    await execa(packageManager, ["install"], {
      cwd: agentsDir,
      stdio: "pipe",
    });

    spinner.succeed(chalk.green("✓ Dependencies installed"));
  } catch {
    spinner.fail(chalk.red("✗ Dependency installation failed"));
    console.error(
      chalk.yellow(
        "\nYou can install dependencies manually later by running:"
      )
    );
    console.error(chalk.cyan(`  cd agents && npm install\n`));
  }
}
