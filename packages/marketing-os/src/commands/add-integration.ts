/**
 * add-integration command - Add integration to existing install
 */

import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import { select, password, input, confirm } from "@inquirer/prompts";
import { setGitHubSecrets } from "../utils/github.js";

interface AddIntegrationOptions {
  integration?: string;
}

interface Integration {
  id: string;
  name: string;
  description: string;
  toolFile: string;
  envVars: Array<{
    key: string;
    prompt: string;
    type: "text" | "password";
  }>;
}

const INTEGRATIONS: Integration[] = [
  {
    id: "ga4",
    name: "Google Analytics (GA4)",
    description: "Fetch analytics data and insights",
    toolFile: "ga4-reporting.ts",
    envVars: [
      {
        key: "GA4_PROPERTY_ID",
        prompt: "GA4 Property ID:",
        type: "text",
      },
      {
        key: "GA4_CREDENTIALS_JSON",
        prompt: "GA4 Service Account JSON (paste full JSON):",
        type: "password",
      },
    ],
  },
  {
    id: "meta",
    name: "Meta Ads",
    description: "Manage Facebook and Instagram ads",
    toolFile: "meta-ads.ts",
    envVars: [
      {
        key: "META_ACCESS_TOKEN",
        prompt: "Meta Ads access token:",
        type: "password",
      },
      {
        key: "META_AD_ACCOUNT_ID",
        prompt: "Meta Ad Account ID:",
        type: "text",
      },
    ],
  },
  {
    id: "google-ads",
    name: "Google Ads",
    description: "Manage Google Ads campaigns",
    toolFile: "google-ads.ts",
    envVars: [
      {
        key: "GOOGLE_ADS_CUSTOMER_ID",
        prompt: "Google Ads Customer ID:",
        type: "text",
      },
      {
        key: "GOOGLE_ADS_CREDENTIALS_JSON",
        prompt: "Google Ads credentials JSON:",
        type: "password",
      },
    ],
  },
  {
    id: "klaviyo",
    name: "Klaviyo",
    description: "Email marketing automation",
    toolFile: "klaviyo.ts",
    envVars: [
      {
        key: "KLAVIYO_API_KEY",
        prompt: "Klaviyo API key:",
        type: "password",
      },
    ],
  },
];

const TOOL_TEMPLATES: Record<string, string> = {
  klaviyo: `/**
 * Klaviyo integration tool
 */

import { Tool } from "@mastra/core";

export const klaviyoTool = new Tool({
  id: "klaviyo",
  name: "Klaviyo",
  description: "Interact with Klaviyo email marketing platform",

  async execute({ action, params }) {
    const apiKey = process.env.KLAVIYO_API_KEY;

    if (!apiKey) {
      throw new Error("KLAVIYO_API_KEY environment variable not set");
    }

    const baseUrl = "https://a.klaviyo.com/api";

    // TODO: Implement Klaviyo API calls
    // Example actions: getProfiles, createCampaign, getMetrics, etc.

    switch (action) {
      case "getProfiles":
        // Fetch profiles
        break;

      case "getMetrics":
        // Fetch metrics
        break;

      default:
        throw new Error(\`Unknown action: \${action}\`);
    }

    return {
      success: true,
      data: {},
    };
  },
});
`,
};

export async function addIntegrationCommand(
  integrationName: string | undefined,
  _options: AddIntegrationOptions
): Promise<void> {
  try {
    console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────┐"));
    console.log(chalk.bold.cyan("│  Add Integration                        │"));
    console.log(chalk.bold.cyan("└─────────────────────────────────────────┘\n"));

    // Check if we're in a Marketing OS project
    const configPath = path.join(process.cwd(), "marketing-os.config.json");
    if (!(await fs.pathExists(configPath))) {
      console.error(
        chalk.red.bold(
          "\n✗ Not in a Marketing OS project. Run this command from your theme repository root.\n"
        )
      );
      process.exit(1);
    }

    // Check if agents directory exists
    const agentsDir = path.join(process.cwd(), "agents");
    if (!(await fs.pathExists(agentsDir))) {
      console.error(
        chalk.red.bold(
          "\n✗ agents/ directory not found. Marketing OS may not be properly installed.\n"
        )
      );
      process.exit(1);
    }

    // Load config
    const config = await fs.readJson(configPath);
    const existingIntegrations = config.integrations || [];

    // Select integration
    let integration: Integration | undefined;

    if (integrationName) {
      integration = INTEGRATIONS.find(
        (i) => i.id === integrationName || i.name === integrationName
      );
      if (!integration) {
        console.error(
          chalk.red.bold(
            `\n✗ Unknown integration: ${integrationName}\n`
          )
        );
        console.log(chalk.dim("Available integrations:"));
        for (const i of INTEGRATIONS) {
          console.log(chalk.dim(`  - ${i.id}: ${i.name}`));
        }
        console.log();
        process.exit(1);
      }
    } else {
      const integrationId = await select({
        message: "Which integration do you want to add?",
        choices: INTEGRATIONS.map((i) => ({
          name: `${i.name} - ${i.description}`,
          value: i.id,
          disabled: existingIntegrations.includes(i.id)
            ? "Already installed"
            : false,
        })),
      });

      integration = INTEGRATIONS.find((i) => i.id === integrationId)!;
    }

    // Check if already installed
    if (existingIntegrations.includes(integration.id)) {
      console.log(
        chalk.yellow(`\n⚠ ${integration.name} is already installed.\n`)
      );
      const shouldContinue = await confirm({
        message: "Reconfigure credentials?",
        default: false,
      });

      if (!shouldContinue) {
        console.log(chalk.dim("→ Aborted."));
        process.exit(0);
      }
    }

    // Collect credentials
    console.log(chalk.bold(`\n🔑 ${integration.name} Configuration\n`));

    const credentials: Record<string, string> = {};

    for (const envVar of integration.envVars) {
      if (envVar.type === "password") {
        credentials[envVar.key] = await password({
          message: envVar.prompt,
          mask: "*",
          validate: (value) => {
            if (!value) return "This field is required";
            return true;
          },
        });
      } else {
        credentials[envVar.key] = await input({
          message: envVar.prompt,
          validate: (value) => {
            if (!value) return "This field is required";
            return true;
          },
        });
      }
    }

    // Check if tool file exists
    const toolsDir = path.join(agentsDir, "src/mastra/tools");
    const toolPath = path.join(toolsDir, integration.toolFile);
    const toolExists = await fs.pathExists(toolPath);

    if (!toolExists) {
      console.log(chalk.yellow(`\n⚠ Tool file not found: ${integration.toolFile}`));

      // Check if we have a template
      if (TOOL_TEMPLATES[integration.id]) {
        const shouldCreate = await confirm({
          message: "Create tool file from template?",
          default: true,
        });

        if (shouldCreate) {
          await fs.ensureDir(toolsDir);
          await fs.writeFile(toolPath, TOOL_TEMPLATES[integration.id], "utf-8");
          console.log(
            chalk.green(
              `✓ Created tool file: ${path.relative(process.cwd(), toolPath)}`
            )
          );
        }
      } else {
        console.log(
          chalk.dim(
            `\n→ You'll need to create ${integration.toolFile} manually.`
          )
        );
        console.log(
          chalk.dim(
            `   See templates/ directory for examples.`
          )
        );
      }
    }

    // Update config
    if (!existingIntegrations.includes(integration.id)) {
      existingIntegrations.push(integration.id);
      config.integrations = existingIntegrations;
      await fs.writeJson(configPath, config, { spaces: 2 });
      console.log(chalk.green("\n✓ Updated marketing-os.config.json"));
    }

    // Set GitHub secrets
    const shouldSetSecrets = await confirm({
      message: "Set GitHub Actions secrets?",
      default: true,
    });

    if (shouldSetSecrets) {
      const repoFullName = config.repository;
      if (!repoFullName) {
        console.log(
          chalk.yellow(
            "\n⚠ Repository not found in config. Skipping GitHub secrets."
          )
        );
      } else {
        try {
          await setGitHubSecrets(repoFullName, credentials);
        } catch {
          console.log(
            chalk.yellow(
              "\n⚠ Failed to set GitHub secrets. You may need to set them manually."
            )
          );
        }
      }
    }

    // Create .env.local if needed
    const envLocalPath = path.join(agentsDir, ".env.local");
    const shouldUpdateEnv = await confirm({
      message: "Add credentials to agents/.env.local for local development?",
      default: true,
    });

    if (shouldUpdateEnv) {
      let envContent = "";

      if (await fs.pathExists(envLocalPath)) {
        envContent = await fs.readFile(envLocalPath, "utf-8");
        envContent += "\n";
      }

      envContent += `# ${integration.name}\n`;
      for (const [key, value] of Object.entries(credentials)) {
        envContent += `${key}=${value}\n`;
      }

      await fs.writeFile(envLocalPath, envContent, "utf-8");
      console.log(
        chalk.green(`\n✓ Updated ${path.relative(process.cwd(), envLocalPath)}`)
      );
    }

    // Success!
    console.log(chalk.bold.green(`\n✓ ${integration.name} integration added!\n`));

    console.log(chalk.bold("Next steps:\n"));
    if (!toolExists && !TOOL_TEMPLATES[integration.id]) {
      console.log(
        chalk.cyan(`  1. Create ${integration.toolFile} in agents/src/mastra/tools/`)
      );
      console.log(chalk.cyan("  2. Implement the integration logic"));
      console.log(chalk.cyan("  3. Export the tool in agents/src/mastra/index.ts"));
      console.log(chalk.cyan(`  4. Test the integration: "Get data from ${integration.name}"\n`));
    } else {
      console.log(
        chalk.cyan(`  1. Review ${integration.toolFile} and implement any TODOs`)
      );
      console.log(chalk.cyan("  2. Export the tool in agents/src/mastra/index.ts"));
      console.log(chalk.cyan(`  3. Test the integration: "Get data from ${integration.name}"\n`));
    }
  } catch (error) {
    console.error(chalk.red("\n✗ Failed to add integration:"), error);
    process.exit(1);
  }
}
