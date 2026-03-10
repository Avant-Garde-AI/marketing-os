/**
 * Vercel utilities
 */

import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";
import path from "path";

/**
 * Check if Vercel CLI is installed
 */
export async function isVercelCLIInstalled(): Promise<boolean> {
  try {
    await execa("vercel", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Link Vercel project
 */
export async function linkVercelProject(
  projectDir: string,
  projectName?: string
): Promise<void> {
  const spinner = ora("Linking Vercel project...").start();

  try {
    const args = ["link"];
    if (projectName) {
      args.push("--project", projectName);
    }

    await execa("vercel", args, {
      cwd: projectDir,
      stdio: "inherit",
    });

    spinner.succeed(chalk.green("✓ Vercel project linked"));
  } catch (error) {
    spinner.fail(chalk.red("✗ Failed to link Vercel project"));
    throw error;
  }
}

/**
 * Set Vercel environment variables
 */
export async function setVercelEnvVars(
  projectDir: string,
  envVars: Record<string, string>,
  environments: string[] = ["production", "preview", "development"]
): Promise<void> {
  const spinner = ora("Setting Vercel environment variables...").start();

  try {
    for (const [key, value] of Object.entries(envVars)) {
      spinner.text = `Setting ${key}...`;

      for (const env of environments) {
        await execa("vercel", ["env", "add", key, env], {
          cwd: projectDir,
          input: value,
          stdio: ["pipe", "pipe", "inherit"],
        });
      }
    }

    spinner.succeed(chalk.green("✓ Vercel environment variables set"));
  } catch (error) {
    spinner.fail(chalk.red("✗ Failed to set Vercel environment variables"));
    throw error;
  }
}

/**
 * Deploy to Vercel
 */
export async function deployToVercel(
  projectDir: string,
  production: boolean = true
): Promise<string> {
  const spinner = ora(
    `Deploying to Vercel${production ? " (production)" : ""}...`
  ).start();

  try {
    const args = production ? ["--prod"] : [];

    const { stdout } = await execa("vercel", args, {
      cwd: projectDir,
      stdio: "pipe",
    });

    // Extract URL from output
    const lines = stdout.split("\n");
    const urlLine = lines.find((line) => line.includes("https://"));
    const url = urlLine?.trim() || "";

    spinner.succeed(chalk.green(`✓ Deployed to: ${url}`));
    return url;
  } catch (error) {
    spinner.fail(chalk.red("✗ Failed to deploy to Vercel"));
    throw error;
  }
}
