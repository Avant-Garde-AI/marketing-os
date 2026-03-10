/**
 * marketing-os
 * CLI tool for AI marketing operations on Shopify
 */

import { Command } from "commander";
import { createCommand } from "./commands/create.js";
import { initCommand } from "./commands/init.js";
import { addSkillCommand } from "./commands/add-skill.js";
import { addIntegrationCommand } from "./commands/add-integration.js";
import { doctorCommand } from "./commands/doctor.js";

const program = new Command();

program
  .name("marketing-os")
  .description("AI marketing operations for Shopify, powered by your git repo")
  .version("0.2.0");

// Default command (create - interactive flow)
program
  .argument("[directory]", "Target directory for scaffolding", ".")
  .option("--store <url>", "Shopify store URL (mystore.myshopify.com)")
  .option("--repo <repo>", "GitHub repository (org/repo)")
  .option("--dir <path>", "Target directory for scaffolding", ".")
  .option("--anthropic-key <key>", "Anthropic API key")
  .option("--supabase-url <url>", "Supabase project URL")
  .option("--supabase-anon-key <key>", "Supabase anon/public key")
  .option("--supabase-service-key <key>", "Supabase service role key (enables auto table creation)")
  .option("--admin-email <email>", "Email for the admin user")
  .option("--deploy", "Auto-deploy to Vercel after scaffolding")
  .option("--skip-git", "Skip git init and GitHub setup")
  .option("--skip-supabase", "Skip Supabase setup (use local SQLite)")
  .option("-y, --yes", "Accept all defaults, skip confirmations")
  .option("--verbose", "Show detailed output")
  .action(async (directory, options) => {
    await createCommand({ ...options, dir: directory });
  });

// Init command - scaffold into existing repo
program
  .command("init")
  .description("Initialize Marketing OS in an existing Shopify theme repository")
  .option("--store <url>", "Shopify store URL (mystore.myshopify.com)")
  .option("--anthropic-key <key>", "Anthropic API key")
  .option("--supabase-url <url>", "Supabase project URL")
  .option("--supabase-anon-key <key>", "Supabase anon/public key")
  .option("--supabase-service-key <key>", "Supabase service role key (enables auto table creation)")
  .option("--admin-email <email>", "Email for the admin user")
  .option("--skip-supabase", "Skip Supabase setup (use local SQLite)")
  .option("-y, --yes", "Accept all defaults, skip confirmations")
  .option("--verbose", "Show detailed output")
  .action(async (options) => {
    await initCommand(options);
  });

// Add-skill command - generate new skill file
program
  .command("add-skill [name]")
  .description("Generate a new skill file from template")
  .action(async (name, options) => {
    await addSkillCommand(name, options);
  });

// Add-integration command - add integration to existing install
program
  .command("add-integration [name]")
  .description("Add an integration to an existing Marketing OS installation")
  .action(async (name, options) => {
    await addIntegrationCommand(name, options);
  });

// Doctor command - validate installation
program
  .command("doctor")
  .description(
    "Validate Marketing OS installation (check env vars, Supabase, GitHub secrets)"
  )
  .option("--verbose", "Show detailed output")
  .action(async (options) => {
    await doctorCommand(options);
  });

// Parse command line arguments
program.parse();
