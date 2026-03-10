/**
 * Logger utility with chalk-based colored output and ora spinners
 * Provides consistent CLI output formatting across the create-marketing-os tool
 */

import chalk from "chalk";
import ora, { Ora } from "ora";

export class Logger {
  private verbose: boolean;
  private activeSpinner: Ora | null = null;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /**
   * Set verbose mode for detailed output
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  /**
   * Log info message (blue)
   */
  info(message: string): void {
    console.log(chalk.blue("ℹ"), message);
  }

  /**
   * Log success message (green with checkmark)
   */
  success(message: string): void {
    console.log(chalk.green("✓"), message);
  }

  /**
   * Log error message (red with X)
   */
  error(message: string, error?: Error): void {
    console.error(chalk.red("✗"), message);
    if (error && this.verbose) {
      console.error(chalk.red(error.stack || error.message));
    }
  }

  /**
   * Log warning message (yellow with warning symbol)
   */
  warning(message: string): void {
    console.log(chalk.yellow("⚠"), message);
  }

  /**
   * Log debug message (only in verbose mode)
   */
  debug(message: string): void {
    if (this.verbose) {
      console.log(chalk.gray("›"), chalk.gray(message));
    }
  }

  /**
   * Create and start a spinner
   */
  spinner(text: string): Ora {
    if (this.activeSpinner) {
      this.activeSpinner.stop();
    }
    this.activeSpinner = ora({
      text,
      color: "cyan",
      spinner: "dots",
    }).start();
    return this.activeSpinner;
  }

  /**
   * Update the active spinner text
   */
  updateSpinner(text: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.text = text;
    }
  }

  /**
   * Stop the active spinner with success
   */
  spinnerSuccess(text?: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.succeed(text);
      this.activeSpinner = null;
    }
  }

  /**
   * Stop the active spinner with error
   */
  spinnerError(text?: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.fail(text);
      this.activeSpinner = null;
    }
  }

  /**
   * Stop the active spinner with warning
   */
  spinnerWarning(text?: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.warn(text);
      this.activeSpinner = null;
    }
  }

  /**
   * Stop the active spinner with info
   */
  spinnerInfo(text?: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.info(text);
      this.activeSpinner = null;
    }
  }

  /**
   * Stop any active spinner
   */
  stopSpinner(): void {
    if (this.activeSpinner) {
      this.activeSpinner.stop();
      this.activeSpinner = null;
    }
  }

  /**
   * Log a blank line
   */
  newLine(): void {
    console.log();
  }

  /**
   * Log a section header
   */
  section(title: string): void {
    console.log();
    console.log(chalk.bold.cyan(title));
    console.log(chalk.cyan("─".repeat(title.length)));
  }

  /**
   * Log a command suggestion
   */
  command(cmd: string): void {
    console.log(chalk.gray("  $ ") + chalk.white(cmd));
  }

  /**
   * Log a file path
   */
  path(filePath: string): void {
    console.log(chalk.cyan(filePath));
  }

  /**
   * Log a URL
   */
  url(url: string): void {
    console.log(chalk.blue.underline(url));
  }

  /**
   * Format error with suggestion (per CLI spec section 8)
   */
  errorWithSuggestion(message: string, suggestion: string, error?: Error): void {
    this.error(message, error);
    console.log(chalk.gray("  Suggestion:"), chalk.white(suggestion));
  }

  /**
   * Log a list of items with checkmarks
   */
  list(items: Array<{ text: string; checked?: boolean; warning?: boolean }>): void {
    items.forEach(item => {
      if (item.warning) {
        console.log(chalk.yellow("  ⚠"), item.text);
      } else if (item.checked) {
        console.log(chalk.green("  ✓"), item.text);
      } else {
        console.log(chalk.gray("  ☐"), item.text);
      }
    });
  }

  /**
   * Log formatted box (for setup prompts)
   */
  box(lines: string[]): void {
    const maxLength = Math.max(...lines.map(l => l.length));
    const width = Math.min(maxLength + 4, 80);

    console.log();
    console.log(chalk.gray("┌" + "─".repeat(width) + "┐"));
    lines.forEach(line => {
      const padding = " ".repeat(Math.max(0, width - line.length - 2));
      console.log(chalk.gray("│") + " " + line + padding + " " + chalk.gray("│"));
    });
    console.log(chalk.gray("└" + "─".repeat(width) + "┘"));
    console.log();
  }
}

// Export singleton instance for convenience
export const logger = new Logger();

// Export type for dependency injection
export type ILogger = Logger;
