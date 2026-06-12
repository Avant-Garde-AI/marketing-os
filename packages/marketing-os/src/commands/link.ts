/**
 * link command - Connect a scaffolded installation to the hosted
 * Marketing OS platform.
 *
 * Registers (or refreshes) this store as a tenant, receives a tenant API key,
 * and writes MARKETING_OS_API_URL / MARKETING_OS_API_KEY into agents/.env.local
 * so the agents fetch their Shopify access token from the platform token
 * broker instead of a hand-pasted SHOPIFY_ACCESS_TOKEN.
 */

import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import ora from "ora";
import { input } from "@inquirer/prompts";
import { CONFIG_FILE_NAME } from "../utils/config.js";

const DEFAULT_PLATFORM_URL = "https://marketing-os-app.vercel.app";

export interface LinkOptions {
  platformUrl?: string;
  email?: string;
  agentsUrl?: string;
  adminSecret?: string;
}

export async function linkCommand(options: LinkOptions): Promise<void> {
  const workingDir = process.cwd();

  console.log(chalk.bold("\n┌─────────────────────────────────────────┐"));
  console.log(chalk.bold("│  Marketing OS Link                      │"));
  console.log(chalk.bold("└─────────────────────────────────────────┘\n"));

  // Read store config
  const configPath = path.join(workingDir, CONFIG_FILE_NAME);
  if (!(await fs.pathExists(configPath))) {
    console.log(
      chalk.red(
        `✗ No ${CONFIG_FILE_NAME} found. Run this from a Marketing OS repo (or run init first).`
      )
    );
    process.exitCode = 1;
    return;
  }
  const config = await fs.readJson(configPath);
  const shop: string | undefined = config?.store?.url;
  if (!shop) {
    console.log(chalk.red(`✗ ${CONFIG_FILE_NAME} has no store.url.`));
    process.exitCode = 1;
    return;
  }

  const platformUrl = (
    options.platformUrl ??
    process.env.MARKETING_OS_PLATFORM_URL ??
    DEFAULT_PLATFORM_URL
  ).replace(/\/$/, "");

  const email =
    options.email ??
    (await input({ message: "Account email:", required: true }));

  const adminSecret =
    options.adminSecret ?? process.env.PLATFORM_ADMIN_SECRET;
  if (!adminSecret) {
    console.log(
      chalk.red(
        "✗ Missing platform admin secret. Pass --admin-secret or set PLATFORM_ADMIN_SECRET."
      )
    );
    console.log(
      chalk.dim(
        "  (Self-serve signup is coming; linking currently requires an operator secret.)"
      )
    );
    process.exitCode = 1;
    return;
  }

  const spinner = ora(`Registering ${shop} with ${platformUrl}...`).start();

  let result: {
    tenantId: string;
    shop: string;
    apiKey: string;
  };
  try {
    const response = await fetch(`${platformUrl}/api/tenants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSecret}`,
      },
      body: JSON.stringify({
        email,
        shop,
        agentsUrl: options.agentsUrl,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${body}`);
    }
    result = (await response.json()) as typeof result;
  } catch (error) {
    spinner.fail(chalk.red("Failed to register tenant"));
    console.error(
      chalk.dim(`  ${error instanceof Error ? error.message : error}`)
    );
    process.exitCode = 1;
    return;
  }
  spinner.succeed(chalk.green(`Linked ${result.shop} (tenant ${result.tenantId})`));

  // Write broker credentials into agents/.env.local
  const envPath = path.join(workingDir, "agents", ".env.local");
  const lines = [
    "",
    "# Marketing OS platform link (added by `marketing-os link`)",
    `MARKETING_OS_API_URL=${platformUrl}`,
    `MARKETING_OS_API_KEY=${result.apiKey}`,
    "",
  ].join("\n");

  if (await fs.pathExists(envPath)) {
    const existing = await fs.readFile(envPath, "utf-8");
    const cleaned = existing
      .split("\n")
      .filter(
        (line) =>
          !line.startsWith("MARKETING_OS_API_URL=") &&
          !line.startsWith("MARKETING_OS_API_KEY=") &&
          line !== "# Marketing OS platform link (added by `marketing-os link`)"
      )
      .join("\n");
    await fs.writeFile(envPath, cleaned + lines);
  } else {
    await fs.ensureDir(path.dirname(envPath));
    await fs.writeFile(envPath, lines.trimStart());
  }
  console.log(chalk.green(`✓ Wrote broker credentials to agents/.env.local`));

  console.log(chalk.bold("\nNext steps:\n"));
  console.log(
    `  1. Add the same two env vars to your Vercel project:\n     ${chalk.cyan(
      `MARKETING_OS_API_URL=${platformUrl}`
    )}\n     ${chalk.cyan("MARKETING_OS_API_KEY=<shown once above>")}`
  );
  console.log(
    `  2. Install the Marketing OS app on ${chalk.cyan(shop)} so the broker has a token to serve.`
  );
  console.log(
    `  3. Remove SHOPIFY_ACCESS_TOKEN once the app is installed — it is no longer needed.\n`
  );
}
