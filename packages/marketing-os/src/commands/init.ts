/**
 * init command - Scaffold into existing repo
 * Detects theme, scaffolds around it
 */

import _path from "path";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import {
  validatePrerequisites,
  detectPackageManager,
} from "../utils/prerequisites.js";
import {
  promptStoreConfig,
  promptServiceConfig,
  promptIntegrationConfig,
} from "../utils/prompts.js";
import {
  scaffold,
  installDependencies,
  detectShopifyTheme,
  getThemeName,
  checkForExistingInstall,
  writeEnvLocal,
  updateSeedWithCredentials,
} from "../utils/scaffold.js";
import { isGitRepo, getGitRepoInfo, setGitHubSecrets } from "../utils/github.js";
import {
  extractProjectRef,
  createSupabaseTablesViaCLI,
  openSupabaseSQLEditor,
  copyToClipboard,
  SCHEMA_SQL,
} from "../services/supabase.js";


interface InitOptions {
  store?: string;
  anthropicKey?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  adminEmail?: string;
  skipSupabase?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

export async function initCommand(rawOptions: InitOptions): Promise<void> {
  try {
    // Fallback: If options are empty, manually parse from process.argv
    // This handles cases where Commander doesn't properly parse subcommand options
    let options = rawOptions;
    if (Object.keys(rawOptions).length === 0 && process.argv.length > 3) {
      const argv = process.argv;
      options = {
        yes: argv.includes('--yes') || argv.includes('-y'),
        store: argv[argv.indexOf('--store') + 1] || undefined,
        anthropicKey: argv[argv.indexOf('--anthropic-key') + 1] || undefined,
        supabaseUrl: argv[argv.indexOf('--supabase-url') + 1] || undefined,
        supabaseAnonKey: argv[argv.indexOf('--supabase-anon-key') + 1] || undefined,
        supabaseServiceKey: argv[argv.indexOf('--supabase-service-key') + 1] || undefined,
        adminEmail: argv[argv.indexOf('--admin-email') + 1] || undefined,
        skipSupabase: argv.includes('--skip-supabase'),
        verbose: argv.includes('--verbose'),
      };
    }

    console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────┐"));
    console.log(chalk.bold.cyan("│  Marketing OS Init                      │"));
    console.log(chalk.bold.cyan("└─────────────────────────────────────────┘\n"));

    // Check prerequisites (skip in non-interactive mode)
    if (!options.yes && process.stdin.isTTY) {
      await validatePrerequisites();
    }

    const workingDir = process.cwd();

    // Check if we're in a git repo
    const isRepo = await isGitRepo(workingDir);
    if (!isRepo) {
      console.error(
        chalk.red.bold(
          "\n✗ Not in a git repository. Please run 'git init' first.\n"
        )
      );
      process.exit(1);
    }

    // Get repo info
    const repoInfo = await getGitRepoInfo(workingDir);
    let repoFullName: string | undefined;

    if (repoInfo?.remote) {
      // Extract repo name from remote URL
      const match = repoInfo.remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
      repoFullName = match?.[1];
      console.log(chalk.green(`✓ Detected GitHub repository: ${repoFullName}`));
    } else {
      console.log(
        chalk.yellow(
          "⚠ No remote repository detected. You can set up GitHub later."
        )
      );
    }

    // Detect Shopify theme
    const isTheme = await detectShopifyTheme(workingDir);
    if (isTheme) {
      const themeName = await getThemeName(workingDir);
      console.log(
        chalk.green(
          `✓ Detected Shopify theme${themeName ? `: ${themeName}` : ""}`
        )
      );
    } else {
      console.log(
        chalk.yellow(
          "⚠ No Shopify theme detected in current directory. Marketing OS will still be installed."
        )
      );

      if (!options.yes && process.stdin.isTTY) {
        const shouldContinue = await confirm({
          message: "Continue anyway?",
          default: true,
        });

        if (!shouldContinue) {
          console.log(chalk.dim("\n→ Aborted."));
          process.exit(0);
        }
      }
    }

    // Check for existing install
    const hasExisting = await checkForExistingInstall(workingDir);
    if (hasExisting) {
      console.error(
        chalk.red.bold(
          "\n✗ Marketing OS already installed (agents/ directory exists)."
        )
      );
      console.error(
        chalk.dim(
          "   If you want to reinstall, please remove the agents/ directory first.\n"
        )
      );
      process.exit(1);
    }

    // Step 1: Store Configuration
    let storeUrl: string;
    let storeName: string;

    if (options.store) {
      storeUrl = options.store;
      storeName = storeUrl.replace(".myshopify.com", "").replace(/-/g, " ");
    } else {
      const storeConfig = await promptStoreConfig();
      storeUrl = storeConfig.storeUrl;
      storeName = storeConfig.storeName;
    }

    // Step 2: Service Configuration
    let anthropicKey: string;
    let supabaseUrl: string | undefined;
    let supabaseAnonKey: string | undefined;
    let supabaseServiceKey: string | undefined;
    let adminEmail: string;
    let useSupabase: boolean;

    if (
      options.anthropicKey &&
      options.adminEmail &&
      (options.skipSupabase || (options.supabaseUrl && options.supabaseAnonKey))
    ) {
      anthropicKey = options.anthropicKey;
      supabaseUrl = options.supabaseUrl;
      supabaseAnonKey = options.supabaseAnonKey;
      supabaseServiceKey = options.supabaseServiceKey;
      adminEmail = options.adminEmail;
      useSupabase = !options.skipSupabase;
    } else {
      const serviceConfig = await promptServiceConfig();
      anthropicKey = serviceConfig.anthropicKey;
      supabaseUrl = serviceConfig.supabaseUrl;
      supabaseAnonKey = serviceConfig.supabaseAnonKey;
      supabaseServiceKey = serviceConfig.supabaseServiceKey;
      adminEmail = serviceConfig.adminEmail;
      useSupabase = serviceConfig.useSupabase;
    }

    // Step 3: Integrations
    let integrationConfig: { enabledIntegrations: string[]; credentials: Record<string, Record<string, string>> };
    if (options.yes) {
      integrationConfig = { enabledIntegrations: [], credentials: {} };
    } else {
      console.log(chalk.bold("\n🔌 Integrations\n"));
      integrationConfig = await promptIntegrationConfig();
    }

    // Step 4: Scaffolding
    console.log(chalk.bold("\n🏗️  Scaffolding\n"));

    await scaffold(workingDir, {
      storeName,
      storeUrl,
      supabaseUrl,
      adminEmail,
      repoFullName: repoFullName || "unknown/repo",
      enabledIntegrations: integrationConfig.enabledIntegrations,
    });

    // Write .env.local with actual credentials
    await writeEnvLocal(workingDir, {
      anthropicKey,
      supabaseUrl,
      supabaseAnonKey,
      supabaseServiceKey,
      storeUrl,
      repoFullName: repoFullName || "unknown/repo",
      integrationCredentials: integrationConfig.credentials,
    });

    // Install dependencies
    const packageManager = await detectPackageManager();
    await installDependencies(workingDir, packageManager);

    // Step 4b: Create Supabase tables
    let dbPassword: string | undefined;

    if (useSupabase && supabaseUrl && supabaseAnonKey) {
      console.log(chalk.bold("\n🗄️  Database Setup\n"));

      const projectRef = extractProjectRef(supabaseUrl);
      if (!projectRef) {
        console.log(chalk.yellow("  ⚠ Could not extract project reference from URL\n"));
      } else if (options.yes) {
        // Non-interactive mode - skip database setup, show instructions
        console.log(
          chalk.dim(
            "  Database setup skipped in non-interactive mode.\n" +
            "  Run the SQL in Supabase Studio to create tables:\n" +
            `  https://supabase.com/dashboard/project/${projectRef}/sql/new\n`
          )
        );
      } else {
        // Interactive mode - offer CLI or browser setup
        const shouldSetupDb = await confirm({
          message: "Set up database tables now?",
          default: true,
        });

        if (shouldSetupDb) {
          // Try CLI first
          const cliResult = await createSupabaseTablesViaCLI(projectRef, workingDir);

          // Capture password for seed file and credentials display
          if (cliResult.dbPassword) {
            dbPassword = cliResult.dbPassword;
            // Update seed.sql with admin credentials
            await updateSeedWithCredentials(workingDir, adminEmail, dbPassword);
          }

          if (!cliResult.success) {
            // Fallback to browser
            console.log(chalk.dim("\n  Opening Supabase SQL Editor in your browser..."));

            // Copy SQL to clipboard
            const copied = await copyToClipboard(SCHEMA_SQL);
            if (copied) {
              console.log(chalk.green("  ✓ SQL schema copied to clipboard!\n"));
            }

            // Open browser to SQL Editor
            await openSupabaseSQLEditor(projectRef);

            console.log(chalk.dim("  Paste the SQL in the editor and click 'Run' to create tables.\n"));

            if (!copied) {
              console.log(chalk.dim("  SQL Schema to copy:\n"));
              console.log(chalk.cyan(SCHEMA_SQL));
              console.log("");
            }

            // Wait for user to confirm they've run the SQL
            await confirm({
              message: "Press Enter once you've run the SQL in the browser...",
              default: true,
            });
          }
        } else {
          console.log(
            chalk.dim(
              "\n  You can set up the database later by running the SQL in Supabase Studio:\n" +
              `  https://supabase.com/dashboard/project/${projectRef}/sql/new\n`
            )
          );
        }
      }
    }

    // Step 5: Secrets
    if (repoFullName) {
      console.log(chalk.bold("\n🔐 Setting up secrets\n"));

      const shouldSetSecrets = await confirm({
        message: "Set GitHub Actions secrets now?",
        default: true,
      });

      if (shouldSetSecrets) {
        const secrets: Record<string, string> = {
          ANTHROPIC_API_KEY: anthropicKey,
        };

        if (useSupabase && supabaseUrl && supabaseAnonKey) {
          secrets.SUPABASE_URL = supabaseUrl;
          secrets.SUPABASE_ANON_KEY = supabaseAnonKey;
        }

        // Add integration credentials
        if (integrationConfig.credentials.shopify?.accessToken) {
          secrets.SHOPIFY_ACCESS_TOKEN =
            integrationConfig.credentials.shopify.accessToken;
        }

        if (integrationConfig.credentials.ga4?.propertyId) {
          secrets.GA4_PROPERTY_ID =
            integrationConfig.credentials.ga4.propertyId;
        }
        if (integrationConfig.credentials.ga4?.credentialsJson) {
          secrets.GA4_CREDENTIALS_JSON =
            integrationConfig.credentials.ga4.credentialsJson;
        }

        if (integrationConfig.credentials.meta?.accessToken) {
          secrets.META_ACCESS_TOKEN =
            integrationConfig.credentials.meta.accessToken;
        }
        if (integrationConfig.credentials.meta?.adAccountId) {
          secrets.META_AD_ACCOUNT_ID =
            integrationConfig.credentials.meta.adAccountId;
        }

        if (integrationConfig.credentials["google-ads"]?.customerId) {
          secrets.GOOGLE_ADS_CUSTOMER_ID =
            integrationConfig.credentials["google-ads"].customerId;
        }
        if (integrationConfig.credentials["google-ads"]?.credentialsJson) {
          secrets.GOOGLE_ADS_CREDENTIALS_JSON =
            integrationConfig.credentials["google-ads"].credentialsJson;
        }

        if (integrationConfig.credentials.klaviyo?.apiKey) {
          secrets.KLAVIYO_API_KEY =
            integrationConfig.credentials.klaviyo.apiKey;
        }

        await setGitHubSecrets(repoFullName, secrets);
      }
    } else {
      console.log(
        chalk.yellow(
          "\n⚠ No GitHub repository detected. Skipping secrets setup."
        )
      );
      console.log(
        chalk.dim(
          "   You can set secrets manually later with: gh secret set"
        )
      );
    }

    // Success!
    console.log(chalk.bold.green("\n✓ Marketing OS initialized!\n"));

    // Display admin credentials if we have them
    if (dbPassword) {
      console.log(chalk.bold.cyan("┌─────────────────────────────────────────┐"));
      console.log(chalk.bold.cyan("│  Admin Credentials                      │"));
      console.log(chalk.bold.cyan("├─────────────────────────────────────────┤"));
      console.log(chalk.cyan(`│  Email:    ${adminEmail.padEnd(27)}│`));
      console.log(chalk.cyan(`│  Password: ${dbPassword.padEnd(27)}│`));
      console.log(chalk.bold.cyan("└─────────────────────────────────────────┘\n"));
    }

    console.log(chalk.bold("Next steps:\n"));
    console.log(chalk.cyan("  1. ./agents.sh setup"));
    console.log(chalk.cyan("  2. ./agents.sh dev"));
    console.log(chalk.cyan("  3. Open http://localhost:3000"));
    if (dbPassword) {
      console.log(chalk.cyan(`  4. Log in with credentials above`));
    } else {
      console.log(chalk.cyan(`  4. Log in with: ${adminEmail}`));
    }
    console.log(chalk.cyan("  5. Edit /docs/brand-voice.md with your brand voice"));
    console.log(chalk.cyan('  6. Try: "How is my store performing?"\n'));

    console.log(chalk.dim("To deploy to Vercel:"));
    console.log(chalk.dim("  ./agents.sh deploy\n"));

    console.log(chalk.dim("Run ./agents.sh --help for all commands.\n"));
  } catch (error) {
    console.error(chalk.red("\n✗ Initialization failed:"), error);
    process.exit(1);
  }
}
