/**
 * Prerequisites checking utilities
 */

import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";

export interface PrerequisiteCheck {
  name: string;
  command: string;
  versionArg?: string;
  minVersion?: string;
  required: boolean;
  installed: boolean;
  version?: string;
  installUrl?: string;
}

/**
 * Check if a command exists and optionally get its version
 */
async function checkCommand(
  command: string,
  versionArg: string = "--version"
): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout } = await execa(command, [versionArg]);
    const version = stdout.split("\n")[0]?.trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

/**
 * Check if GitHub CLI is authenticated
 */
export async function checkGhAuth(): Promise<boolean> {
  try {
    await execa("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check all prerequisites
 */
export async function checkPrerequisites(): Promise<PrerequisiteCheck[]> {
  const spinner = ora("Checking prerequisites...").start();

  const checks: PrerequisiteCheck[] = [
    {
      name: "Node.js",
      command: "node",
      versionArg: "--version",
      minVersion: "20.0.0",
      required: true,
      installed: false,
      installUrl: "https://nodejs.org",
    },
    {
      name: "npm",
      command: "npm",
      versionArg: "--version",
      required: true,
      installed: false,
      installUrl: "https://nodejs.org",
    },
    {
      name: "git",
      command: "git",
      versionArg: "--version",
      minVersion: "2.28.0",
      required: true,
      installed: false,
      installUrl: "https://git-scm.com",
    },
    {
      name: "GitHub CLI",
      command: "gh",
      versionArg: "--version",
      required: true,
      installed: false,
      installUrl: "https://cli.github.com",
    },
    {
      name: "Shopify CLI",
      command: "shopify",
      versionArg: "version",
      required: false,
      installed: false,
      installUrl: "https://shopify.dev/docs/api/shopify-cli",
    },
    {
      name: "Vercel CLI",
      command: "vercel",
      versionArg: "--version",
      required: false,
      installed: false,
      installUrl: "https://vercel.com/docs/cli",
    },
  ];

  for (const check of checks) {
    const result = await checkCommand(check.command, check.versionArg);
    check.installed = result.installed;
    check.version = result.version;
  }

  spinner.stop();

  // Display results
  console.log(chalk.bold("\nPrerequisites:"));
  for (const check of checks) {
    const icon = check.installed ? chalk.green("✓") : chalk.yellow("⚠");
    const name = check.name;
    const version = check.version ? chalk.dim(check.version) : "";
    const status = check.installed
      ? version
      : chalk.dim(
          check.required
            ? "not found (required)"
            : "not found (optional, some features may be unavailable)"
        );

    console.log(`  ${icon} ${name} ${status}`);
  }
  console.log();

  return checks;
}

/**
 * Validate prerequisites and exit if required ones are missing
 */
export async function validatePrerequisites(): Promise<void> {
  const checks = await checkPrerequisites();
  const missing = checks.filter((c) => c.required && !c.installed);

  if (missing.length > 0) {
    console.error(
      chalk.red.bold("\n✗ Missing required prerequisites:\n")
    );
    for (const check of missing) {
      console.error(
        chalk.red(`  • ${check.name} - Install from: ${check.installUrl}`)
      );
    }
    console.error();
    process.exit(1);
  }

  // Check gh auth
  const ghCheck = checks.find((c) => c.command === "gh");
  if (ghCheck?.installed) {
    const isAuthed = await checkGhAuth();
    if (!isAuthed) {
      console.error(
        chalk.red.bold(
          "\n✗ GitHub CLI is not authenticated. Please run:\n"
        )
      );
      console.error(chalk.cyan("  gh auth login\n"));
      process.exit(1);
    }
  }
}

/**
 * Check if a package manager is available
 */
export async function detectPackageManager(): Promise<"npm" | "pnpm" | "yarn"> {
  const { installed: hasPnpm } = await checkCommand("pnpm", "--version");
  if (hasPnpm) return "pnpm";

  const { installed: hasYarn } = await checkCommand("yarn", "--version");
  if (hasYarn) return "yarn";

  return "npm";
}
