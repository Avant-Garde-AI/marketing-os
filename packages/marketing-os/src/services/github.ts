/**
 * GitHub CLI interactions
 * Handles repo creation, secret management, and webhook setup
 */

import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";

export interface GitHubRepoOptions {
  name: string;
  org?: string;
  description?: string;
  private?: boolean;
}

export interface GitHubSecret {
  name: string;
  value: string;
}

/**
 * Check if GitHub CLI is installed and authenticated
 */
export async function checkGitHubCLI(): Promise<{
  installed: boolean;
  authenticated: boolean;
  version?: string;
}> {
  try {
    const { stdout: version } = await execa("gh", ["--version"]);
    const versionMatch = version.match(/gh version (\d+\.\d+\.\d+)/);

    try {
      await execa("gh", ["auth", "status"]);
      return {
        installed: true,
        authenticated: true,
        version: versionMatch?.[1],
      };
    } catch {
      return {
        installed: true,
        authenticated: false,
        version: versionMatch?.[1],
      };
    }
  } catch {
    return {
      installed: false,
      authenticated: false,
    };
  }
}

/**
 * Create a new GitHub repository
 */
export async function createGitHubRepo(
  options: GitHubRepoOptions
): Promise<{ success: boolean; url?: string; error?: string }> {
  const spinner = ora("Creating GitHub repository...").start();

  try {
    const fullName = options.org
      ? `${options.org}/${options.name}`
      : options.name;

    const args = [
      "repo",
      "create",
      fullName,
      options.description ? `--description=${options.description}` : "",
      options.private ? "--private" : "--public",
      "--source=.",
      "--remote=origin",
    ].filter(Boolean);

    const { stdout } = await execa("gh", args);

    // Extract URL from output
    const urlMatch = stdout.match(/https:\/\/github\.com\/[\w-]+\/[\w-]+/);
    const url = urlMatch?.[0];

    spinner.succeed(`Repository created: ${chalk.cyan(url || fullName)}`);

    return {
      success: true,
      url,
    };
  } catch (error) {
    spinner.fail("Failed to create GitHub repository");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Set a GitHub Actions secret
 */
export async function setGitHubSecret(
  repo: string,
  secret: GitHubSecret
): Promise<{ success: boolean; error?: string }> {
  try {
    await execa("gh", [
      "secret",
      "set",
      secret.name,
      "--repo",
      repo,
      "--body",
      secret.value,
    ]);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Set multiple GitHub Actions secrets
 */
export async function setGitHubSecrets(
  repo: string,
  secrets: GitHubSecret[]
): Promise<{ success: boolean; failed: string[] }> {
  const spinner = ora("Setting GitHub Actions secrets...").start();
  const failed: string[] = [];

  for (const secret of secrets) {
    try {
      await execa("gh", [
        "secret",
        "set",
        secret.name,
        "--repo",
        repo,
        "--body",
        secret.value,
      ]);
      spinner.text = `Setting GitHub Actions secrets... ${chalk.green("✓")} ${secret.name}`;
    } catch (error) {
      failed.push(secret.name);
      spinner.text = `Setting GitHub Actions secrets... ${chalk.red("✗")} ${secret.name}`;
    }
  }

  if (failed.length === 0) {
    spinner.succeed(
      `Set ${secrets.length} GitHub Actions secret${secrets.length !== 1 ? "s" : ""}`
    );
    return { success: true, failed: [] };
  } else {
    spinner.fail(
      `Failed to set ${failed.length} secret${failed.length !== 1 ? "s" : ""}`
    );
    return { success: false, failed };
  }
}

/**
 * Create a GitHub webhook
 */
export async function createGitHubWebhook(
  repo: string,
  webhookUrl: string,
  events: string[] = ["pull_request", "push"]
): Promise<{ success: boolean; error?: string }> {
  const spinner = ora("Creating GitHub webhook...").start();

  try {
    // Use gh api to create webhook
    const payload = {
      config: {
        url: webhookUrl,
        content_type: "json",
        insecure_ssl: "0",
      },
      events,
      active: true,
    };

    await execa("gh", [
      "api",
      `repos/${repo}/hooks`,
      "--method",
      "POST",
      "--input",
      "-",
    ], {
      input: JSON.stringify(payload),
    });

    spinner.succeed(`Webhook created: ${chalk.cyan(webhookUrl)}`);
    return { success: true };
  } catch (error) {
    spinner.fail("Failed to create webhook");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Clone a GitHub repository
 */
export async function cloneGitHubRepo(
  repo: string,
  targetDir: string
): Promise<{ success: boolean; error?: string }> {
  const spinner = ora(`Cloning repository ${repo}...`).start();

  try {
    await execa("gh", ["repo", "clone", repo, targetDir]);
    spinner.succeed(`Repository cloned to ${chalk.cyan(targetDir)}`);
    return { success: true };
  } catch (error) {
    spinner.fail("Failed to clone repository");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a GitHub repository exists
 */
export async function checkGitHubRepo(
  repo: string
): Promise<{ exists: boolean; error?: string }> {
  try {
    await execa("gh", ["repo", "view", repo]);
    return { exists: true };
  } catch (error) {
    return {
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Push current branch to GitHub
 */
export async function pushToGitHub(
  branch: string = "main"
): Promise<{ success: boolean; error?: string }> {
  const spinner = ora(`Pushing to GitHub (${branch})...`).start();

  try {
    await execa("git", ["push", "-u", "origin", branch]);
    spinner.succeed(`Pushed to GitHub (${branch})`);
    return { success: true };
  } catch (error) {
    spinner.fail("Failed to push to GitHub");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
