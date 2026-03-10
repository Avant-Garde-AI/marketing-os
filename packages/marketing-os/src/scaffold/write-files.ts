/**
 * File creation with conflict detection and handling
 * Writes files to disk with various overwrite strategies
 */

import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";

/**
 * File overwrite strategies
 * - skip: Skip if file exists
 * - skip-dir: Skip if parent directory exists
 * - overwrite: Overwrite without prompting
 * - prompt: Prompt user before overwriting
 * - abort: Abort the entire process if file exists
 * - merge: Attempt to merge with existing file (for specific file types)
 */
export type OverwriteStrategy =
  | "skip"
  | "skip-dir"
  | "overwrite"
  | "prompt"
  | "abort"
  | "merge";

export interface FileToWrite {
  templatePath: string;
  targetPath: string;
  content?: string;
  overwrite: OverwriteStrategy;
}

export interface WriteFilesResult {
  filesCreated: string[];
  filesSkipped: string[];
  errors: string[];
}

/**
 * Write multiple files to disk with conflict handling
 */
export async function writeFiles(
  files: FileToWrite[],
  baseDir: string
): Promise<WriteFilesResult> {
  const result: WriteFilesResult = {
    filesCreated: [],
    filesSkipped: [],
    errors: [],
  };

  for (const file of files) {
    try {
      const writeResult = await writeFile(file, baseDir);

      if (writeResult.created) {
        result.filesCreated.push(file.targetPath);
      } else if (writeResult.skipped) {
        result.filesSkipped.push(file.targetPath);
      }

      if (writeResult.error) {
        result.errors.push(writeResult.error);
      }
    } catch (error) {
      const errorMsg = `Failed to write ${file.targetPath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      result.errors.push(errorMsg);
    }
  }

  return result;
}

/**
 * Write a single file with conflict handling
 */
async function writeFile(
  file: FileToWrite,
  baseDir: string
): Promise<{ created: boolean; skipped: boolean; error?: string }> {
  const targetPath = file.targetPath;
  const exists = await fs.pathExists(targetPath);

  // Handle different overwrite strategies
  switch (file.overwrite) {
    case "skip":
      if (exists) {
        return { created: false, skipped: true };
      }
      break;

    case "skip-dir": {
      const parentDir = path.dirname(targetPath);
      const dirExists = await fs.pathExists(parentDir);
      if (dirExists) {
        const files = await fs.readdir(parentDir);
        // Skip if directory exists and contains files
        if (files.length > 0) {
          return { created: false, skipped: true };
        }
      }
      break;
    }

    case "abort":
      if (exists) {
        return {
          created: false,
          skipped: false,
          error: `File already exists: ${targetPath}. Aborting to prevent overwrite. Remove the /agents directory or run in a different location.`,
        };
      }
      break;

    case "prompt":
      if (exists) {
        const relativePath = path.relative(baseDir, targetPath);
        const shouldOverwrite = await confirm({
          message: `File ${chalk.cyan(relativePath)} already exists. Overwrite?`,
          default: false,
        });

        if (!shouldOverwrite) {
          return { created: false, skipped: true };
        }
      }
      break;

    case "merge":
      if (exists) {
        return await mergeFile(file, targetPath);
      }
      break;

    case "overwrite":
      // Always overwrite, no check needed
      break;
  }

  // Write the file
  try {
    // Ensure parent directory exists
    await fs.ensureDir(path.dirname(targetPath));

    // Get content
    let content: string;
    if (file.content) {
      content = file.content;
    } else {
      // Copy from template
      content = await fs.readFile(file.templatePath, "utf-8");
    }

    // Write file
    await fs.writeFile(targetPath, content, "utf-8");

    return { created: true, skipped: false };
  } catch (error) {
    return {
      created: false,
      skipped: false,
      error: `Failed to write file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}

/**
 * Merge file content with existing file
 * Currently supports:
 * - CLAUDE.md: Append new content with separator
 * - .env files: Merge environment variables
 * - package.json: Merge dependencies
 */
async function mergeFile(
  file: FileToWrite,
  targetPath: string
): Promise<{ created: boolean; skipped: boolean; error?: string }> {
  const filename = path.basename(targetPath);

  try {
    const existingContent = await fs.readFile(targetPath, "utf-8");
    const newContent = file.content || "";

    let mergedContent: string;

    if (filename === "CLAUDE.md") {
      // Append with separator
      mergedContent = mergeClaude(existingContent, newContent);
    } else if (filename.startsWith(".env")) {
      // Merge environment variables
      mergedContent = mergeEnv(existingContent, newContent);
    } else if (filename === "package.json") {
      // Merge package.json
      mergedContent = mergePackageJson(existingContent, newContent);
    } else {
      // Default: prompt user
      const relativePath = path.relative(process.cwd(), targetPath);
      const shouldOverwrite = await confirm({
        message: `Cannot automatically merge ${chalk.cyan(
          relativePath
        )}. Overwrite?`,
        default: false,
      });

      if (!shouldOverwrite) {
        return { created: false, skipped: true };
      }

      mergedContent = newContent;
    }

    await fs.writeFile(targetPath, mergedContent, "utf-8");
    return { created: true, skipped: false };
  } catch (error) {
    return {
      created: false,
      skipped: false,
      error: `Failed to merge file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}

/**
 * Merge CLAUDE.md files
 */
function mergeClaude(existing: string, newContent: string): string {
  const separator = "\n\n---\n\n## Marketing OS Instructions\n\n";
  return existing + separator + newContent.split("\n").slice(1).join("\n");
}

/**
 * Merge .env files
 * Adds new variables without overwriting existing ones
 */
function mergeEnv(existing: string, newContent: string): string {
  const existingLines = existing.split("\n");
  const newLines = newContent.split("\n");

  // Get existing variable names
  const existingVars = new Set(
    existingLines
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => line.split("=")[0]?.trim())
      .filter((v): v is string => !!v)
  );

  // Add new variables that don't exist
  const linesToAdd: string[] = [];
  for (const line of newLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      // Keep comments and empty lines
      linesToAdd.push(line);
      continue;
    }

    const varName = trimmed.split("=")[0]?.trim() || "";
    if (!existingVars.has(varName)) {
      linesToAdd.push(line);
    }
  }

  if (linesToAdd.length === 0) {
    return existing;
  }

  return existing + "\n\n# Marketing OS variables\n" + linesToAdd.join("\n");
}

/**
 * Merge package.json files
 * Merges dependencies, devDependencies, and scripts
 */
function mergePackageJson(existing: string, newContent: string): string {
  try {
    const existingPkg = JSON.parse(existing);
    const newPkg = JSON.parse(newContent);

    // Merge dependencies
    existingPkg.dependencies = {
      ...existingPkg.dependencies,
      ...newPkg.dependencies,
    };

    // Merge devDependencies
    existingPkg.devDependencies = {
      ...existingPkg.devDependencies,
      ...newPkg.devDependencies,
    };

    // Merge scripts (prefix new ones with "mos:")
    if (newPkg.scripts) {
      existingPkg.scripts = existingPkg.scripts || {};
      for (const [key, value] of Object.entries(newPkg.scripts)) {
        const prefixedKey = `mos:${key}`;
        existingPkg.scripts[prefixedKey] = value;
      }
    }

    return JSON.stringify(existingPkg, null, 2) + "\n";
  } catch {
    // If parsing fails, return new content
    return newContent;
  }
}

/**
 * Check if a file can be safely written
 * Returns conflict information
 */
export async function checkFileConflict(
  targetPath: string,
  strategy: OverwriteStrategy
): Promise<{
  canWrite: boolean;
  needsPrompt: boolean;
  reason?: string;
}> {
  const exists = await fs.pathExists(targetPath);

  if (!exists) {
    return { canWrite: true, needsPrompt: false };
  }

  switch (strategy) {
    case "skip":
    case "skip-dir":
      return {
        canWrite: false,
        needsPrompt: false,
        reason: "File exists and strategy is skip",
      };

    case "abort":
      return {
        canWrite: false,
        needsPrompt: false,
        reason: "File exists and strategy is abort",
      };

    case "prompt":
    case "merge":
      return { canWrite: true, needsPrompt: true };

    case "overwrite":
      return { canWrite: true, needsPrompt: false };

    default:
      return { canWrite: false, needsPrompt: false, reason: "Unknown strategy" };
  }
}

/**
 * Get a summary of files that will be written
 */
export async function getWriteSummary(
  files: FileToWrite[],
  baseDir: string
): Promise<{
  toCreate: string[];
  toOverwrite: string[];
  toSkip: string[];
  toAbort: string[];
}> {
  const summary = {
    toCreate: [] as string[],
    toOverwrite: [] as string[],
    toSkip: [] as string[],
    toAbort: [] as string[],
  };

  for (const file of files) {
    const relativePath = path.relative(baseDir, file.targetPath);
    const exists = await fs.pathExists(file.targetPath);

    if (!exists) {
      summary.toCreate.push(relativePath);
    } else {
      switch (file.overwrite) {
        case "skip":
        case "skip-dir":
          summary.toSkip.push(relativePath);
          break;
        case "abort":
          summary.toAbort.push(relativePath);
          break;
        case "overwrite":
        case "prompt":
        case "merge":
          summary.toOverwrite.push(relativePath);
          break;
      }
    }
  }

  return summary;
}

/**
 * Create a backup of a file before overwriting
 */
export async function backupFile(filePath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.backup-${timestamp}`;

  await fs.copy(filePath, backupPath);

  return backupPath;
}

/**
 * Restore a file from backup
 */
export async function restoreFile(
  filePath: string,
  backupPath: string
): Promise<void> {
  await fs.move(backupPath, filePath, { overwrite: true });
}
