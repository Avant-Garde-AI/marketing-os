# 08 — Community & Ecosystem

> Marketing OS · Open Conjecture · March 2026

---

## 1. Community Skills Registry

### 1.1 Overview

The community skills registry is a collection of contributed marketing automation skills that can be installed into any Marketing OS instance. Skills are distributed as npm packages under the `@marketing-os/` scope.

### 1.2 Distribution Model

**Phase 1 (v1)**: Skills are individual TypeScript files hosted in the `marketing-os` monorepo under `packages/skills/`. Installed via CLI copy.

**Phase 2 (v2)**: Skills are npm packages (`@marketing-os/skill-{name}`) that can be installed via `npx create-marketing-os install-skill`.

**Phase 3 (v3)**: In-console skill browser with one-click install + automatic registry rebuild.

### 1.3 Skill Contribution Format

Every community skill must export:

```typescript
// Required exports
export const metadata: SkillMetadata;     // Name, description, category, icon, mode
export const inputSchema: ZodSchema;       // Zod schema for input validation + form gen
export const outputSchema: ZodSchema;      // Zod schema for output validation
export const tool: MastraTool;            // The executable Mastra tool

// Optional exports
export const workflow?: MastraWorkflow;    // If the skill uses a multi-step workflow
export const agents?: MastraAgent[];       // If the skill registers sub-agents
```

### 1.4 Skill Categories

| Category | ID | Description | Examples |
|----------|-----|-------------|----------|
| Analytics | `analytics` | Performance reporting and insights | Store health check, conversion analysis, traffic report |
| Creative | `creative` | Content generation and optimization | Ad copy, product descriptions, email templates |
| Optimization | `optimization` | Store improvement recommendations | SEO audit, page speed analysis, CRO suggestions |
| Integration | `integration` | Third-party app connections | Klaviyo sync, Judge.me reviews, Rebuy integration |
| Campaign | `campaign` | Campaign management and execution | Campaign launch, A/B test setup, budget optimizer |

### 1.5 Contribution Workflow

1. **Fork** the `marketing-os` monorepo
2. **Create** a skill file following the format in `05-AGENTS-AND-SKILLS.md`
3. **Add** the skill to the community skills directory: `packages/skills/community/`
4. **Write** a README for the skill with usage examples
5. **Submit** a PR with the skill
6. **Review**: Maintainers review for security, quality, and API compliance
7. **Merge**: Skill is added to the registry and available for installation

### 1.6 Quality Gates for Community Skills

- [ ] Exports all required members (`metadata`, `inputSchema`, `outputSchema`, `tool`)
- [ ] Zod schemas are complete with `.describe()` on all fields (for form generation)
- [ ] No hardcoded API keys or secrets (uses `process.env` references)
- [ ] Includes error handling in the `execute` function
- [ ] `metadata.category` is a valid category
- [ ] `metadata.icon` is a valid lucide-react icon name
- [ ] `metadata.executionMode` correctly reflects behavior (`sync` vs `async`)
- [ ] Has a README with description and usage example
- [ ] No malicious code (automated scan + manual review)

---

## 2. Partner Integration Patterns

### 2.1 Shopify App Integration Skills

For popular Shopify apps, community skills provide agent-friendly interfaces:

| App | Skill | What it does |
|-----|-------|-------------|
| Klaviyo | `skill-klaviyo` | Sync persona segments to Klaviyo lists, trigger flows, report on email performance |
| Judge.me | `skill-judgeme` | Analyze review sentiment, generate review response templates, identify product issues |
| Rebuy | `skill-rebuy` | Optimize product recommendation rules based on performance data |
| Triple Whale | `skill-triplewhale` | Pull attribution data, generate ROAS reports, identify winning channels |
| Postscript | `skill-postscript` | Generate SMS campaign copy, schedule sends, report on SMS performance |
| Gorgias | `skill-gorgias` | Analyze support ticket trends, generate canned responses, identify product FAQs |

### 2.2 Integration Skill Template

```typescript
// packages/skills/community/klaviyo-sync/index.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const metadata = {
  id: "klaviyo-sync",
  name: "Klaviyo Audience Sync",
  description: "Sync customer segments to Klaviyo lists for targeted email campaigns.",
  category: "integration",
  icon: "mail",
  executionMode: "sync" as const,
  version: "1.0.0",
  author: "Community",
  requiredEnvVars: ["KLAVIYO_API_KEY"], // Documented dependency
};

export const inputSchema = z.object({
  segmentName: z.string().describe("Name of the customer segment to sync"),
  klaviyoListId: z.string().describe("Klaviyo list ID to sync to"),
  syncMode: z.enum(["full", "incremental"]).default("incremental")
    .describe("Full replaces the list, incremental adds new members"),
});

export const outputSchema = z.object({
  synced: z.number(),
  skipped: z.number(),
  errors: z.number(),
  message: z.string(),
});

export const tool = createTool({
  id: metadata.id,
  description: metadata.description,
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    const apiKey = process.env.KLAVIYO_API_KEY;
    if (!apiKey) {
      throw new Error("KLAVIYO_API_KEY is required. Set it in your environment variables.");
    }

    // Implementation: fetch segment from Shopify, sync to Klaviyo
    // ...

    return {
      synced: 150,
      skipped: 12,
      errors: 0,
      message: "Successfully synced 150 customers to Klaviyo list.",
    };
  },
});
```

---

## 3. Open Source Strategy

### 3.1 License

MIT License — permissive, allows commercial use, modification, and distribution.

### 3.2 Repository Structure

The `marketing-os` monorepo is the canonical source for:
- The `create-marketing-os` CLI package
- The scaffold templates
- Built-in skills
- Community-contributed skills
- Documentation
- Example stores (for testing)

### 3.3 Governance

| Role | Responsibility |
|------|---------------|
| Maintainers (Open Conjecture) | Merge PRs, release versions, security reviews |
| Community Contributors | Submit skills, report bugs, suggest features |
| Skill Reviewers | Review community skill submissions for quality |
| Advisory (future) | Shopify partners and agencies providing feedback on skill design |

### 3.4 Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: General questions, skill ideas, architecture discussions
- **Discord**: Real-time community chat (link from README)
- **Blog / Changelog**: Release notes and tutorials (published on marketing-os.dev)

---

## 4. Versioning and Releases

### 4.1 Semantic Versioning

- **Major** (1.0, 2.0): Breaking changes to skill format, CLI interface, or console API
- **Minor** (1.1, 1.2): New features, new starter skills, new integrations
- **Patch** (1.0.1): Bug fixes, dependency updates

### 4.2 Release Process

1. Changes merged to `main` branch
2. Changeset generated via `@changesets/cli`
3. GitHub Action builds and publishes to npm
4. Release notes auto-generated from changesets
5. Docker image updated (if applicable)

### 4.3 CLI Update Notifications

When users run `npx create-marketing-os`, it checks the current installed version against npm latest and shows an update notice if outdated.
