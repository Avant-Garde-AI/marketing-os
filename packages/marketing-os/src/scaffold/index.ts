/**
 * Scaffold orchestrator
 * Coordinates detection → render → write → install
 */

import path from "path";
import chalk from "chalk";
import ora from "ora";
import { detectShopifyTheme } from "./detect-theme.js";
import { renderTemplate } from "./render-template.js";
import { writeFiles, type FileToWrite } from "./write-files.js";
import { installDependencies } from "./install-deps.js";

export interface ScaffoldOptions {
  targetDir: string;
  storeName: string;
  storeUrl: string;
  repoFullName: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  adminEmail: string;
  enabledIntegrations: string[];
  verbose?: boolean;
}

export interface ScaffoldResult {
  success: boolean;
  filesCreated: string[];
  filesSkipped: string[];
  errors: string[];
}

/**
 * Main scaffolding orchestrator
 * Coordinates all scaffolding steps
 */
export async function scaffold(
  options: ScaffoldOptions
): Promise<ScaffoldResult> {
  const result: ScaffoldResult = {
    success: true,
    filesCreated: [],
    filesSkipped: [],
    errors: [],
  };

  const spinner = ora({ isSilent: !options.verbose }).start();

  try {
    // Step 1: Detect Shopify theme
    spinner.text = "Detecting Shopify theme...";
    const themeDetection = await detectShopifyTheme(options.targetDir);

    if (!themeDetection.isShopifyTheme) {
      result.success = false;
      result.errors.push(
        "Not a Shopify theme directory. Expected config/settings_schema.json and layout/theme.liquid"
      );
      spinner.fail(chalk.red("Theme detection failed"));
      return result;
    }

    spinner.succeed(
      chalk.green(
        `Detected Shopify theme${
          themeDetection.themeName ? `: ${themeDetection.themeName}` : ""
        }`
      )
    );

    // Step 2: Prepare template variables
    spinner.start("Preparing template variables...");
    const templateVars = {
      storeName: options.storeName,
      storeUrl: options.storeUrl,
      repoFullName: options.repoFullName,
      supabaseUrl: options.supabaseUrl || "",
      supabaseAnonKey: options.supabaseAnonKey || "",
      adminEmail: options.adminEmail,
      enabledIntegrations: JSON.stringify(options.enabledIntegrations),
    };
    spinner.succeed(chalk.green("Template variables prepared"));

    // Step 3: Render templates
    spinner.start("Rendering templates...");
    const filesToWrite = await prepareFiles(options.targetDir, templateVars);
    spinner.succeed(chalk.green(`Rendered ${filesToWrite.length} templates`));

    // Step 4: Write files
    spinner.start("Writing files...");
    const writeResult = await writeFiles(filesToWrite, options.targetDir);
    result.filesCreated = writeResult.filesCreated;
    result.filesSkipped = writeResult.filesSkipped;

    if (writeResult.errors.length > 0) {
      result.errors.push(...writeResult.errors);
      result.success = false;
      spinner.fail(chalk.red("Some files could not be written"));
      return result;
    }

    spinner.succeed(
      chalk.green(
        `Created ${writeResult.filesCreated.length} files, skipped ${writeResult.filesSkipped.length}`
      )
    );

    // Step 5: Install dependencies
    spinner.start("Installing dependencies...");
    const agentsDir = path.join(options.targetDir, "agents");
    const installResult = await installDependencies(agentsDir, options.verbose);

    if (!installResult.success) {
      result.success = false;
      result.errors.push(
        `Dependency installation failed: ${installResult.error}`
      );
      spinner.fail(chalk.red("Dependency installation failed"));
      return result;
    }

    spinner.succeed(
      chalk.green(
        `Dependencies installed using ${installResult.packageManager}`
      )
    );

    spinner.succeed(chalk.green.bold("Scaffolding complete!"));
  } catch (error) {
    result.success = false;
    result.errors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    spinner.fail(chalk.red("Scaffolding failed"));
  }

  return result;
}

/**
 * Prepare the list of files to write
 * This maps template files to their target locations
 */
async function prepareFiles(
  targetDir: string,
  templateVars: import("./render-template.js").TemplateVariables
): Promise<FileToWrite[]> {
  const templateDir = path.join(
    new URL(import.meta.url).pathname,
    "../../../templates"
  );

  // Define all files to be scaffolded
  const files: FileToWrite[] = [
    // Root-level files
    {
      templatePath: path.join(templateDir, "CLAUDE.md.hbs"),
      targetPath: path.join(targetDir, "CLAUDE.md"),
      overwrite: "prompt",
    },
    {
      templatePath: path.join(templateDir, "marketing-os.config.json.hbs"),
      targetPath: path.join(targetDir, "marketing-os.config.json"),
      overwrite: "skip",
    },

    // Agents directory
    {
      templatePath: path.join(templateDir, "agents/package.json.hbs"),
      targetPath: path.join(targetDir, "agents/package.json"),
      overwrite: "abort",
    },
    {
      templatePath: path.join(templateDir, "agents/next.config.ts"),
      targetPath: path.join(targetDir, "agents/next.config.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/tsconfig.json"),
      targetPath: path.join(targetDir, "agents/tsconfig.json"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/tailwind.config.ts"),
      targetPath: path.join(targetDir, "agents/tailwind.config.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/postcss.config.mjs"),
      targetPath: path.join(targetDir, "agents/postcss.config.mjs"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/vercel.json"),
      targetPath: path.join(targetDir, "agents/vercel.json"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/.env.example.hbs"),
      targetPath: path.join(targetDir, "agents/.env.example"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/middleware.ts"),
      targetPath: path.join(targetDir, "agents/middleware.ts"),
      overwrite: "skip",
    },

    // App directory
    {
      templatePath: path.join(templateDir, "agents/app/globals.css"),
      targetPath: path.join(targetDir, "agents/app/globals.css"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/layout.tsx.hbs"),
      targetPath: path.join(targetDir, "agents/app/layout.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/login/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/login/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/chat/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/chat/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/skills/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/skills/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/activity/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/activity/page.tsx"),
      overwrite: "skip",
    },

    // API routes
    {
      templatePath: path.join(templateDir, "agents/app/api/chat/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/chat/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/app/api/skills/[skillId]/route.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/app/api/skills/[skillId]/route.ts"
      ),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/app/api/webhooks/github/route.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/app/api/webhooks/github/route.ts"
      ),
      overwrite: "skip",
    },

    // Lib directory
    {
      templatePath: path.join(templateDir, "agents/lib/utils.ts"),
      targetPath: path.join(targetDir, "agents/lib/utils.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/github.ts"),
      targetPath: path.join(targetDir, "agents/lib/github.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/skills.ts"),
      targetPath: path.join(targetDir, "agents/lib/skills.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/lib/supabase/client.ts.hbs"
      ),
      targetPath: path.join(targetDir, "agents/lib/supabase/client.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/lib/supabase/server.ts.hbs"
      ),
      targetPath: path.join(targetDir, "agents/lib/supabase/server.ts"),
      overwrite: "skip",
    },

    // Components
    {
      templatePath: path.join(templateDir, "agents/components/nav.tsx"),
      targetPath: path.join(targetDir, "agents/components/nav.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/header.tsx.hbs"),
      targetPath: path.join(targetDir, "agents/components/header.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/components/skill-card.tsx"
      ),
      targetPath: path.join(targetDir, "agents/components/skill-card.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/pr-card.tsx"),
      targetPath: path.join(targetDir, "agents/components/pr-card.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/components/metric-card.tsx"
      ),
      targetPath: path.join(targetDir, "agents/components/metric-card.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/components/chat/marketing-chat.tsx"
      ),
      targetPath: path.join(
        targetDir,
        "agents/components/chat/marketing-chat.tsx"
      ),
      overwrite: "skip",
    },

    // UI components
    {
      templatePath: path.join(
        templateDir,
        "agents/components/ui/button.tsx"
      ),
      targetPath: path.join(targetDir, "agents/components/ui/button.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/ui/card.tsx"),
      targetPath: path.join(targetDir, "agents/components/ui/card.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/ui/input.tsx"),
      targetPath: path.join(targetDir, "agents/components/ui/input.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/ui/badge.tsx"),
      targetPath: path.join(targetDir, "agents/components/ui/badge.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/ui/dialog.tsx"),
      targetPath: path.join(targetDir, "agents/components/ui/dialog.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/ui/tabs.tsx"),
      targetPath: path.join(targetDir, "agents/components/ui/tabs.tsx"),
      overwrite: "skip",
    },

    // Mastra
    {
      templatePath: path.join(templateDir, "agents/src/mastra/index.ts.hbs"),
      targetPath: path.join(targetDir, "agents/src/mastra/index.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/agents/marketing-agent.ts.hbs"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/agents/marketing-agent.ts"
      ),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/agents/creative-agent.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/agents/creative-agent.ts"
      ),
      overwrite: "skip",
    },

    // Tools
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/tools/shopify-admin.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/tools/shopify-admin.ts"
      ),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/tools/dispatch-to-github.ts.hbs"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/tools/dispatch-to-github.ts"
      ),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/tools/pr-status.ts"
      ),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/pr-status.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/tools/ga4-reporting.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/tools/ga4-reporting.ts"
      ),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/tools/meta-ads.ts"
      ),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/meta-ads.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/tools/google-ads.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/tools/google-ads.ts"
      ),
      overwrite: "skip",
    },

    // Skills
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/skills/store-health-check.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/skills/store-health-check.ts"
      ),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/skills/ad-copy-generator.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/skills/ad-copy-generator.ts"
      ),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/skills/weekly-digest.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/skills/weekly-digest.ts"
      ),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/skills/_registry.ts.hbs"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/skills/_registry.ts"
      ),
      overwrite: "skip",
    },

    // Workflows
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/workflows/weekly-review.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/workflows/weekly-review.ts"
      ),
      overwrite: "skip",
    },
    {
      templatePath: path.join(
        templateDir,
        "agents/src/mastra/workflows/campaign-launch.ts"
      ),
      targetPath: path.join(
        targetDir,
        "agents/src/mastra/workflows/campaign-launch.ts"
      ),
      overwrite: "skip",
    },

    // CLI scripts
    {
      templatePath: path.join(templateDir, "agents.sh"),
      targetPath: path.join(targetDir, "agents.sh"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/dev/setup.sh"),
      targetPath: path.join(targetDir, "agents/scripts/dev/setup.sh"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/dev/start.sh"),
      targetPath: path.join(targetDir, "agents/scripts/dev/start.sh"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/dev/clean.sh"),
      targetPath: path.join(targetDir, "agents/scripts/dev/clean.sh"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/deploy/build.sh"),
      targetPath: path.join(targetDir, "agents/scripts/deploy/build.sh"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/deploy/vercel.sh"),
      targetPath: path.join(targetDir, "agents/scripts/deploy/vercel.sh"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/deploy/preview.sh"),
      targetPath: path.join(targetDir, "agents/scripts/deploy/preview.sh"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/ops/doctor.sh"),
      targetPath: path.join(targetDir, "agents/scripts/ops/doctor.sh"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/ops/env.sh"),
      targetPath: path.join(targetDir, "agents/scripts/ops/env.sh"),
      overwrite: "skip",
    },

    // Docs
    {
      templatePath: path.join(templateDir, "docs/brand-voice.md.hbs"),
      targetPath: path.join(targetDir, "docs/brand-voice.md"),
      overwrite: "skip-dir",
    },
    {
      templatePath: path.join(templateDir, "docs/product-knowledge.md.hbs"),
      targetPath: path.join(targetDir, "docs/product-knowledge.md"),
      overwrite: "skip-dir",
    },
    {
      templatePath: path.join(templateDir, "docs/policies.md.hbs"),
      targetPath: path.join(targetDir, "docs/policies.md"),
      overwrite: "skip-dir",
    },

    // GitHub workflows
    {
      templatePath: path.join(
        templateDir,
        ".github/workflows/marketing-os-agent.yml"
      ),
      targetPath: path.join(
        targetDir,
        ".github/workflows/marketing-os-agent.yml"
      ),
      overwrite: "prompt",
    },
    {
      templatePath: path.join(
        templateDir,
        ".github/workflows/marketing-os-review.yml"
      ),
      targetPath: path.join(
        targetDir,
        ".github/workflows/marketing-os-review.yml"
      ),
      overwrite: "prompt",
    },
  ];

  // Render templates
  for (const file of files) {
    if (file.templatePath.endsWith(".hbs")) {
      file.content = await renderTemplate(file.templatePath, templateVars);
    }
  }

  return files;
}
