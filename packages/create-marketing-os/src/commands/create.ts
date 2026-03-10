/**
 * create command - Default interactive flow
 * Orchestrates prompts + scaffold + deploy
 */

import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import ora from "ora";
import { input, confirm } from "@inquirer/prompts";
import {
  validatePrerequisites,
  detectPackageManager,
} from "../utils/prerequisites.js";
import {
  promptStoreConfig,
  promptRepoConfig,
  promptServiceConfig,
  promptIntegrationConfig,
  promptDeploy,
} from "../utils/prompts.js";
import {
  scaffold,
  installDependencies,
  detectShopifyTheme,
  getThemeName,
} from "../utils/scaffold.js";
import {
  cloneRepo,
  createGitHubRepo,
  setGitHubSecrets,
  initGitRepo,
  commitAndPush,
} from "../utils/github.js";
import {
  isShopifyCLIInstalled,
  pullTheme,
  extractStoreName,
} from "../utils/shopify.js";
import {
  isVercelCLIInstalled,
  linkVercelProject,
  setVercelEnvVars,
  deployToVercel,
} from "../utils/vercel.js";

interface CreateOptions {
  store?: string;
  repo?: string;
  dir?: string;
  anthropicKey?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  adminEmail?: string;
  deploy?: boolean;
  skipGit?: boolean;
  skipSupabase?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

export async function createCommand(options: CreateOptions): Promise<void> {
  try {
    console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────┐"));
    console.log(chalk.bold.cyan("│  Marketing OS Setup                     │"));
    console.log(chalk.bold.cyan("└─────────────────────────────────────────┘\n"));

    // Check prerequisites
    await validatePrerequisites();

    // Get target directory
    const targetDir = path.resolve(process.cwd(), options.dir || ".");

    // Step 1: Store Connection
    console.log(chalk.bold("\n📦 Step 1: Store Connection\n"));

    let storeUrl: string;
    let storeName: string;

    if (options.store) {
      storeUrl = options.store;
      storeName = extractStoreName(storeUrl);
    } else {
      const storeConfig = await promptStoreConfig();
      storeUrl = storeConfig.storeUrl;
      storeName = storeConfig.storeName;
    }

    // Step 2: Repository Setup
    console.log(chalk.bold("\n📂 Step 2: Repository Setup\n"));

    let repoFullName: string;
    let workingDir: string;

    if (options.repo) {
      repoFullName = options.repo;
      workingDir = path.join(
        targetDir,
        repoFullName.split("/")[1] || "theme"
      );

      const spinner = ora(`Cloning ${repoFullName}...`).start();
      await cloneRepo(repoFullName, workingDir);
      spinner.succeed(chalk.green(`✓ Cloned ${repoFullName}`));

      // Detect theme
      const isTheme = await detectShopifyTheme(workingDir);
      if (isTheme) {
        const themeName = await getThemeName(workingDir);
        console.log(
          chalk.green(`✓ Detected Shopify theme${themeName ? `: ${themeName}` : ""}`)
        );
      } else {
        console.log(
          chalk.yellow(
            "⚠ No Shopify theme detected - scaffolding into repository anyway"
          )
        );
      }
    } else {
      const repoConfig = await promptRepoConfig();
      repoFullName = repoConfig.repoFullName;

      if (repoConfig.hasExistingRepo) {
        // Clone existing repo
        workingDir = path.join(
          targetDir,
          repoFullName.split("/")[1] || "theme"
        );
        await cloneRepo(repoFullName, workingDir);

        // Detect theme
        const isTheme = await detectShopifyTheme(workingDir);
        if (isTheme) {
          const themeName = await getThemeName(workingDir);
          console.log(
            chalk.green(`✓ Detected Shopify theme${themeName ? `: ${themeName}` : ""}`)
          );
        }
      } else {
        // Create new repo and pull theme
        workingDir = path.join(targetDir, repoConfig.repoName!);
        await fs.ensureDir(workingDir);

        // Check if Shopify CLI is available
        const hasShopifyCLI = await isShopifyCLIInstalled();

        if (hasShopifyCLI) {
          const shouldPull = await confirm({
            message: "Pull theme from Shopify store now?",
            default: true,
          });

          if (shouldPull) {
            await pullTheme(storeUrl, workingDir);
          } else {
            console.log(
              chalk.dim(
                "→ Skipping theme pull. You can pull later with: shopify theme pull"
              )
            );
            await initGitRepo(workingDir);
          }
        } else {
          console.log(
            chalk.yellow(
              "⚠ Shopify CLI not found. Skipping theme pull.\n  Install from: https://shopify.dev/docs/api/shopify-cli"
            )
          );
          await initGitRepo(workingDir);
        }

        // Create GitHub repo
        if (!options.skipGit) {
          await createGitHubRepo(
            repoConfig.repoName!,
            repoConfig.repoOrg!,
            true
          );

          // Initial commit and push
          await commitAndPush(
            workingDir,
            "Initial commit: Shopify theme",
            "origin",
            "main"
          );
        }
      }
    }

    // Step 3: Service Configuration
    let anthropicKey: string;
    let supabaseUrl: string | undefined;
    let supabaseAnonKey: string | undefined;
    let adminEmail: string;
    let useSupabase: boolean;

    if (
      options.anthropicKey &&
      options.adminEmail &&
      (options.skipSupabase || (options.supabaseUrl && options.supabaseAnonKey))
    ) {
      // Use provided options
      anthropicKey = options.anthropicKey;
      supabaseUrl = options.supabaseUrl;
      supabaseAnonKey = options.supabaseAnonKey;
      adminEmail = options.adminEmail;
      useSupabase = !options.skipSupabase;
    } else {
      // Prompt for service config
      const serviceConfig = await promptServiceConfig();
      anthropicKey = serviceConfig.anthropicKey;
      supabaseUrl = serviceConfig.supabaseUrl;
      supabaseAnonKey = serviceConfig.supabaseAnonKey;
      adminEmail = serviceConfig.adminEmail;
      useSupabase = serviceConfig.useSupabase;
    }

    // Step 4: Integrations
    console.log(chalk.bold("\n🔌 Step 3: Integrations\n"));

    const integrationConfig = await promptIntegrationConfig();

    // Step 5: Scaffolding
    console.log(chalk.bold("\n🏗️  Step 4: Scaffolding\n"));

    await scaffold(workingDir, {
      storeName,
      storeUrl,
      supabaseUrl,
      adminEmail,
      repoFullName,
      enabledIntegrations: integrationConfig.enabledIntegrations,
    });

    // Install dependencies
    const packageManager = await detectPackageManager();
    await installDependencies(workingDir, packageManager);

    // Step 6: Secrets & Deploy
    console.log(chalk.bold("\n🔐 Step 5: Secrets & Deploy\n"));

    // Set GitHub secrets
    if (!options.skipGit) {
      const secrets: Record<string, string> = {
        ANTHROPIC_API_KEY: anthropicKey,
      };

      if (useSupabase && supabaseUrl && supabaseAnonKey) {
        secrets.SUPABASE_URL = supabaseUrl;
        secrets.SUPABASE_ANON_KEY = supabaseAnonKey;
      }

      // Add integration credentials
      if (integrationConfig.credentials.shopify) {
        secrets.SHOPIFY_ACCESS_TOKEN =
          integrationConfig.credentials.shopify.accessToken;
      }

      if (integrationConfig.credentials.ga4) {
        secrets.GA4_PROPERTY_ID = integrationConfig.credentials.ga4.propertyId;
        secrets.GA4_CREDENTIALS_JSON =
          integrationConfig.credentials.ga4.credentialsJson;
      }

      if (integrationConfig.credentials.meta) {
        secrets.META_ACCESS_TOKEN =
          integrationConfig.credentials.meta.accessToken;
        secrets.META_AD_ACCOUNT_ID =
          integrationConfig.credentials.meta.adAccountId;
      }

      if (integrationConfig.credentials["google-ads"]) {
        secrets.GOOGLE_ADS_CUSTOMER_ID =
          integrationConfig.credentials["google-ads"].customerId;
        secrets.GOOGLE_ADS_CREDENTIALS_JSON =
          integrationConfig.credentials["google-ads"].credentialsJson;
      }

      if (integrationConfig.credentials.klaviyo) {
        secrets.KLAVIYO_API_KEY =
          integrationConfig.credentials.klaviyo.apiKey;
      }

      await setGitHubSecrets(repoFullName, secrets);
    }

    // Deploy to Vercel
    let deployUrl: string | undefined;

    if (options.deploy !== false) {
      const shouldDeploy =
        options.deploy || (await promptDeploy());

      if (shouldDeploy) {
        const hasVercelCLI = await isVercelCLIInstalled();

        if (hasVercelCLI) {
          const agentsDir = path.join(workingDir, "agents");

          // Link project
          await linkVercelProject(agentsDir);

          // Set env vars
          const envVars: Record<string, string> = {
            ANTHROPIC_API_KEY: anthropicKey,
          };

          if (useSupabase && supabaseUrl && supabaseAnonKey) {
            envVars.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
            envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabaseAnonKey;
          }

          await setVercelEnvVars(agentsDir, envVars);

          // Deploy
          deployUrl = await deployToVercel(agentsDir, true);
        } else {
          console.log(
            chalk.yellow(
              "⚠ Vercel CLI not found. Skipping deployment.\n  Install from: https://vercel.com/docs/cli"
            )
          );
          console.log(
            chalk.dim(
              "\n  To deploy later, run:\n    cd agents && vercel"
            )
          );
        }
      } else {
        console.log(
          chalk.dim(
            "\n→ Skipping deployment. To deploy later, run:\n    cd agents && vercel"
          )
        );
      }
    }

    // Success!
    console.log(chalk.bold.green("\n✓ Setup complete!\n"));

    console.log(chalk.bold("Next steps:\n"));

    if (deployUrl) {
      console.log(chalk.cyan(`  1. Open ${deployUrl}`));
      console.log(chalk.cyan(`  2. Log in with: ${adminEmail}`));
    } else {
      console.log(chalk.cyan(`  1. cd ${path.relative(process.cwd(), workingDir)}`));
      console.log(chalk.cyan(`  2. cd agents && npm run dev`));
      console.log(chalk.cyan(`  3. Open http://localhost:3000`));
    }

    console.log(chalk.cyan(`  3. Edit /docs/brand-voice.md with your brand voice`));
    console.log(chalk.cyan(`  4. Try: "How is my store performing?"\n`));
  } catch (error) {
    console.error(chalk.red("\n✗ Setup failed:"), error);
    process.exit(1);
  }
}
