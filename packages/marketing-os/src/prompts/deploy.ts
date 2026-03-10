/**
 * Deployment prompts
 * Handles Vercel deployment configuration
 */

import { confirm, select, input } from "@inquirer/prompts";
import chalk from "chalk";
import { checkVercelCLI } from "../services/vercel.js";

export interface DeployConfig {
  shouldDeploy: boolean;
  projectName?: string;
  production: boolean;
}

/**
 * Prompt whether to deploy to Vercel
 */
export async function promptShouldDeploy(): Promise<boolean> {
  // Check if Vercel CLI is installed
  const { installed } = await checkVercelCLI();

  if (!installed) {
    console.log(chalk.yellow("\n⚠ Vercel CLI not found"));
    console.log(chalk.gray("  Install with: npm i -g vercel"));

    const installNow = await confirm({
      message: "Install Vercel CLI now?",
      default: false,
    });

    if (installNow) {
      console.log(
        chalk.gray("\n  Please run: npm i -g vercel")
      );
      console.log(chalk.gray("  Then re-run this setup\n"));
      process.exit(0);
    }

    return false;
  }

  return await confirm({
    message: "Deploy to Vercel now?",
    default: true,
  });
}

/**
 * Prompt for Vercel project name
 */
export async function promptVercelProjectName(
  defaultName: string
): Promise<string> {
  return await input({
    message: "Vercel project name:",
    default: defaultName,
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Project name is required";
      }

      // Vercel project name validation
      if (!/^[a-z0-9-]+$/.test(value)) {
        return "Project name must be lowercase alphanumeric with hyphens";
      }

      if (value.length > 100) {
        return "Project name must be 100 characters or less";
      }

      return true;
    },
  });
}

/**
 * Prompt for deployment environment
 */
export async function promptDeploymentEnvironment(): Promise<
  "production" | "preview"
> {
  return await select({
    message: "Deployment environment:",
    choices: [
      {
        name: "Production",
        value: "production" as const,
        description: "Deploy to production with permanent URL",
      },
      {
        name: "Preview",
        value: "preview" as const,
        description: "Deploy as preview (useful for testing)",
      },
    ],
    default: "production",
  });
}

/**
 * Complete deployment configuration flow
 */
export async function promptDeployConfig(
  suggestedProjectName: string
): Promise<DeployConfig> {
  console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────────────┐"));
  console.log(chalk.bold.cyan("│  Deployment                                      │"));
  console.log(chalk.bold.cyan("└─────────────────────────────────────────────────┘\n"));

  const shouldDeploy = await promptShouldDeploy();

  if (!shouldDeploy) {
    console.log(
      chalk.gray("\n  To deploy later, run: cd agents && vercel\n")
    );
    return {
      shouldDeploy: false,
      production: false,
    };
  }

  // Get project name
  const projectName = await promptVercelProjectName(suggestedProjectName);

  // Get environment
  const environment = await promptDeploymentEnvironment();

  return {
    shouldDeploy: true,
    projectName,
    production: environment === "production",
  };
}

/**
 * Show deployment success message
 */
export function showDeploymentSuccess(url: string, adminEmail: string): void {
  console.log(chalk.bold.green("\n✓ Setup complete!\n"));

  console.log(chalk.bold("Next steps:\n"));
  console.log(chalk.cyan(`  1. Open ${url}`));
  console.log(chalk.cyan(`  2. Log in with: ${adminEmail}`));
  console.log(chalk.cyan("  3. Edit /docs/brand-voice.md with your brand"));
  console.log(chalk.cyan('  4. Try: "How is my store performing?"\n'));
}

/**
 * Show local development instructions
 */
export function showLocalDevInstructions(agentsDir: string): void {
  console.log(chalk.bold.green("\n✓ Setup complete!\n"));

  console.log(chalk.bold("Next steps:\n"));
  console.log(chalk.cyan("  1. Start the development server:"));
  console.log(chalk.gray(`     cd ${agentsDir} && npm run dev\n`));
  console.log(chalk.cyan("  2. Open http://localhost:3000\n"));
  console.log(chalk.cyan("  3. Edit /docs/brand-voice.md with your brand\n"));
  console.log(chalk.cyan('  4. Try: "How is my store performing?"\n'));
}

/**
 * Prompt to open deployment URL
 */
export async function promptOpenDeployment(url: string): Promise<void> {
  const shouldOpen = await confirm({
    message: "Open deployment in browser?",
    default: true,
  });

  if (shouldOpen) {
    try {
      const { execa } = await import("execa");
      if (process.platform === "darwin") {
        await execa("open", [url]);
      } else if (process.platform === "win32") {
        await execa("cmd", ["/c", "start", url]);
      } else {
        await execa("xdg-open", [url]);
      }
    } catch {
      console.log(chalk.yellow(`\nPlease visit: ${url}`));
    }
  }
}

/**
 * Show deployment error and recovery instructions
 */
export function showDeploymentError(error: string): void {
  console.log(chalk.red("\n✗ Deployment failed\n"));
  console.log(chalk.gray(`Error: ${error}\n`));

  console.log(chalk.yellow("To deploy manually:\n"));
  console.log(chalk.gray("  1. cd agents"));
  console.log(chalk.gray("  2. vercel"));
  console.log(chalk.gray("  3. Follow the prompts\n"));
}

/**
 * Confirm before production deployment
 */
export async function confirmProductionDeploy(): Promise<boolean> {
  console.log(
    chalk.yellow(
      "\n⚠ This will deploy to production and set up environment variables.\n"
    )
  );

  return await confirm({
    message: "Continue with production deployment?",
    default: true,
  });
}
