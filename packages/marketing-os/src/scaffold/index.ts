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
    //
    // Every entry here is one a SCAFFOLDED STORE FAILS TO BUILD without. The
    // list is hand-maintained, so a page added to the template that imports a
    // new component compiles fine in this repo and breaks only in a fresh
    // store — the integration test's `next build` is the one place that
    // notices, and it had been red for three commits when this was found.
    {
      templatePath: path.join(templateDir, "agents/components/app-shell.tsx"),
      targetPath: path.join(targetDir, "agents/components/app-shell.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/approvals.tsx"),
      targetPath: path.join(targetDir, "agents/components/approvals.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/primitives.tsx"),
      targetPath: path.join(targetDir, "agents/components/primitives.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/chat/chat-panel.tsx"),
      targetPath: path.join(targetDir, "agents/components/chat/chat-panel.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/skills/skills-admin.tsx"),
      targetPath: path.join(targetDir, "agents/components/skills/skills-admin.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/provider-connections.ts"),
      targetPath: path.join(targetDir, "agents/lib/provider-connections.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/shopify.ts"),
      targetPath: path.join(targetDir, "agents/lib/shopify.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/skill-enablements.ts"),
      targetPath: path.join(targetDir, "agents/lib/skill-enablements.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/skills-catalog.ts"),
      targetPath: path.join(targetDir, "agents/lib/skills-catalog.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/chat/conversation-sidebar.tsx"),
      targetPath: path.join(targetDir, "agents/components/chat/conversation-sidebar.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/chat/gen-ui.tsx"),
      targetPath: path.join(targetDir, "agents/components/chat/gen-ui.tsx"),
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
      templatePath: path.join(templateDir, "agents/src/mastra/storage.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/storage.ts"),
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
    // Explicit runtime coverage: no store artifacts, credentials, or config.
    {
      templatePath: path.join(templateDir, "agents/.mcp.json"),
      targetPath: path.join(targetDir, "agents/.mcp.json"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/CLAUDE.md"),
      targetPath: path.join(targetDir, "agents/CLAUDE.md"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/actions/execute/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/actions/execute/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/admin/migrate/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/admin/migrate/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/brand-image/[id]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/brand-image/[id]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/conversations/[id]/messages/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/conversations/[id]/messages/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/conversations/[id]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/conversations/[id]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/conversations/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/conversations/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/cron/email/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/cron/email/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/cron/offer-review/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/cron/offer-review/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/cron/research/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/cron/research/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/cron/social/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/cron/social/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/design-surfaces/export/[fileId]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/design-surfaces/export/[fileId]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/design-surfaces/studio-session/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/design-surfaces/studio-session/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/email/asset/[id]/[name]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/email/asset/[id]/[name]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/email/headline/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/email/headline/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/email/preview/[id]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/email/preview/[id]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/email/review-notes/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/email/review-notes/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/email/review-approvals/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/email/review-approvals/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/klaviyo/connect-key/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/klaviyo/connect-key/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/mcp/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/mcp/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/offers/deploy/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/offers/deploy/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/offers/reallocate/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/offers/reallocate/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/proposals/dispatch/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/proposals/dispatch/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/skill-enablements/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/skill-enablements/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/social/generation/input/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/social/generation/input/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/social/review-notes/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/social/review-notes/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/surfaces/capture/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/surfaces/capture/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/surfaces/events/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/surfaces/events/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/surfaces/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/surfaces/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/auth/callback/route.ts"),
      targetPath: path.join(targetDir, "agents/app/auth/callback/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/brand/[slug]/file/[kind]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/brand/[slug]/file/[kind]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/brand/[slug]/llms.txt/route.ts"),
      targetPath: path.join(targetDir, "agents/app/brand/[slug]/llms.txt/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/brand/[slug]/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/brand/[slug]/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/brand/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/brand/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/calendar/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/calendar/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/email/campaigns/[id]/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/email/campaigns/[id]/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/email/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/email/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/playbooks/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/playbooks/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/review/email/[id]/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/review/email/[id]/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/review/email/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/review/email/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/review/generation/[id]/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/review/generation/[id]/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/review/social/[id]/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/review/social/[id]/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/review/social/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/review/social/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/social/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/social/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/social/posts/[id]/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/social/posts/[id]/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/studio/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/studio/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/calendar/calendar-view.tsx"),
      targetPath: path.join(targetDir, "agents/components/calendar/calendar-view.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/copy-link.tsx"),
      targetPath: path.join(targetDir, "agents/components/copy-link.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/email/campaign-performance.tsx"),
      targetPath: path.join(targetDir, "agents/components/email/campaign-performance.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/email/performance.tsx"),
      targetPath: path.join(targetDir, "agents/components/email/performance.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/review/email-review.tsx"),
      targetPath: path.join(targetDir, "agents/components/review/email-review.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/review/sheet-grid.tsx"),
      targetPath: path.join(targetDir, "agents/components/review/sheet-grid.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/review/social-review.tsx"),
      targetPath: path.join(targetDir, "agents/components/review/social-review.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/ui/avatar.tsx"),
      targetPath: path.join(targetDir, "agents/components/ui/avatar.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/ui/dropdown-menu.tsx"),
      targetPath: path.join(targetDir, "agents/components/ui/dropdown-menu.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/actions/gate-client.ts"),
      targetPath: path.join(targetDir, "agents/lib/actions/gate-client.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/actions/propose.ts"),
      targetPath: path.join(targetDir, "agents/lib/actions/propose.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/actions/hash.ts"),
      targetPath: path.join(targetDir, "agents/lib/actions/hash.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/actions/registry.ts"),
      targetPath: path.join(targetDir, "agents/lib/actions/registry.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/actions/types.ts"),
      targetPath: path.join(targetDir, "agents/lib/actions/types.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/broker-client.ts"),
      targetPath: path.join(targetDir, "agents/lib/broker-client.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/calendar.ts"),
      targetPath: path.join(targetDir, "agents/lib/calendar.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/calendar/console-data.ts"),
      targetPath: path.join(targetDir, "agents/lib/calendar/console-data.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/calendar/review-routes.ts"),
      targetPath: path.join(targetDir, "agents/lib/calendar/review-routes.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/calendar/routes.ts"),
      targetPath: path.join(targetDir, "agents/lib/calendar/routes.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/connector-auth.ts"),
      targetPath: path.join(targetDir, "agents/lib/connector-auth.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/cron-frame.ts"),
      targetPath: path.join(targetDir, "agents/lib/cron-frame.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/adapter.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/adapter.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/compose.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/compose.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/config.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/config.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/cookie-domain.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/cookie-domain.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/dtcg.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/dtcg.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/library-source.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/library-source.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/library.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/library.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/materialize.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/materialize.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/penpot-library.d.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/penpot-library.d.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/rpc.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/rpc.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/surface.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/surface.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/tenancy.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/tenancy.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/design-surfaces/types.ts"),
      targetPath: path.join(targetDir, "agents/lib/design-surfaces/types.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email-assembly/assemble.ts"),
      targetPath: path.join(targetDir, "agents/lib/email-assembly/assemble.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email-assembly/compose.ts"),
      targetPath: path.join(targetDir, "agents/lib/email-assembly/compose.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email-assembly/css.ts"),
      targetPath: path.join(targetDir, "agents/lib/email-assembly/css.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email-assembly/extract.ts"),
      targetPath: path.join(targetDir, "agents/lib/email-assembly/extract.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email-assembly/index.ts"),
      targetPath: path.join(targetDir, "agents/lib/email-assembly/index.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email-assembly/invariants.ts"),
      targetPath: path.join(targetDir, "agents/lib/email-assembly/invariants.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email-assembly/renderers.ts"),
      targetPath: path.join(targetDir, "agents/lib/email-assembly/renderers.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email-assembly/types.ts"),
      targetPath: path.join(targetDir, "agents/lib/email-assembly/types.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/actions.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/artifacts.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/artifacts.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/artist-profile.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/artist-profile.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/assemble.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/assemble.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/audience.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/audience.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/console-data.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/console-data.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/discount-refs.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/discount-refs.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/enablement.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/enablement.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/hero.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/hero.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/index-sync.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/index-sync.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/instructions.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/instructions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/klaviyo-client.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/klaviyo-client.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/leaning-mockups.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/leaning-mockups.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/plan.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/plan.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/product-prices.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/product-prices.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/register-actions.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/register-actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/repo.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/repo.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/retrospective.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/retrospective.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/review-links.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/review-links.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/next-step.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/next-step.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/refine.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/refine.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/review-note-shape.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/review-note-shape.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/review-notes.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/review-notes.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/segment-actions.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/segment-actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/segments.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/segments.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/tools.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/tools.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/types.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/types.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/email/wall-sets.ts"),
      targetPath: path.join(targetDir, "agents/lib/email/wall-sets.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/ga4.ts"),
      targetPath: path.join(targetDir, "agents/lib/ga4.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/imagery/palette.ts"),
      targetPath: path.join(targetDir, "agents/lib/imagery/palette.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/imagery/resolve.ts"),
      targetPath: path.join(targetDir, "agents/lib/imagery/resolve.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/mcp/zod-schema.ts"),
      targetPath: path.join(targetDir, "agents/lib/mcp/zod-schema.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/migrations/bundled.ts"),
      targetPath: path.join(targetDir, "agents/lib/migrations/bundled.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/migrations/run.ts"),
      targetPath: path.join(targetDir, "agents/lib/migrations/run.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/platform-db.ts"),
      targetPath: path.join(targetDir, "agents/lib/platform-db.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/proxy-auth.ts"),
      targetPath: path.join(targetDir, "agents/lib/proxy-auth.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/review/note-shape.ts"),
      targetPath: path.join(targetDir, "agents/lib/review/note-shape.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/review/notes.ts"),
      targetPath: path.join(targetDir, "agents/lib/review/notes.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/shopify/discount-actions.ts"),
      targetPath: path.join(targetDir, "agents/lib/shopify/discount-actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/skill-kit/action.ts"),
      targetPath: path.join(targetDir, "agents/lib/skill-kit/action.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/skill-kit/front-matter.ts"),
      targetPath: path.join(targetDir, "agents/lib/skill-kit/front-matter.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/skill-kit/index.ts"),
      targetPath: path.join(targetDir, "agents/lib/skill-kit/index.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/skill-kit/provenance.ts"),
      targetPath: path.join(targetDir, "agents/lib/skill-kit/provenance.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/skill-kit/repo.ts"),
      targetPath: path.join(targetDir, "agents/lib/skill-kit/repo.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/skill-kit/tool.ts"),
      targetPath: path.join(targetDir, "agents/lib/skill-kit/tool.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/generation-authority.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/generation-authority.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/generation-carousel.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/generation-carousel.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/generation-export.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/generation-export.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/social/carousel/render/[id]/[index]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/social/carousel/render/[id]/[index]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/social/carousel/review-notes/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/social/carousel/review-notes/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/social/generation/export/[id]/[variant]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/social/generation/export/[id]/[variant]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/generation-delivery.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/generation-delivery.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/scene-composite.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/scene-composite.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/social/generation/render/[id]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/social/generation/render/[id]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/generation-input.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/generation-input.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/generation-review.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/generation-review.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/generation-plan.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/generation-plan.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/production-recipes.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/production-recipes.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/social-production.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/social-production.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/production-context.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/production-context.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/actions.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/archetype-surface.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/archetype-surface.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/artifacts.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/artifacts.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/authoring.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/authoring.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/catalog-subjects.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/catalog-subjects.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/channels/index.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/channels/index.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/channels/instagram.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/channels/instagram.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/channels/refresh.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/channels/refresh.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/channels/threads.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/channels/threads.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/claims.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/claims.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/concept-tools.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/concept-tools.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/concepts.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/concepts.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/console-data.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/console-data.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/graph-subjects.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/graph-subjects.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/index-sync.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/index-sync.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/instructions.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/instructions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/palette.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/palette.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/projection.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/projection.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/reference.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/reference.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/social/carousel/publishing/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/social/carousel/publishing/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/review/social-publishing.tsx"),
      targetPath: path.join(targetDir, "agents/components/review/social-publishing.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/calendar-reconcile.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/calendar-reconcile.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/workflow.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/workflow.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/calendar/visibility.ts"),
      targetPath: path.join(targetDir, "agents/lib/calendar/visibility.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/video-assets.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/video-assets.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/generation-video.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/generation-video.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/schedule-batch.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/schedule-batch.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/social/scheduling/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/social/scheduling/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/components/review/social-scheduling.tsx"),
      targetPath: path.join(targetDir, "agents/components/review/social-scheduling.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/social/schedule/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/social/schedule/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/generation-publishing.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/generation-publishing.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/publish-lock.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/publish-lock.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/review-operator.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/review-operator.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/register-actions.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/register-actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/repo.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/repo.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/resolve.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/resolve.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/review-links.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/review-links.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/scaffold.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/scaffold.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/surface-style.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/surface-style.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/tools.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/tools.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/social/types.ts"),
      targetPath: path.join(targetDir, "agents/lib/social/types.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/store-repo/app-auth.ts"),
      targetPath: path.join(targetDir, "agents/lib/store-repo/app-auth.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/store-repo/assets.ts"),
      targetPath: path.join(targetDir, "agents/lib/store-repo/assets.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/store-repo/github.ts"),
      targetPath: path.join(targetDir, "agents/lib/store-repo/github.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/store-repo/index.ts"),
      targetPath: path.join(targetDir, "agents/lib/store-repo/index.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/critics.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/critics.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/explore.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/explore.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/voice.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/voice.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/graph-context.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/graph-context.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/index.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/index.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/narrative.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/narrative.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/plan.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/plan.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/schemas.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/schemas.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/types.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/types.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/tenant-context.ts"),
      targetPath: path.join(targetDir, "agents/lib/tenant-context.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/public/apple-touch-icon.png"),
      targetPath: path.join(targetDir, "agents/public/apple-touch-icon.png"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/public/favicon.ico"),
      targetPath: path.join(targetDir, "agents/public/favicon.ico"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/public/icon-512.png"),
      targetPath: path.join(targetDir, "agents/public/icon-512.png"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/backfill-artifacts-to-git.ts"),
      targetPath: path.join(targetDir, "agents/scripts/backfill-artifacts-to-git.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/scripts/bundle-migrations.mjs"),
      targetPath: path.join(targetDir, "agents/scripts/bundle-migrations.mjs"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/agents/brand-definition-agent.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/agents/brand-definition-agent.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/brand/candidates.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/brand/candidates.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/brand/deep-research.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/brand/deep-research.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/brand/portal.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/brand/portal.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/brand/store.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/brand/store.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/compile.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/compile.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/default-model.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/default-model.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/index.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/index.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/introspect.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/introspect.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/mcp-prompts.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/mcp-prompts.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/mcp-resources.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/mcp-resources.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/query/ga4-plan.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/query/ga4-plan.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/query/index.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/query/index.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/query/klaviyo-plan.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/query/klaviyo-plan.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/query/shopify-plan.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/query/shopify-plan.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/query/time.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/query/time.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/query/types.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/query/types.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/query/validate.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/query/validate.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/semantics/types.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/semantics/types.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/storyboard-model.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/storyboard-model.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tenant-storage.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tenant-storage.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/actions.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/brand-design.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/brand-design.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/brand-soul.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/brand-soul.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/chart-tools.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/chart-tools.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/design-library.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/design-library.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/design-surfaces.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/design-surfaces.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/email-authoring.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/email-authoring.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/email.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/email.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/external-mcp.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/external-mcp.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/imagery.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/imagery.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/semantics.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/semantics.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/social-compose.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/social-compose.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/social-generation.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/social-generation.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/social-graph.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/social-graph.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/social.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/social.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/storyboard.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/storyboard.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "supabase/migrations/00000000000001_init_marketing_os.sql"),
      targetPath: path.join(targetDir, "supabase/migrations/00000000000001_init_marketing_os.sql"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "supabase/migrations/00000000000002_user_signup_trigger.sql"),
      targetPath: path.join(targetDir, "supabase/migrations/00000000000002_user_signup_trigger.sql"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "supabase/migrations/008_email_review_notes.sql"),
      targetPath: path.join(targetDir, "supabase/migrations/008_email_review_notes.sql"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "supabase/migrations/009_pack_social.sql"),
      targetPath: path.join(targetDir, "supabase/migrations/009_pack_social.sql"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "supabase/migrations/010_pack_social_group_key.sql"),
      targetPath: path.join(targetDir, "supabase/migrations/010_pack_social_group_key.sql"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "supabase/migrations/011_review_notes.sql"),
      targetPath: path.join(targetDir, "supabase/migrations/011_review_notes.sql"),
      overwrite: "skip",
    },
    // Empty surface defaults on fresh installs; existing store config is preserved.
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/reviews.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/reviews.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/config/surfaces.json"),
      targetPath: path.join(targetDir, "agents/config/surfaces.json"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/config/surfaces.example.json"),
      targetPath: path.join(targetDir, "agents/config/surfaces.example.json"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/api/social/assets/[shop]/[name]/route.ts"),
      targetPath: path.join(targetDir, "agents/app/api/social/assets/[shop]/[name]/route.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/assets.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/assets.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/realization.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/realization.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/storyboard/register-actions.ts"),
      targetPath: path.join(targetDir, "agents/lib/storyboard/register-actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/app/review/storyboard/[id]/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/review/storyboard/[id]/page.tsx"),
      overwrite: "skip",
    },
    // Current runtime additions from the offers package.
    {
      templatePath: path.join(templateDir, "agents/app/offers/page.tsx"),
      targetPath: path.join(targetDir, "agents/app/offers/page.tsx"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/attribution-client.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/attribution-client.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/artifacts.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/artifacts.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/repo.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/repo.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/register-actions.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/register-actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/types.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/types.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/decision.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/decision.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/gates.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/gates.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/actions.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/actions.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/tools.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/tools.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/manifest.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/manifest.ts"),
      overwrite: "skip",
    },
    // Spec 34: manifest v2, design-harness helpers, incumbent audit rubric.
    {
      templatePath: path.join(templateDir, "agents/lib/offers/schema-v2.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/schema-v2.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/manifest-v2.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/manifest-v2.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/gates-v2.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/gates-v2.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/harness.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/harness.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/audit.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/audit.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/capture-tags.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/capture-tags.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/lib/offers/platform-client.ts"),
      targetPath: path.join(targetDir, "agents/lib/offers/platform-client.ts"),
      overwrite: "skip",
    },
    {
      templatePath: path.join(templateDir, "agents/src/mastra/tools/offers.ts"),
      targetPath: path.join(targetDir, "agents/src/mastra/tools/offers.ts"),
      overwrite: "skip",
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
