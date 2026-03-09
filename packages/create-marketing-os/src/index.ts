/**
 * create-marketing-os
 * CLI tool to scaffold Marketing OS into Shopify theme repositories
 */

import { Command } from "commander";

const program = new Command();

program
  .name("create-marketing-os")
  .description("AI marketing operations for Shopify, powered by your git repo")
  .version("0.1.0");

// TODO: Add commands (create, init, add-skill, add-integration, doctor)

program.parse();
