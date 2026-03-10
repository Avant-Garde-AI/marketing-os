/**
 * GitHub utilities
 */

import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";

/**
 * Clone a GitHub repository
 */
export async function cloneRepo(
  repo: string,
  targetDir: string
): Promise<void> {
  const spinner = ora(`Cloning ${repo}...`).start();

  try {
    await execa("git", ["clone", `https://github.com/${repo}.git`, targetDir]);
    spinner.succeed(chalk.green(`✓ Cloned ${repo}`));
  } catch (error) {
    spinner.fail(chalk.red(`✗ Failed to clone ${repo}`));
    throw error;
  }
}

/**
 * Initialize a new git repository
 */
export async function initGitRepo(targetDir: string): Promise<void> {
  const spinner = ora("Initializing git repository...").start();

  try {
    await execa("git", ["init"], { cwd: targetDir });
    spinner.succeed(chalk.green("✓ Git repository initialized"));
  } catch (error) {
    spinner.fail(chalk.red("✗ Failed to initialize git repository"));
    throw error;
  }
}

/**
 * Create a GitHub repository
 */
export async function createGitHubRepo(
  name: string,
  org?: string,
  isPrivate: boolean = true
): Promise<string> {
  const spinner = ora(`Creating GitHub repository...`).start();

  try {
    const args = ["repo", "create"];

    if (org) {
      args.push(`${org}/${name}`);
    } else {
      args.push(name);
    }

    args.push(isPrivate ? "--private" : "--public");

    const { stdout } = await execa("gh", args);
    const repoUrl = stdout.trim();

    spinner.succeed(chalk.green(`✓ Created GitHub repository: ${repoUrl}`));
    return org ? `${org}/${name}` : name;
  } catch (error) {
    spinner.fail(chalk.red("✗ Failed to create GitHub repository"));
    throw error;
  }
}

/**
 * Set GitHub repository secrets
 */
export async function setGitHubSecrets(
  repo: string,
  secrets: Record<string, string>
): Promise<void> {
  const spinner = ora("Setting GitHub Actions secrets...").start();

  try {
    for (const [key, value] of Object.entries(secrets)) {
      spinner.text = `Setting ${key}...`;
      await execa("gh", [
        "secret",
        "set",
        key,
        "--repo",
        repo,
        "--body",
        value,
      ]);
    }

    spinner.succeed(chalk.green("✓ GitHub secrets configured"));
  } catch (error) {
    spinner.fail(chalk.red("✗ Failed to set GitHub secrets"));
    throw error;
  }
}

/**
 * Check if inside a git repository
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--git-dir"], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current git repository info
 */
export async function getGitRepoInfo(dir: string): Promise<{
  remote?: string;
  branch?: string;
} | null> {
  try {
    const { stdout: remote } = await execa(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: dir }
    );

    const { stdout: branch } = await execa("git", ["branch", "--show-current"], {
      cwd: dir,
    });

    return {
      remote: remote.trim(),
      branch: branch.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Commit and push changes
 */
export async function commitAndPush(
  dir: string,
  message: string,
  remote: string = "origin",
  branch: string = "main"
): Promise<void> {
  const spinner = ora("Committing and pushing changes...").start();

  try {
    // Add all files
    await execa("git", ["add", "."], { cwd: dir });

    // Commit
    await execa("git", ["commit", "-m", message], { cwd: dir });

    // Push
    await execa("git", ["push", "-u", remote, branch], { cwd: dir });

    spinner.succeed(chalk.green("✓ Changes pushed to GitHub"));
  } catch (error) {
    spinner.fail(chalk.red("✗ Failed to push changes"));
    throw error;
  }
}
