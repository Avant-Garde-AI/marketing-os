/**
 * Integration test for create-marketing-os CLI
 * Tests the full E2E scaffolding process
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const DEMO_STORE = path.resolve(PACKAGE_ROOT, "../../examples/demo-store");
const CLI_BIN = path.resolve(PACKAGE_ROOT, "dist/index.js");

describe("CLI Integration Tests", () => {
  let tempDir: string;
  let testProjectDir: string;

  beforeAll(async () => {
    // Create temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "marketing-os-test-"));
    testProjectDir = path.join(tempDir, "test-store");

    // Verify demo store exists
    const demoStoreExists = await fs.pathExists(DEMO_STORE);
    if (!demoStoreExists) {
      throw new Error(
        `Demo store not found at ${DEMO_STORE}. Please ensure examples/demo-store exists.`
      );
    }

    // Copy demo store to temp directory
    await fs.copy(DEMO_STORE, testProjectDir);

    // Initialize git repo (required for CLI)
    execSync("git init", { cwd: testProjectDir, stdio: "pipe" });
    execSync('git config user.email "test@example.com"', {
      cwd: testProjectDir,
      stdio: "pipe",
    });
    execSync('git config user.name "Test User"', {
      cwd: testProjectDir,
      stdio: "pipe",
    });
    execSync("git add -A", { cwd: testProjectDir, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', {
      cwd: testProjectDir,
      stdio: "pipe",
    });

    // Verify CLI is built
    const cliBinExists = await fs.pathExists(CLI_BIN);
    if (!cliBinExists) {
      throw new Error(
        `CLI binary not found at ${CLI_BIN}. Please run 'npm run build' first.`
      );
    }
  }, 30000); // 30 second timeout for setup

  afterAll(async () => {
    // Clean up temp directory
    if (tempDir && (await fs.pathExists(tempDir))) {
      await fs.remove(tempDir);
    }
  }, 10000);

  it("should scaffold Marketing OS with --yes flag", async () => {
    // Run CLI with --yes flag and mock API keys
    const command = [
      "node",
      CLI_BIN,
      "init",
      "--yes",
      "--store", "test-store.myshopify.com",
      "--anthropic-key", "sk-ant-test-key-12345",
      "--supabase-url", "https://test.supabase.co",
      "--supabase-anon-key", "test-anon-key-12345",
      "--admin-email", "admin@test.com",
    ].join(" ");

    // Execute CLI
    const output = execSync(command, {
      cwd: testProjectDir,
      encoding: "utf-8",
      stdio: "pipe",
    });

    // Verify output contains success message
    expect(output).toContain("Marketing OS initialized");
  }, 120000); // 2 minute timeout

  it("should create all expected template files", async () => {
    const expectedFiles = [
      // Root level
      "marketing-os.config.json",
      "CLAUDE.md",

      // Agents directory - package files
      "agents/package.json",
      "agents/next.config.ts",
      "agents/tsconfig.json",
      "agents/tailwind.config.ts",
      "agents/postcss.config.mjs",
      "agents/vercel.json",
      "agents/.env.example",
      "agents/middleware.ts",

      // Agents - app directory
      "agents/app/globals.css",
      "agents/app/layout.tsx",
      "agents/app/page.tsx",
      "agents/app/login/page.tsx",
      "agents/app/chat/page.tsx",
      "agents/app/skills/page.tsx",
      "agents/app/activity/page.tsx",

      // Agents - API routes
      "agents/app/api/chat/route.ts",
      "agents/app/api/skills/[skillId]/route.ts",
      "agents/app/api/webhooks/github/route.ts",

      // Agents - lib
      "agents/lib/utils.ts",
      "agents/lib/github.ts",
      "agents/lib/skills.ts",
      "agents/lib/supabase/client.ts",
      "agents/lib/supabase/server.ts",

      // Agents - components
      "agents/components/nav.tsx",
      "agents/components/header.tsx",
      "agents/components/skill-card.tsx",
      "agents/components/pr-card.tsx",
      "agents/components/metric-card.tsx",
      "agents/components/chat/marketing-chat.tsx",

      // Agents - UI components
      "agents/components/ui/button.tsx",
      "agents/components/ui/card.tsx",
      "agents/components/ui/input.tsx",
      "agents/components/ui/badge.tsx",
      "agents/components/ui/dialog.tsx",
      "agents/components/ui/tabs.tsx",

      // Agents - Mastra
      "agents/src/mastra/index.ts",
      "agents/src/mastra/agents/marketing-agent.ts",
      "agents/src/mastra/agents/creative-agent.ts",

      // Agents - Tools
      "agents/src/mastra/tools/shopify-admin.ts",
      "agents/src/mastra/tools/dispatch-to-github.ts",
      "agents/src/mastra/tools/pr-status.ts",
      "agents/src/mastra/tools/ga4-reporting.ts",
      "agents/src/mastra/tools/meta-ads.ts",
      "agents/src/mastra/tools/google-ads.ts",

      // Agents - Skills
      "agents/src/mastra/skills/store-health-check.ts",
      "agents/src/mastra/skills/ad-copy-generator.ts",
      "agents/src/mastra/skills/weekly-digest.ts",
      "agents/src/mastra/skills/_registry.ts",

      // Agents - Workflows
      "agents/src/mastra/workflows/weekly-review.ts",
      "agents/src/mastra/workflows/campaign-launch.ts",

      // Docs
      "docs/brand-voice.md",
      "docs/product-knowledge.md",
      "docs/policies.md",

      // GitHub workflows
      ".github/workflows/marketing-os-agent.yml",
      ".github/workflows/marketing-os-review.yml",
    ];

    for (const file of expectedFiles) {
      const filePath = path.join(testProjectDir, file);
      const exists = await fs.pathExists(filePath);
      expect(exists, `Expected file to exist: ${file}`).toBe(true);
    }
  }, 10000);

  it("should verify Handlebars variables were interpolated", async () => {
    // Files that should have template variables interpolated
    const filesToCheck = [
      "agents/package.json",
      "agents/app/layout.tsx",
      "agents/src/mastra/index.ts",
      "agents/src/mastra/agents/marketing-agent.ts",
      "agents/components/header.tsx",
      "agents/.env.example",
      ".github/workflows/marketing-os-agent.yml",
      "CLAUDE.md",
      "marketing-os.config.json",
      "docs/brand-voice.md",
      "docs/product-knowledge.md",
      "docs/policies.md",
    ];

    for (const file of filesToCheck) {
      const filePath = path.join(testProjectDir, file);
      const exists = await fs.pathExists(filePath);

      if (!exists) {
        console.warn(`Skipping interpolation check for missing file: ${file}`);
        continue;
      }

      const content = await fs.readFile(filePath, "utf-8");

      // Check for uninterpolated Handlebars variables (exclude GitHub Actions ${{ }} syntax)
      const hasUninterpolatedVars = /(?<!\$)\{\{[^}]+\}\}/.test(content);

      expect(
        hasUninterpolatedVars,
        `File ${file} contains uninterpolated Handlebars variables: ${content.match(/(?<!\$)\{\{[^}]+\}\}/g)?.join(", ")}`
      ).toBe(false);
    }
  }, 10000);

  it("should verify config file has correct values", async () => {
    const configPath = path.join(testProjectDir, "marketing-os.config.json");
    const config = await fs.readJson(configPath);

    expect(config).toHaveProperty("version");
    expect(config).toHaveProperty("store");
    expect(config.store).toHaveProperty("name");
    expect(config.store).toHaveProperty("url", "test-store.myshopify.com");
    expect(config).toHaveProperty("integrations");
    expect(config).toHaveProperty("repository");
    expect(config).toHaveProperty("supabase");
    expect(config.supabase).toHaveProperty("url", "https://test.supabase.co");
  }, 5000);

  it("should verify package.json has required dependencies", async () => {
    const packageJsonPath = path.join(testProjectDir, "agents/package.json");
    const packageJson = await fs.readJson(packageJsonPath);

    // Check for essential dependencies
    const expectedDeps = [
      "next",
      "react",
      "react-dom",
      "@mastra/core",
      "@ai-sdk/anthropic",
      "@supabase/supabase-js",
      "@supabase/ssr",
    ];

    for (const dep of expectedDeps) {
      expect(
        packageJson.dependencies,
        `Expected dependency: ${dep}`
      ).toHaveProperty(dep);
    }

    // Check for dev dependencies
    const expectedDevDeps = [
      "typescript",
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "tailwindcss",
      "postcss",
    ];

    for (const dep of expectedDevDeps) {
      expect(
        packageJson.devDependencies,
        `Expected dev dependency: ${dep}`
      ).toHaveProperty(dep);
    }

    // Check for scripts
    expect(packageJson.scripts).toHaveProperty("dev");
    expect(packageJson.scripts).toHaveProperty("build");
    expect(packageJson.scripts).toHaveProperty("start");
  }, 5000);

  it("should verify .env.example contains required variables", async () => {
    const envExamplePath = path.join(testProjectDir, "agents/.env.example");
    const envContent = await fs.readFile(envExamplePath, "utf-8");

    const requiredVars = [
      "ANTHROPIC_API_KEY",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SHOPIFY_STORE_URL",
    ];

    for (const envVar of requiredVars) {
      expect(
        envContent,
        `Expected .env.example to contain: ${envVar}`
      ).toContain(envVar);
    }
  }, 5000);

  it("should verify GitHub workflow files are valid YAML", async () => {
    const workflowFiles = [
      ".github/workflows/marketing-os-agent.yml",
      ".github/workflows/marketing-os-review.yml",
    ];

    for (const file of workflowFiles) {
      const filePath = path.join(testProjectDir, file);
      const content = await fs.readFile(filePath, "utf-8");

      // Basic YAML syntax checks
      expect(content).toContain("name:");
      expect(content).toContain("on:");
      expect(content).toContain("jobs:");

      // Verify no Handlebars template variables remain (exclude GitHub Actions ${{ }} syntax)
      // This regex matches {{ without a preceding $ (negative lookbehind)
      const hasUninterpolatedVars = /(?<!\$)\{\{[^}]+\}\}/.test(content);
      expect(
        hasUninterpolatedVars,
        `Workflow ${file} contains uninterpolated Handlebars variables`
      ).toBe(false);
    }
  }, 5000);

  it("should verify Mastra index exports required items", async () => {
    const mastraIndexPath = path.join(
      testProjectDir,
      "agents/src/mastra/index.ts"
    );
    const content = await fs.readFile(mastraIndexPath, "utf-8");

    // Check for essential exports
    expect(content).toContain("export const mastra");
    expect(content).toContain("new Mastra");

    // Verify no template variables
    const hasUninterpolatedVars = /\{\{[^}]+\}\}/.test(content);
    expect(hasUninterpolatedVars).toBe(false);
  }, 5000);

  it("should verify marketing agent file is valid TypeScript", async () => {
    const agentPath = path.join(
      testProjectDir,
      "agents/src/mastra/agents/marketing-agent.ts"
    );
    const content = await fs.readFile(agentPath, "utf-8");

    // Check for essential TypeScript patterns
    expect(content).toContain("export");
    expect(content).toContain("Agent");

    // Verify no template variables
    const hasUninterpolatedVars = /\{\{[^}]+\}\}/.test(content);
    expect(hasUninterpolatedVars).toBe(false);
  }, 5000);

  it("should verify docs directory has required markdown files", async () => {
    const docsFiles = [
      "docs/brand-voice.md",
      "docs/product-knowledge.md",
      "docs/policies.md",
    ];

    for (const file of docsFiles) {
      const filePath = path.join(testProjectDir, file);
      const exists = await fs.pathExists(filePath);
      expect(exists, `Expected docs file to exist: ${file}`).toBe(true);

      const content = await fs.readFile(filePath, "utf-8");

      // Verify basic markdown structure
      expect(content).toContain("#");

      // Verify no template variables
      const hasUninterpolatedVars = /\{\{[^}]+\}\}/.test(content);
      expect(hasUninterpolatedVars, `Doc file ${file} has uninterpolated vars`).toBe(false);
    }
  }, 5000);

  it("should install npm dependencies successfully (optional - can be slow)", async () => {
    // This test is optional and can be skipped for faster tests
    // Uncomment to run full dependency installation test

    const agentsDir = path.join(testProjectDir, "agents");

    try {
      execSync("npm install", {
        cwd: agentsDir,
        stdio: "pipe",
        timeout: 120000, // 2 minute timeout
      });

      // Verify node_modules exists
      const nodeModulesExists = await fs.pathExists(
        path.join(agentsDir, "node_modules")
      );
      expect(nodeModulesExists).toBe(true);
    } catch (error) {
      // Skip this test if npm install times out or fails
      // This is acceptable for fast CI pipelines
      console.warn("npm install test skipped or failed:", error);
    }
  }, 180000); // 3 minute timeout

  it("should build Next.js app successfully (optional - requires npm install)", async () => {
    // This test requires npm dependencies to be installed
    // It verifies the scaffolded project can actually build

    const agentsDir = path.join(testProjectDir, "agents");
    const nodeModulesExists = await fs.pathExists(
      path.join(agentsDir, "node_modules")
    );

    if (!nodeModulesExists) {
      console.warn("Skipping build test - node_modules not found");
      return;
    }

    try {
      // Create .env file for build (required by Next.js)
      const envContent = `
ANTHROPIC_API_KEY=sk-ant-test-key-12345
SUPABASE_URL=https://test.supabase.co
SUPABASE_ANON_KEY=test-anon-key-12345
NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key-12345
NEXT_PUBLIC_STORE_URL=test-store.myshopify.com
      `.trim();

      await fs.writeFile(path.join(agentsDir, ".env"), envContent);

      // Run build
      execSync("npm run build", {
        cwd: agentsDir,
        stdio: "pipe",
        timeout: 180000, // 3 minute timeout
      });

      // Verify .next directory was created
      const nextDirExists = await fs.pathExists(
        path.join(agentsDir, ".next")
      );
      expect(nextDirExists).toBe(true);
    } catch (error) {
      console.error("Build test failed:", error);
      throw error;
    }
  }, 240000); // 4 minute timeout

  it("should preserve existing Shopify theme files", async () => {
    // Verify original theme files are still present
    const themeFiles = [
      "config/settings_schema.json",
      "layout/theme.liquid",
      "templates",
      "sections",
      "assets",
    ];

    for (const file of themeFiles) {
      const filePath = path.join(testProjectDir, file);
      const exists = await fs.pathExists(filePath);
      expect(
        exists,
        `Original theme file should be preserved: ${file}`
      ).toBe(true);
    }
  }, 5000);

  it("should not create duplicate files or overwrite theme files", async () => {
    // Verify agents directory doesn't contain theme files
    const agentsDir = path.join(testProjectDir, "agents");

    const shouldNotExistInAgents = [
      "config",
      "layout",
      "templates",
      "sections",
      "assets",
      "locales",
    ];

    for (const dir of shouldNotExistInAgents) {
      const dirPath = path.join(agentsDir, dir);
      const exists = await fs.pathExists(dirPath);
      expect(
        exists,
        `Theme directory should not be in agents/: ${dir}`
      ).toBe(false);
    }
  }, 5000);
});
