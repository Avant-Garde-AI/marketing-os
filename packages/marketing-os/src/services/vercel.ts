/**
 * Vercel CLI interactions
 * Handles project linking, environment variables, and deployments
 */

import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";
import path from "path";

export interface VercelLinkOptions {
  projectName?: string;
  cwd: string;
}

export interface VercelEnvVar {
  name: string;
  value: string;
  target?: "production" | "preview" | "development";
}

/**
 * Check if Vercel CLI is installed
 */
export async function checkVercelCLI(): Promise<{
  installed: boolean;
  version?: string;
}> {
  try {
    const { stdout } = await execa("vercel", ["--version"]);
    return {
      installed: true,
      version: stdout.trim(),
    };
  } catch {
    return {
      installed: false,
    };
  }
}

/**
 * Check if user is logged into Vercel CLI
 */
export async function isVercelLoggedIn(): Promise<boolean> {
  try {
    const result = await execa("vercel", ["whoami"], { timeout: 10000 });
    return result.stdout.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the currently logged-in Vercel user
 */
export async function getVercelUser(): Promise<string | null> {
  try {
    const result = await execa("vercel", ["whoami"]);
    return result.stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Login to Vercel via CLI (opens browser for OAuth)
 */
export async function vercelLogin(): Promise<{ success: boolean; user?: string; error?: string }> {
  console.log(chalk.dim("\n  Opening browser for Vercel login..."));

  try {
    await execa("vercel", ["login"], { stdio: "inherit" });

    const user = await getVercelUser();
    if (user) {
      console.log(chalk.green(`  ✓ Logged in to Vercel as ${user}`));
      return { success: true, user };
    }

    console.log(chalk.yellow("  ⚠ Vercel login completed but couldn't verify user"));
    return { success: false, error: "Could not verify login" };
  } catch (error) {
    console.log(chalk.red("  ✗ Vercel login failed"));
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Display instructions for installing Vercel CLI
 */
export function displayVercelCLIInstructions(): void {
  console.log(chalk.bold("\n  📦 Install Vercel CLI:\n"));
  console.log(chalk.cyan("  npm install -g vercel"));
  console.log(chalk.dim("\n  Then run this command again.\n"));
}

/**
 * Full Vercel setup flow with OAuth
 */
export async function setupVercelWithOAuth(
  projectDir: string
): Promise<{ success: boolean; user?: string; error?: string }> {
  // Check if CLI is installed
  const cliCheck = await checkVercelCLI();
  if (!cliCheck.installed) {
    console.log(chalk.yellow("\n  ⚠ Vercel CLI not installed"));
    displayVercelCLIInstructions();
    return { success: false, error: "CLI not installed" };
  }

  // Check if logged in
  const loggedIn = await isVercelLoggedIn();
  if (!loggedIn) {
    const loginResult = await vercelLogin();
    if (!loginResult.success) {
      return { success: false, error: loginResult.error };
    }
    return { success: true, user: loginResult.user };
  }

  const user = await getVercelUser();
  console.log(chalk.green(`  ✓ Already logged in to Vercel as ${user}`));
  return { success: true, user: user || undefined };
}

/**
 * Link a project to Vercel
 */
export async function linkVercelProject(
  options: VercelLinkOptions
): Promise<{ success: boolean; projectId?: string; error?: string }> {
  const spinner = ora("Linking project to Vercel...").start();

  try {
    const args = ["link", "--yes"];
    if (options.projectName) {
      args.push("--project", options.projectName);
    }

    const { stdout } = await execa("vercel", args, {
      cwd: options.cwd,
    });

    // Extract project ID from output if available
    const projectIdMatch = stdout.match(/Project:\s+(.+)/);
    const projectId = projectIdMatch?.[1];

    spinner.succeed(
      `Linked to Vercel project${projectId ? `: ${chalk.cyan(projectId)}` : ""}`
    );

    return {
      success: true,
      projectId,
    };
  } catch (error) {
    spinner.fail("Failed to link Vercel project");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Set a Vercel environment variable
 */
export async function setVercelEnv(
  name: string,
  value: string,
  target: "production" | "preview" | "development" = "production",
  cwd: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await execa(
      "vercel",
      ["env", "add", name, target, "--force"],
      {
        cwd,
        input: value,
      }
    );

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Set multiple Vercel environment variables
 */
export async function setVercelEnvVars(
  envVars: VercelEnvVar[],
  cwd: string
): Promise<{ success: boolean; failed: string[] }> {
  const spinner = ora("Setting Vercel environment variables...").start();
  const failed: string[] = [];

  for (const envVar of envVars) {
    try {
      await execa(
        "vercel",
        [
          "env",
          "add",
          envVar.name,
          envVar.target || "production",
          "--force",
        ],
        {
          cwd,
          input: envVar.value,
        }
      );
      spinner.text = `Setting Vercel environment variables... ${chalk.green("✓")} ${envVar.name}`;
    } catch {
      failed.push(envVar.name);
      spinner.text = `Setting Vercel environment variables... ${chalk.red("✗")} ${envVar.name}`;
    }
  }

  if (failed.length === 0) {
    spinner.succeed(
      `Set ${envVars.length} environment variable${envVars.length !== 1 ? "s" : ""}`
    );
    return { success: true, failed: [] };
  } else {
    spinner.fail(
      `Failed to set ${failed.length} variable${failed.length !== 1 ? "s" : ""}`
    );
    return { success: false, failed };
  }
}

/**
 * Deploy to Vercel
 */
export async function deployToVercel(
  cwd: string,
  production: boolean = true
): Promise<{ success: boolean; url?: string; error?: string }> {
  const spinner = ora(
    `Deploying to Vercel${production ? " (production)" : ""}...`
  ).start();

  try {
    const args = production ? ["--prod", "--yes"] : ["--yes"];

    const { stdout } = await execa("vercel", args, {
      cwd,
    });

    // Extract deployment URL from output
    const urlMatch = stdout.match(/https:\/\/[^\s]+/);
    const url = urlMatch?.[0];

    spinner.succeed(
      `Deployed to Vercel${url ? `: ${chalk.cyan(url)}` : ""}`
    );

    return {
      success: true,
      url,
    };
  } catch (error) {
    spinner.fail("Failed to deploy to Vercel");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a directory is linked to Vercel
 */
export async function isVercelLinked(cwd: string): Promise<boolean> {
  try {
    const vercelDir = path.join(cwd, ".vercel");
    const { existsSync } = await import("fs");
    return existsSync(vercelDir);
  } catch {
    return false;
  }
}

/**
 * Get Vercel project info
 */
export async function getVercelProjectInfo(
  cwd: string
): Promise<{ name?: string; id?: string; error?: string }> {
  try {
    const { stdout } = await execa("vercel", ["project", "ls", "--json"], {
      cwd,
    });

    const projects = JSON.parse(stdout);
    if (projects.length > 0) {
      return {
        name: projects[0].name,
        id: projects[0].id,
      };
    }

    return {};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Pull Vercel environment variables
 */
export async function pullVercelEnv(
  cwd: string,
  environment: "production" | "preview" | "development" = "production"
): Promise<{ success: boolean; error?: string }> {
  const spinner = ora(
    `Pulling ${environment} environment variables from Vercel...`
  ).start();

  try {
    await execa("vercel", ["env", "pull", "--environment", environment], {
      cwd,
    });

    spinner.succeed(`Environment variables pulled from Vercel`);
    return { success: true };
  } catch (error) {
    spinner.fail("Failed to pull environment variables");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
