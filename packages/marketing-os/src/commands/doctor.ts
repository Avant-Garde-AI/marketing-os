/**
 * doctor command - Validate installation
 * Checks env vars, Supabase, GitHub secrets
 */

import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";

interface DoctorOptions {
  verbose?: boolean;
}

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

/**
 * Check if a file exists
 */
async function checkFileExists(
  filePath: string,
  name: string
): Promise<CheckResult> {
  const exists = await fs.pathExists(filePath);
  return {
    name,
    status: exists ? "pass" : "fail",
    message: exists
      ? `Found: ${path.basename(filePath)}`
      : `Missing: ${path.basename(filePath)}`,
  };
}

/**
 * Check environment variables in .env.local
 */
async function checkEnvVars(agentsDir: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const envPath = path.join(agentsDir, ".env.local");

  const envExists = await fs.pathExists(envPath);

  if (!envExists) {
    results.push({
      name: "Environment file",
      status: "warn",
      message: ".env.local not found (optional for production)",
    });
    return results;
  }

  const envContent = await fs.readFile(envPath, "utf-8");
  const envVars = envContent
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0]);

  // Required env vars
  const requiredVars = ["ANTHROPIC_API_KEY"];

  const optionalVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SHOPIFY_ACCESS_TOKEN",
    "GA4_PROPERTY_ID",
    "META_ACCESS_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
    "KLAVIYO_API_KEY",
  ];

  for (const varName of requiredVars) {
    const exists = envVars.includes(varName);
    results.push({
      name: `Env: ${varName}`,
      status: exists ? "pass" : "fail",
      message: exists ? "Set" : "Missing (required)",
    });
  }

  for (const varName of optionalVars) {
    const exists = envVars.includes(varName);
    if (exists) {
      results.push({
        name: `Env: ${varName}`,
        status: "pass",
        message: "Set",
      });
    }
  }

  return results;
}

/**
 * Check GitHub secrets
 */
async function checkGitHubSecrets(
  repoFullName: string
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const { stdout } = await execa("gh", [
      "secret",
      "list",
      "--repo",
      repoFullName,
    ]);

    const secrets = stdout
      .split("\n")
      .filter((line) => line)
      .map((line) => line.split(/\s+/)[0]);

    const requiredSecrets = ["ANTHROPIC_API_KEY"];
    const optionalSecrets = [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SHOPIFY_ACCESS_TOKEN",
      "GA4_PROPERTY_ID",
      "META_ACCESS_TOKEN",
      "GOOGLE_ADS_CUSTOMER_ID",
      "KLAVIYO_API_KEY",
    ];

    for (const secretName of requiredSecrets) {
      const exists = secrets.includes(secretName);
      results.push({
        name: `Secret: ${secretName}`,
        status: exists ? "pass" : "fail",
        message: exists ? "Set" : "Missing (required for GitHub Actions)",
      });
    }

    for (const secretName of optionalSecrets) {
      const exists = secrets.includes(secretName);
      if (exists) {
        results.push({
          name: `Secret: ${secretName}`,
          status: "pass",
          message: "Set",
        });
      }
    }
  } catch {
    results.push({
      name: "GitHub Secrets",
      status: "fail",
      message: "Failed to check GitHub secrets (is gh CLI authenticated?)",
    });
  }

  return results;
}

/**
 * Check Supabase connection
 */
async function checkSupabase(agentsDir: string): Promise<CheckResult> {
  const envPath = path.join(agentsDir, ".env.local");

  if (!(await fs.pathExists(envPath))) {
    return {
      name: "Supabase connection",
      status: "warn",
      message: "Cannot check (no .env.local file)",
    };
  }

  const envContent = await fs.readFile(envPath, "utf-8");
  const urlMatch = envContent.match(
    /NEXT_PUBLIC_SUPABASE_URL=(.+)/
  );
  const keyMatch = envContent.match(
    /NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/
  );

  if (!urlMatch || !keyMatch) {
    return {
      name: "Supabase connection",
      status: "warn",
      message: "Not configured (optional, using local SQLite)",
    };
  }

  try {
    // Try to fetch from Supabase
    const url = urlMatch[1]?.trim() || "";
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: keyMatch[1]?.trim() || "",
      },
    });

    if (response.ok || response.status === 404) {
      return {
        name: "Supabase connection",
        status: "pass",
        message: "Connected successfully",
      };
    } else {
      return {
        name: "Supabase connection",
        status: "fail",
        message: `Connection failed (HTTP ${response.status})`,
      };
    }
  } catch (error) {
    return {
      name: "Supabase connection",
      status: "fail",
      message: `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Check Vercel project
 */
async function checkVercel(agentsDir: string): Promise<CheckResult> {
  const vercelPath = path.join(agentsDir, ".vercel");

  if (!(await fs.pathExists(vercelPath))) {
    return {
      name: "Vercel project",
      status: "warn",
      message: "Not linked (run 'vercel link' in agents/)",
    };
  }

  try {
    const projectJson = await fs.readJson(
      path.join(vercelPath, "project.json")
    );
    return {
      name: "Vercel project",
      status: "pass",
      message: `Linked: ${projectJson.name || "Unknown"}`,
    };
  } catch {
    return {
      name: "Vercel project",
      status: "warn",
      message: "Link corrupted (run 'vercel link' again)",
    };
  }
}

/**
 * Check dependencies installation
 */
async function checkDependencies(agentsDir: string): Promise<CheckResult> {
  const nodeModulesPath = path.join(agentsDir, "node_modules");

  if (!(await fs.pathExists(nodeModulesPath))) {
    return {
      name: "Dependencies",
      status: "fail",
      message: "Not installed (run 'npm install' in agents/)",
    };
  }

  return {
    name: "Dependencies",
    status: "pass",
    message: "Installed",
  };
}

/**
 * Print check result
 */
function printResult(result: CheckResult): void {
  let icon: string;
  let color: (text: string) => string;

  switch (result.status) {
    case "pass":
      icon = "✓";
      color = chalk.green;
      break;
    case "warn":
      icon = "⚠";
      color = chalk.yellow;
      break;
    case "fail":
      icon = "✗";
      color = chalk.red;
      break;
  }

  console.log(
    `  ${color(icon)} ${chalk.bold(result.name)}: ${chalk.dim(result.message)}`
  );
}

export async function doctorCommand(_options: DoctorOptions): Promise<void> {
  try {
    console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────┐"));
    console.log(chalk.bold.cyan("│  Marketing OS Doctor                    │"));
    console.log(chalk.bold.cyan("└─────────────────────────────────────────┘\n"));

    const spinner = ora("Running diagnostics...").start();

    // Check if we're in a Marketing OS project
    const configPath = path.join(process.cwd(), "marketing-os.config.json");
    if (!(await fs.pathExists(configPath))) {
      spinner.fail();
      console.error(
        chalk.red.bold(
          "\n✗ Not in a Marketing OS project. Run this command from your theme repository root.\n"
        )
      );
      process.exit(1);
    }

    const config = await fs.readJson(configPath);
    const agentsDir = path.join(process.cwd(), "agents");

    spinner.stop();

    // Run checks
    const allResults: CheckResult[] = [];

    // 1. File structure
    console.log(chalk.bold("\n📁 File Structure\n"));

    const fileChecks = [
      await checkFileExists(configPath, "Config file"),
      await checkFileExists(
        path.join(agentsDir, "package.json"),
        "Agents package.json"
      ),
      await checkFileExists(
        path.join(process.cwd(), "CLAUDE.md"),
        "CLAUDE.md"
      ),
      await checkFileExists(
        path.join(process.cwd(), ".github/workflows/marketing-os-agent.yml"),
        "GitHub workflow"
      ),
      await checkFileExists(
        path.join(process.cwd(), "docs/brand-voice.md"),
        "Brand voice docs"
      ),
    ];

    for (const result of fileChecks) {
      printResult(result);
      allResults.push(result);
    }

    // 2. Dependencies
    console.log(chalk.bold("\n📦 Dependencies\n"));

    const depsCheck = await checkDependencies(agentsDir);
    printResult(depsCheck);
    allResults.push(depsCheck);

    // 3. Environment variables
    console.log(chalk.bold("\n🔑 Environment Variables\n"));

    const envChecks = await checkEnvVars(agentsDir);
    for (const result of envChecks) {
      printResult(result);
      allResults.push(result);
    }

    // 4. GitHub secrets
    if (config.repository) {
      console.log(chalk.bold("\n🔐 GitHub Secrets\n"));

      const secretChecks = await checkGitHubSecrets(config.repository);
      for (const result of secretChecks) {
        printResult(result);
        allResults.push(result);
      }
    }

    // 5. Supabase
    console.log(chalk.bold("\n🗄️  Supabase\n"));

    const supabaseCheck = await checkSupabase(agentsDir);
    printResult(supabaseCheck);
    allResults.push(supabaseCheck);

    // 6. Vercel
    console.log(chalk.bold("\n🚀 Vercel\n"));

    const vercelCheck = await checkVercel(agentsDir);
    printResult(vercelCheck);
    allResults.push(vercelCheck);

    // Summary
    const passCount = allResults.filter((r) => r.status === "pass").length;
    const warnCount = allResults.filter((r) => r.status === "warn").length;
    const failCount = allResults.filter((r) => r.status === "fail").length;

    console.log(chalk.bold("\n📊 Summary\n"));
    console.log(
      `  ${chalk.green("✓")} ${passCount} passed  ${chalk.yellow("⚠")} ${warnCount} warnings  ${chalk.red("✗")} ${failCount} failed`
    );

    if (failCount > 0) {
      console.log(
        chalk.red.bold(
          "\n⚠ Some critical checks failed. Please address the issues above.\n"
        )
      );
      process.exit(1);
    } else if (warnCount > 0) {
      console.log(
        chalk.yellow(
          "\n⚠ Some optional checks had warnings. Your setup should still work.\n"
        )
      );
    } else {
      console.log(
        chalk.green.bold("\n✓ All checks passed! Your installation looks healthy.\n")
      );
    }
  } catch (error) {
    console.error(chalk.red("\n✗ Doctor check failed:"), error);
    process.exit(1);
  }
}
