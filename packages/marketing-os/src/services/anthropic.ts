/**
 * Anthropic API key setup
 * Opens browser to Anthropic Console for API key creation
 */

import chalk from "chalk";
import open from "open";
import { execa } from "execa";

const ANTHROPIC_CONSOLE_URL = "https://console.anthropic.com/settings/keys";

/**
 * Copy text to clipboard (cross-platform)
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      await execa("pbcopy", { input: text });
    } else if (platform === "linux") {
      try {
        await execa("xclip", ["-selection", "clipboard"], { input: text });
      } catch {
        await execa("xsel", ["--clipboard", "--input"], { input: text });
      }
    } else if (platform === "win32") {
      await execa("clip", { input: text });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Open Anthropic Console for API key creation
 */
export async function openAnthropicConsole(): Promise<void> {
  console.log(chalk.dim("\n  Opening Anthropic Console in your browser..."));
  console.log(chalk.dim(`  URL: ${ANTHROPIC_CONSOLE_URL}\n`));

  await open(ANTHROPIC_CONSOLE_URL);
}

/**
 * Display instructions for getting Anthropic API key
 */
export function displayAnthropicInstructions(): void {
  console.log(chalk.bold("\n  📋 To get your Anthropic API key:\n"));
  console.log(chalk.dim("  1. Sign in to Anthropic Console (opening in browser)"));
  console.log(chalk.dim("  2. Click 'Create Key'"));
  console.log(chalk.dim("  3. Give it a name (e.g., 'Marketing OS')"));
  console.log(chalk.dim("  4. Copy the key (starts with 'sk-ant-')"));
  console.log(chalk.dim("  5. Paste it back here\n"));
}

/**
 * Validate Anthropic API key format
 */
export function validateAnthropicKey(key: string): {
  valid: boolean;
  error?: string;
} {
  if (!key) {
    return { valid: false, error: "API key is required" };
  }

  if (!key.startsWith("sk-ant-")) {
    return {
      valid: false,
      error: "API key should start with 'sk-ant-'",
    };
  }

  return { valid: true };
}

/**
 * Test Anthropic API key by making a simple request
 */
export async function testAnthropicKey(
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    if (response.ok) {
      return { valid: true };
    }

    const error = await response.json() as { error?: { message?: string } };
    return {
      valid: false,
      error: error.error?.message || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
