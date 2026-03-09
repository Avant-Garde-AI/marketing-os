# Marketing OS Community Skills

This directory contains community-contributed marketing automation skills for Marketing OS.

## What are Skills?

Skills are packaged units of marketing automation. Each skill is a Mastra tool or workflow with standardized metadata that makes it:
- **Discoverable** - Shows up in the console skills library
- **Executable** - Can be run from the UI or programmatically
- **Configurable** - Uses Zod schemas for input validation and form generation

## Skill Categories

- **Analytics** - Performance reporting and insights
- **Creative** - Content generation and optimization
- **Optimization** - Store improvement recommendations
- **Integration** - Third-party app connections
- **Campaign** - Campaign management and execution

## Skill Format

Every skill must export:

```typescript
// Required
export const metadata: SkillMetadata;
export const inputSchema: ZodSchema;
export const outputSchema: ZodSchema;
export const tool: MastraTool;

// Optional
export const workflow?: MastraWorkflow;
export const agents?: MastraAgent[];
```

### Example Skill

```typescript
// community/example-skill/index.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const metadata = {
  id: "example-skill",
  name: "Example Skill",
  description: "A sample skill that demonstrates the format",
  category: "analytics",
  icon: "chart-bar",
  executionMode: "sync",
  version: "1.0.0",
  author: "Your Name",
};

export const inputSchema = z.object({
  param: z.string().describe("A parameter for the skill"),
});

export const outputSchema = z.object({
  result: z.string(),
});

export const tool = createTool({
  id: metadata.id,
  description: metadata.description,
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    // Your skill logic here
    return { result: `Processed: ${context.param}` };
  },
});
```

## Contributing a Skill

1. **Create a new directory** under `community/` with your skill name
2. **Add your skill file** (`index.ts`) with required exports
3. **Add a README** explaining what the skill does and how to use it
4. **Document env vars** if your skill requires API keys or configuration
5. **Test your skill** locally by installing it in a demo store
6. **Submit a PR** following the guidelines in the root [CONTRIBUTING.md](../../CONTRIBUTING.md)

## Quality Requirements

- [ ] Exports all required members (`metadata`, `inputSchema`, `outputSchema`, `tool`)
- [ ] Zod schemas have `.describe()` on all fields (for form generation)
- [ ] No hardcoded API keys or secrets (uses `process.env` references)
- [ ] Includes error handling in the `execute` function
- [ ] Valid category and icon (from lucide-react)
- [ ] Correct `executionMode` (`sync` or `async`)
- [ ] Has a README with description and usage example
- [ ] No malicious code

## Installation

Users can install community skills via the CLI:

```bash
npx create-marketing-os add-skill @marketing-os/skill-name
```

Or manually by copying the skill directory into their `/agents/src/mastra/skills/` folder.

## Skill Ecosystem

Popular skills from the community:
- `klaviyo-sync` - Sync customer segments to Klaviyo lists
- `judgeme-reviews` - Analyze review sentiment and generate responses
- `rebuy-optimizer` - Optimize product recommendation rules
- `triplewhale-attribution` - Pull attribution data and generate ROAS reports

See the full registry at [marketing-os.dev/skills](https://marketing-os.dev/skills) (coming soon).

## Questions?

- Open an issue: [GitHub Issues](https://github.com/openconjecture/marketing-os/issues)
- Start a discussion: [GitHub Discussions](https://github.com/openconjecture/marketing-os/discussions)

Happy skill building! 🚀
