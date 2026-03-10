/**
 * Pre-flight check for integration tests
 * Verifies all required files and directories exist before running tests
 */

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const DEMO_STORE = path.resolve(PACKAGE_ROOT, "../../examples/demo-store");
const CLI_BIN = path.resolve(PACKAGE_ROOT, "dist/index.js");
const TEMPLATES_DIR = path.resolve(PACKAGE_ROOT, "templates");

async function checkSetup() {
  console.log("🔍 Checking integration test setup...\n");

  let allGood = true;

  // Check CLI binary
  if (await fs.pathExists(CLI_BIN)) {
    console.log("✓ CLI binary found:", CLI_BIN);
  } else {
    console.error("✗ CLI binary not found:", CLI_BIN);
    console.error("  Run: npm run build");
    allGood = false;
  }

  // Check demo store
  if (await fs.pathExists(DEMO_STORE)) {
    console.log("✓ Demo store found:", DEMO_STORE);

    // Check for required Shopify theme files
    const requiredFiles = [
      "config/settings_schema.json",
      "layout/theme.liquid",
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(DEMO_STORE, file);
      if (await fs.pathExists(filePath)) {
        console.log(`  ✓ ${file}`);
      } else {
        console.error(`  ✗ ${file} not found`);
        allGood = false;
      }
    }
  } else {
    console.error("✗ Demo store not found:", DEMO_STORE);
    console.error("  Expected: examples/demo-store/");
    allGood = false;
  }

  // Check templates directory
  if (await fs.pathExists(TEMPLATES_DIR)) {
    console.log("✓ Templates directory found:", TEMPLATES_DIR);

    // Check for key template files
    const keyTemplates = [
      "agents/package.json.hbs",
      "agents/src/mastra/index.ts.hbs",
      "CLAUDE.md.hbs",
      "marketing-os.config.json.hbs",
      "github/workflows/marketing-os-agent.yml.hbs",
    ];

    for (const template of keyTemplates) {
      const templatePath = path.join(TEMPLATES_DIR, template);
      if (await fs.pathExists(templatePath)) {
        console.log(`  ✓ ${template}`);
      } else {
        console.error(`  ✗ ${template} not found`);
        allGood = false;
      }
    }
  } else {
    console.error("✗ Templates directory not found:", TEMPLATES_DIR);
    allGood = false;
  }

  console.log("");

  if (allGood) {
    console.log("✅ All checks passed! Ready to run integration tests.");
    console.log("\nRun tests with: npm run test:integration");
    process.exit(0);
  } else {
    console.error("❌ Some checks failed. Please fix the issues above.");
    process.exit(1);
  }
}

checkSetup().catch((error) => {
  console.error("Error during setup check:", error);
  process.exit(1);
});
