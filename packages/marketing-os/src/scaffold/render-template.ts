/**
 * Handlebars template compilation and rendering engine
 * Processes .hbs files with variable substitution
 */

import fs from "fs-extra";
import Handlebars from "handlebars";
import path from "path";

/**
 * Template variables available to all templates
 */
export interface TemplateVariables {
  storeName: string;
  storeUrl: string;
  repoFullName: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  adminEmail: string;
  enabledIntegrations: string; // JSON string of integration IDs
  [key: string]: string | undefined;
}

/**
 * Render a Handlebars template file
 * @param templatePath Path to the .hbs template file
 * @param variables Template variables to interpolate
 * @returns Rendered template content
 */
export async function renderTemplate(
  templatePath: string,
  variables: TemplateVariables
): Promise<string> {
  try {
    // Read the template file
    const templateContent = await fs.readFile(templatePath, "utf-8");

    // Compile the template
    const template = Handlebars.compile(templateContent, {
      noEscape: true, // Don't escape HTML entities
      strict: true, // Throw errors on missing variables
    });

    // Render with variables
    const rendered = template(variables);

    return rendered;
  } catch (error) {
    throw new Error(
      `Failed to render template ${templatePath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Render a template string (not from a file)
 * Useful for inline template processing
 */
export function renderTemplateString(
  templateString: string,
  variables: TemplateVariables
): string {
  try {
    const template = Handlebars.compile(templateString, {
      noEscape: true,
      strict: false, // Allow missing variables for inline templates
    });

    return template(variables);
  } catch (error) {
    throw new Error(
      `Failed to render template string: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Register custom Handlebars helpers
 * These can be used in templates for advanced logic
 */
export function registerHelpers(): void {
  // Helper: uppercase
  // Usage: {{uppercase storeName}}
  Handlebars.registerHelper("uppercase", function (str: string) {
    return str ? str.toUpperCase() : "";
  });

  // Helper: lowercase
  // Usage: {{lowercase storeName}}
  Handlebars.registerHelper("lowercase", function (str: string) {
    return str ? str.toLowerCase() : "";
  });

  // Helper: slugify
  // Usage: {{slugify storeName}}
  Handlebars.registerHelper("slugify", function (str: string) {
    return str
      ? str
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";
  });

  // Helper: json
  // Usage: {{json enabledIntegrations}}
  Handlebars.registerHelper("json", function (obj: any) {
    return JSON.stringify(obj, null, 2);
  });

  // Helper: eq (equals)
  // Usage: {{#if (eq integration "shopify")}}...{{/if}}
  Handlebars.registerHelper("eq", function (a: any, b: any) {
    return a === b;
  });

  // Helper: includes
  // Usage: {{#if (includes enabledIntegrations "ga4")}}...{{/if}}
  Handlebars.registerHelper("includes", function (arr: any[], val: any) {
    if (!Array.isArray(arr)) {
      try {
        arr = JSON.parse(arr);
      } catch {
        return false;
      }
    }
    return arr.includes(val);
  });

  // Helper: year (current year)
  // Usage: {{year}}
  Handlebars.registerHelper("year", function () {
    return new Date().getFullYear().toString();
  });

  // Helper: date (formatted date)
  // Usage: {{date}}
  Handlebars.registerHelper("date", function () {
    return new Date().toISOString().split("T")[0];
  });

  // Helper: ifOr (logical OR)
  // Usage: {{#ifOr condition1 condition2}}...{{/ifOr}}
  Handlebars.registerHelper("ifOr", function (this: any, ...args: any[]) {
    // Last argument is the Handlebars options object
    const options = args.pop();
    const conditions = args;

    if (conditions.some((c) => !!c)) {
      return options.fn(this);
    } else {
      return options.inverse(this);
    }
  });

  // Helper: ifAnd (logical AND)
  // Usage: {{#ifAnd condition1 condition2}}...{{/ifAnd}}
  Handlebars.registerHelper("ifAnd", function (this: any, ...args: any[]) {
    const options = args.pop();
    const conditions = args;

    if (conditions.every((c) => !!c)) {
      return options.fn(this);
    } else {
      return options.inverse(this);
    }
  });

  // Helper: default
  // Usage: {{default supabaseUrl "http://localhost:54321"}}
  Handlebars.registerHelper("default", function (value: any, defaultValue: any) {
    return value || defaultValue;
  });
}

/**
 * Validate that all required variables are present
 * Throws an error if any required variables are missing
 */
export function validateTemplateVariables(
  variables: TemplateVariables,
  required: string[]
): void {
  const missing: string[] = [];

  for (const key of required) {
    if (!variables[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required template variables: ${missing.join(", ")}`
    );
  }
}

/**
 * Extract variables used in a template
 * Useful for validation and debugging
 */
export function extractTemplateVariables(templatePath: string): string[] {
  try {
    const content = fs.readFileSync(templatePath, "utf-8");
    const variablePattern = /\{\{(\w+)\}\}/g;
    const variables = new Set<string>();

    let match;
    while ((match = variablePattern.exec(content)) !== null) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  } catch {
    return [];
  }
}

/**
 * Batch render multiple templates
 * More efficient than rendering one at a time
 */
export async function renderTemplates(
  templates: Array<{ path: string; variables: TemplateVariables }>,
  options?: { parallel?: boolean }
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  if (options?.parallel) {
    // Render in parallel
    const promises = templates.map(async ({ path: templatePath, variables }) => {
      const rendered = await renderTemplate(templatePath, variables);
      return { path: templatePath, rendered };
    });

    const settled = await Promise.all(promises);

    for (const { path: templatePath, rendered } of settled) {
      results.set(templatePath, rendered);
    }
  } else {
    // Render sequentially
    for (const { path: templatePath, variables } of templates) {
      const rendered = await renderTemplate(templatePath, variables);
      results.set(templatePath, rendered);
    }
  }

  return results;
}

/**
 * Check if a file is a Handlebars template
 */
export function isHandlebarsTemplate(filePath: string): boolean {
  return path.extname(filePath) === ".hbs";
}

/**
 * Get the output filename for a template
 * Removes the .hbs extension
 */
export function getOutputFilename(templatePath: string): string {
  if (isHandlebarsTemplate(templatePath)) {
    return templatePath.replace(/\.hbs$/, "");
  }
  return templatePath;
}

// Register helpers on module load
registerHelpers();
