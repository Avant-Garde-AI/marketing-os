/**
 * add-skill command - Generate new skill file from template
 */

import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import { input, select } from "@inquirer/prompts";
import validatePackageName from "validate-npm-package-name";

interface AddSkillOptions {
  name?: string;
}

const SKILL_TEMPLATE = `/**
 * {{skillName}} skill
 * {{description}}
 */

import { Skill } from "@mastra/core";

export const {{camelCaseName}}Skill = new Skill({
  id: "{{kebabCaseName}}",
  name: "{{skillName}}",
  description: "{{description}}",
  instructions: \`
You are a marketing assistant with access to Shopify store data.

Your task: {{taskDescription}}

Guidelines:
- Be specific and actionable
- Use data from the store when available
- Provide clear next steps
- Keep responses concise but comprehensive
  \`,

  async execute({ context, mastra }) {
    // TODO: Implement skill logic

    // Example: Fetch data from tools
    // const data = await mastra.tools.shopifyAdmin.execute({
    //   query: "products",
    //   params: { limit: 10 }
    // });

    // Example: Use AI to analyze
    // const analysis = await mastra.agents.creativeAgent.generate({
    //   prompt: \`Analyze this data: \${JSON.stringify(data)}\`
    // });

    return {
      success: true,
      message: "{{skillName}} executed successfully",
      data: {},
    };
  },
});
`;

/**
 * Convert string to camelCase
 */
function toCamelCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^(.)/, (char) => char.toLowerCase());
}

/**
 * Convert string to kebab-case
 */
function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * Convert string to Title Case
 */
function toTitleCase(str: string): string {
  return str
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Validate skill name
 */
function validateSkillName(name: string): boolean | string {
  if (!name) {
    return "Skill name is required";
  }

  const kebabName = toKebabCase(name);
  const validation = validatePackageName(kebabName);

  if (!validation.validForNewPackages) {
    return `Invalid skill name: ${validation.errors?.join(", ")}`;
  }

  return true;
}

export async function addSkillCommand(
  skillName: string | undefined,
  options: AddSkillOptions
): Promise<void> {
  try {
    console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────┐"));
    console.log(chalk.bold.cyan("│  Add New Skill                          │"));
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

    // Get skill name
    if (!skillName) {
      skillName = await input({
        message: "Skill name (e.g., 'Product Recommender'):",
        validate: validateSkillName,
      });
    } else {
      const validation = validateSkillName(skillName);
      if (validation !== true) {
        console.error(chalk.red.bold(`\n✗ ${validation}\n`));
        process.exit(1);
      }
    }

    // Get description
    const description = await input({
      message: "Brief description:",
      default: `${toTitleCase(skillName)} for the store`,
    });

    // Get task description
    const taskDescription = await input({
      message: "What should this skill do?",
      default: `Analyze store data and provide ${toTitleCase(skillName).toLowerCase()} insights`,
    });

    // Generate file names
    const kebabName = toKebabCase(skillName);
    const camelName = toCamelCase(skillName);
    const titleName = toTitleCase(skillName);

    // Render template
    const content = SKILL_TEMPLATE.replace(/{{skillName}}/g, titleName)
      .replace(/{{camelCaseName}}/g, camelName)
      .replace(/{{kebabCaseName}}/g, kebabName)
      .replace(/{{description}}/g, description)
      .replace(/{{taskDescription}}/g, taskDescription);

    // Write file
    const skillsDir = path.join(agentsDir, "src/mastra/skills");
    await fs.ensureDir(skillsDir);

    const filePath = path.join(skillsDir, `${kebabName}.ts`);

    if (await fs.pathExists(filePath)) {
      console.error(
        chalk.red.bold(`\n✗ Skill already exists: ${filePath}\n`)
      );
      process.exit(1);
    }

    await fs.writeFile(filePath, content, "utf-8");

    console.log(chalk.green(`\n✓ Created skill: ${path.relative(process.cwd(), filePath)}`));

    // Instructions
    console.log(chalk.bold("\nNext steps:\n"));
    console.log(chalk.cyan(`  1. Edit ${path.relative(process.cwd(), filePath)}`));
    console.log(chalk.cyan("  2. Implement the execute() function"));
    console.log(chalk.cyan("  3. Export the skill in agents/src/mastra/index.ts"));
    console.log(chalk.cyan("  4. Test with the agent: 'Use the {{skillName}} skill'\n"));

    // Show example export
    console.log(chalk.dim("Example export in agents/src/mastra/index.ts:"));
    console.log(chalk.dim(`  import { ${camelName}Skill } from "./skills/${kebabName}.js";`));
    console.log(chalk.dim(`  export const skills = [${camelName}Skill, ...];`));
    console.log();
  } catch (error) {
    console.error(chalk.red("\n✗ Failed to add skill:"), error);
    process.exit(1);
  }
}
