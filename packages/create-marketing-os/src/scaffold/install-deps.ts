/**
 * Package manager detection and dependency installation
 * Detects npm/pnpm/yarn and runs appropriate install commands
 */

import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import chalk from "chalk";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface InstallResult {
  success: boolean;
  packageManager: PackageManager;
  error?: string;
  stdout?: string;
  stderr?: string;
}

/**
 * Detect which package manager to use
 * Priority: pnpm > yarn > bun > npm (fallback)
 */
export async function detectPackageManager(
  projectDir: string
): Promise<PackageManager> {
  // Check for lock files
  const lockFiles: Record<string, PackageManager> = {
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "bun.lockb": "bun",
    "package-lock.json": "npm",
  };

  for (const [lockFile, pm] of Object.entries(lockFiles)) {
    const lockPath = path.join(projectDir, lockFile);
    if (await fs.pathExists(lockPath)) {
      // Verify the package manager is available
      if (await isPackageManagerAvailable(pm)) {
        return pm;
      }
    }
  }

  // Check parent directories (monorepo case)
  const parentDir = path.dirname(projectDir);
  if (parentDir !== projectDir) {
    for (const [lockFile, pm] of Object.entries(lockFiles)) {
      const lockPath = path.join(parentDir, lockFile);
      if (await fs.pathExists(lockPath)) {
        if (await isPackageManagerAvailable(pm)) {
          return pm;
        }
      }
    }
  }

  // Check which package managers are available
  const availableManagers: PackageManager[] = ["pnpm", "yarn", "bun", "npm"];
  for (const pm of availableManagers) {
    if (await isPackageManagerAvailable(pm)) {
      return pm;
    }
  }

  // Default to npm (always available with Node.js)
  return "npm";
}

/**
 * Check if a package manager is available
 */
async function isPackageManagerAvailable(pm: PackageManager): Promise<boolean> {
  try {
    await execa(pm, ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install dependencies using the detected package manager
 */
export async function installDependencies(
  projectDir: string,
  verbose?: boolean
): Promise<InstallResult> {
  const packageManager = await detectPackageManager(projectDir);

  if (verbose) {
    console.log(chalk.gray(`Using package manager: ${packageManager}`));
  }

  try {
    // Get install command
    const command = getInstallCommand(packageManager);

    if (verbose) {
      console.log(chalk.gray(`Running: ${command.join(" ")}`));
    }

    // Run install
    const result = await execa(command[0], command.slice(1), {
      cwd: projectDir,
      stdio: verbose ? "inherit" : "pipe",
      timeout: 300000, // 5 minutes
    });

    return {
      success: true,
      packageManager,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const execaError = error as any;
    return {
      success: false,
      packageManager,
      error: execaError.message || "Unknown error",
      stdout: execaError.stdout,
      stderr: execaError.stderr,
    };
  }
}

/**
 * Get the install command for a package manager
 */
function getInstallCommand(pm: PackageManager): string[] {
  switch (pm) {
    case "npm":
      return ["npm", "install"];
    case "pnpm":
      return ["pnpm", "install"];
    case "yarn":
      return ["yarn", "install"];
    case "bun":
      return ["bun", "install"];
  }
}

/**
 * Add dependencies to package.json
 */
export async function addDependencies(
  projectDir: string,
  dependencies: string[],
  dev = false
): Promise<InstallResult> {
  const packageManager = await detectPackageManager(projectDir);

  try {
    const command = getAddCommand(packageManager, dependencies, dev);

    const result = await execa(command[0], command.slice(1), {
      cwd: projectDir,
      timeout: 300000,
    });

    return {
      success: true,
      packageManager,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const execaError = error as any;
    return {
      success: false,
      packageManager,
      error: execaError.message || "Unknown error",
      stdout: execaError.stdout,
      stderr: execaError.stderr,
    };
  }
}

/**
 * Get the add command for a package manager
 */
function getAddCommand(
  pm: PackageManager,
  dependencies: string[],
  dev: boolean
): string[] {
  switch (pm) {
    case "npm":
      return ["npm", "install", dev ? "--save-dev" : "--save", ...dependencies];
    case "pnpm":
      return ["pnpm", "add", dev ? "-D" : "", ...dependencies].filter(Boolean);
    case "yarn":
      return ["yarn", "add", dev ? "-D" : "", ...dependencies].filter(Boolean);
    case "bun":
      return ["bun", "add", dev ? "-d" : "", ...dependencies].filter(Boolean);
  }
}

/**
 * Remove dependencies from package.json
 */
export async function removeDependencies(
  projectDir: string,
  dependencies: string[]
): Promise<InstallResult> {
  const packageManager = await detectPackageManager(projectDir);

  try {
    const command = getRemoveCommand(packageManager, dependencies);

    const result = await execa(command[0], command.slice(1), {
      cwd: projectDir,
      timeout: 300000,
    });

    return {
      success: true,
      packageManager,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const execaError = error as any;
    return {
      success: false,
      packageManager,
      error: execaError.message || "Unknown error",
      stdout: execaError.stdout,
      stderr: execaError.stderr,
    };
  }
}

/**
 * Get the remove command for a package manager
 */
function getRemoveCommand(
  pm: PackageManager,
  dependencies: string[]
): string[] {
  switch (pm) {
    case "npm":
      return ["npm", "uninstall", ...dependencies];
    case "pnpm":
      return ["pnpm", "remove", ...dependencies];
    case "yarn":
      return ["yarn", "remove", ...dependencies];
    case "bun":
      return ["bun", "remove", ...dependencies];
  }
}

/**
 * Check if package.json exists
 */
export async function hasPackageJson(projectDir: string): Promise<boolean> {
  const packageJsonPath = path.join(projectDir, "package.json");
  return await fs.pathExists(packageJsonPath);
}

/**
 * Read package.json
 */
export async function readPackageJson(
  projectDir: string
): Promise<Record<string, any> | null> {
  try {
    const packageJsonPath = path.join(projectDir, "package.json");
    return await fs.readJson(packageJsonPath);
  } catch {
    return null;
  }
}

/**
 * Write package.json
 */
export async function writePackageJson(
  projectDir: string,
  data: Record<string, any>
): Promise<void> {
  const packageJsonPath = path.join(projectDir, "package.json");
  await fs.writeJson(packageJsonPath, data, { spaces: 2 });
}

/**
 * Get installed dependencies
 */
export async function getInstalledDependencies(
  projectDir: string
): Promise<{
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}> {
  const pkg = await readPackageJson(projectDir);

  return {
    dependencies: pkg?.dependencies || {},
    devDependencies: pkg?.devDependencies || {},
  };
}

/**
 * Check if a dependency is installed
 */
export async function isDependencyInstalled(
  projectDir: string,
  dependency: string
): Promise<boolean> {
  const { dependencies, devDependencies } =
    await getInstalledDependencies(projectDir);

  return dependency in dependencies || dependency in devDependencies;
}

/**
 * Get package manager version
 */
export async function getPackageManagerVersion(
  pm: PackageManager
): Promise<string | null> {
  try {
    const result = await execa(pm, ["--version"], { timeout: 5000 });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Validate that Node.js version meets requirements
 */
export async function validateNodeVersion(
  required: string
): Promise<{ valid: boolean; current: string; required: string }> {
  try {
    const result = await execa("node", ["--version"]);
    const current = result.stdout.trim().replace(/^v/, "");

    // Simple version comparison (major version)
    const currentMajor = parseInt(current.split(".")[0], 10);
    const requiredMajor = parseInt(required.split(".")[0], 10);

    return {
      valid: currentMajor >= requiredMajor,
      current,
      required,
    };
  } catch {
    return {
      valid: false,
      current: "unknown",
      required,
    };
  }
}

/**
 * Clean install (remove node_modules and reinstall)
 */
export async function cleanInstall(
  projectDir: string,
  verbose?: boolean
): Promise<InstallResult> {
  const packageManager = await detectPackageManager(projectDir);

  try {
    // Remove node_modules
    const nodeModulesPath = path.join(projectDir, "node_modules");
    if (await fs.pathExists(nodeModulesPath)) {
      if (verbose) {
        console.log(chalk.gray("Removing node_modules..."));
      }
      await fs.remove(nodeModulesPath);
    }

    // Remove lock files
    const lockFiles = [
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "bun.lockb",
    ];
    for (const lockFile of lockFiles) {
      const lockPath = path.join(projectDir, lockFile);
      if (await fs.pathExists(lockPath)) {
        if (verbose) {
          console.log(chalk.gray(`Removing ${lockFile}...`));
        }
        await fs.remove(lockPath);
      }
    }

    // Reinstall
    return await installDependencies(projectDir, verbose);
  } catch (error) {
    return {
      success: false,
      packageManager,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
