# 05 — Agents & Skills Specification

> Marketing OS · Open Conjecture · March 2026

---

## 1. Agent Definitions

Marketing OS ships with two agents. Additional agents can be added by users.

### 1.1 Marketing Agent (Primary)

The primary conversational agent that users interact with via the console chat.

```typescript
// agents/src/mastra/agents/marketing-agent.ts
import { Agent } from "@mastra/core/agent";
import { shopifyAdminTools } from "../tools/shopify-admin";
import { dispatchToGithubTool } from "../tools/dispatch-to-github";
import { prStatusTool } from "../tools/pr-status";
import { ga4Tools } from "../tools/ga4-reporting";
import { metaAdsTools } from "../tools/meta-ads";

export const marketingAgent = new Agent({
  id: "marketing-agent",
  name: "Marketing Agent",
  model: "anthropic/claude-sonnet-4-20250514",
  instructions: `You are the Marketing OS agent for a Shopify store.

Your capabilities:
- Answer questions about store performance using analytics tools
- Generate ad copy, creative briefs, and marketing content
- Execute marketing skills when the user requests them
- Dispatch storefront changes to the async pipeline (via GitHub issues)
- Provide strategic marketing recommendations

Your context:
- Read from /docs/ files for brand voice and product knowledge
- Check marketing-os.config.json for enabled integrations
- Use the dispatch-to-github tool for any changes that modify the storefront

Rules:
- Always check brand voice guidelines before generating copy
- Never make up performance data — always use tools to fetch real data
- When asked to modify the store, explain that changes go through a PR review
- Be concise and actionable in your responses
- Format data as visual cards/tables when possible`,

  tools: {
    ...shopifyAdminTools,
    ...ga4Tools,
    ...metaAdsTools,
    dispatchToGithub: dispatchToGithubTool,
    prStatus: prStatusTool,
  },
});
```

### 1.2 Creative Agent (Specialist)

A specialist agent for generating marketing creative content.

```typescript
// agents/src/mastra/agents/creative-agent.ts
import { Agent } from "@mastra/core/agent";

export const creativeAgent = new Agent({
  id: "creative-agent",
  name: "Creative Agent",
  model: "anthropic/claude-sonnet-4-20250514",
  instructions: `You are a specialist marketing creative agent.

You generate:
- Ad copy (headlines, body text, CTAs) for Meta, Google, and email
- Product descriptions optimized for conversion
- Creative briefs for campaigns
- A/B test variants for existing copy

You always:
- Follow the brand voice guidelines from /docs/brand-voice.md
- Generate multiple variants (at least 3) for any copy request
- Include character counts for platform-specific copy
- Tag each variant with the persona/angle it targets`,
});
```

---

## 2. Tool Definitions

### 2.1 Shopify Admin Tools

```typescript
// agents/src/mastra/tools/shopify-admin.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const getStoreInfo = createTool({
  id: "shopify-get-store-info",
  description: "Get basic information about the Shopify store",
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    domain: z.string(),
    plan: z.string(),
    currency: z.string(),
  }),
  execute: async () => {
    const res = await fetch(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
        },
      }
    );
    const data = await res.json();
    return {
      name: data.shop.name,
      domain: data.shop.domain,
      plan: data.shop.plan_display_name,
      currency: data.shop.currency,
    };
  },
});

const getRecentOrders = createTool({
  id: "shopify-get-recent-orders",
  description: "Get recent orders from the Shopify store",
  inputSchema: z.object({
    limit: z.number().min(1).max(50).default(10),
    status: z.enum(["any", "open", "closed", "cancelled"]).default("any"),
  }),
  outputSchema: z.object({
    orders: z.array(z.object({
      id: z.string(),
      total_price: z.string(),
      created_at: z.string(),
      financial_status: z.string(),
      fulfillment_status: z.string().nullable(),
      line_items_count: z.number(),
    })),
    total_count: z.number(),
  }),
  execute: async ({ context }) => {
    const res = await fetch(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/orders.json?limit=${context.limit}&status=${context.status}`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
        },
      }
    );
    const data = await res.json();
    return {
      orders: data.orders.map((o: any) => ({
        id: String(o.id),
        total_price: o.total_price,
        created_at: o.created_at,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        line_items_count: o.line_items.length,
      })),
      total_count: data.orders.length,
    };
  },
});

const getProducts = createTool({
  id: "shopify-get-products",
  description: "Get products from the Shopify store",
  inputSchema: z.object({
    limit: z.number().min(1).max(50).default(10),
  }),
  outputSchema: z.object({
    products: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      variants_count: z.number(),
      images_count: z.number(),
    })),
  }),
  execute: async ({ context }) => {
    const res = await fetch(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/products.json?limit=${context.limit}`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
        },
      }
    );
    const data = await res.json();
    return {
      products: data.products.map((p: any) => ({
        id: String(p.id),
        title: p.title,
        status: p.status,
        variants_count: p.variants.length,
        images_count: p.images.length,
      })),
    };
  },
});

export const shopifyAdminTools = {
  getStoreInfo,
  getRecentOrders,
  getProducts,
};
```

### 2.2 Dispatch to GitHub Tool

```typescript
// agents/src/mastra/tools/dispatch-to-github.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const dispatchToGithubTool = createTool({
  id: "dispatch-to-github",
  description:
    "Create a GitHub issue that triggers the Claude Code async pipeline. " +
    "Use this whenever the user requests a storefront change (theme edits, " +
    "copy updates, new sections, etc.). The change will be implemented as a PR.",
  inputSchema: z.object({
    title: z.string().describe("Descriptive title for the change"),
    skillId: z.string().describe("ID of the skill to execute"),
    body: z.string().describe("Detailed instructions for Claude Code"),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
  }),
  outputSchema: z.object({
    issueNumber: z.number(),
    issueUrl: z.string(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    const repo = process.env.GITHUB_REPO!; // e.g., "myorg/mystore-theme"
    const token = process.env.GITHUB_TOKEN!;

    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `[Marketing OS] ${context.title}`,
          body: `## Skill: \`${context.skillId}\`\n\n${context.body}\n\n---\n_Created by Marketing OS agent_`,
          labels: ["marketing-os", context.priority],
        }),
      }
    );

    const issue = await res.json();
    return {
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      message: `Created issue #${issue.number}. Claude Code will pick this up and create a PR.`,
    };
  },
});
```

---

## 3. Skill Format

A "skill" is a packaged unit of marketing automation. It consists of a Mastra tool or workflow with standardized metadata.

### 3.1 Skill File Structure

```typescript
// agents/src/mastra/skills/store-health-check.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Skill Metadata — exported for the skills registry and UI card generation.
 */
export const metadata = {
  id: "store-health-check",
  name: "Store Health Check",
  description: "Analyze your store's recent performance across orders, traffic, and key metrics.",
  category: "analytics",       // analytics | creative | optimization | integration
  icon: "activity",            // lucide-react icon name
  executionMode: "sync",       // sync (inline response) | async (creates PR)
  version: "1.0.0",
  author: "Marketing OS",
};

/**
 * Input schema — used for both validation and UI form generation.
 */
export const inputSchema = z.object({
  timeRange: z.enum(["7d", "30d", "90d"]).default("30d")
    .describe("Time range for the analysis"),
  includeOrders: z.boolean().default(true)
    .describe("Include order analysis"),
  includeProducts: z.boolean().default(true)
    .describe("Include product performance"),
});

/**
 * Output schema — defines the structured response.
 */
export const outputSchema = z.object({
  summary: z.string(),
  metrics: z.object({
    totalOrders: z.number(),
    totalRevenue: z.number(),
    averageOrderValue: z.number(),
    topProducts: z.array(z.object({
      name: z.string(),
      sales: z.number(),
    })),
  }),
  recommendations: z.array(z.string()),
});

/**
 * The skill tool — the actual executable.
 */
export const tool = createTool({
  id: metadata.id,
  description: metadata.description,
  inputSchema,
  outputSchema,
  execute: async ({ context, mastra }) => {
    // Use other Mastra tools or direct API calls
    const agent = mastra?.getAgent("marketing-agent");

    // Fetch store data via Shopify Admin API
    const ordersRes = await fetch(
      `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/orders.json?status=any&limit=50`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
        },
      }
    );
    const orders = await ordersRes.json();

    // Compute metrics
    const totalRevenue = orders.orders.reduce(
      (sum: number, o: any) => sum + parseFloat(o.total_price), 0
    );

    return {
      summary: `Analyzed ${orders.orders.length} orders over the last ${context.timeRange}.`,
      metrics: {
        totalOrders: orders.orders.length,
        totalRevenue,
        averageOrderValue: totalRevenue / (orders.orders.length || 1),
        topProducts: [], // computed from line items
      },
      recommendations: [
        "Consider running a retargeting campaign for cart abandoners.",
        "Your top product could benefit from bundle offers.",
      ],
    };
  },
});
```

### 3.2 Skill Registry

The `_registry.ts` file is auto-generated by the CLI (and can be regenerated with a script). It imports all skills and exports them as a typed array.

```typescript
// agents/src/mastra/skills/_registry.ts
import * as storeHealthCheck from "./store-health-check";
import * as adCopyGenerator from "./ad-copy-generator";
import * as weeklyDigest from "./weekly-digest";

export type SkillMetadata = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  executionMode: "sync" | "async";
  version: string;
  author: string;
};

export type RegisteredSkill = {
  metadata: SkillMetadata;
  inputSchema: any; // Zod schema
  outputSchema: any;
  tool: any; // Mastra tool
};

export const skills: RegisteredSkill[] = [
  storeHealthCheck,
  adCopyGenerator,
  weeklyDigest,
];

export const getSkill = (id: string) =>
  skills.find((s) => s.metadata.id === id);

export const getSkillsByCategory = (category: string) =>
  skills.filter((s) => s.metadata.category === category);
```

### 3.3 Starter Skills

| Skill | Category | Mode | Description |
|-------|----------|------|-------------|
| `store-health-check` | analytics | sync | Pulls recent orders, products, and traffic data; returns metrics + recommendations |
| `ad-copy-generator` | creative | sync | Generates Meta/Google ad copy variants based on brand voice and product selection |
| `weekly-digest` | analytics | sync | Generates a weekly performance summary (designed to run on cron) |

---

## 4. Tool Categories

Tools are organized by integration and purpose:

| Category | Tools | Status |
|----------|-------|--------|
| Shopify Admin | getStoreInfo, getRecentOrders, getProducts, getCollections | Ships with v1 |
| GitHub Integration | dispatchToGithub, prStatus, listOpenPRs | Ships with v1 |
| GA4 | getPageViews, getTopPages, getConversionRate, getTrafficSources | Ships with v1 (requires setup) |
| Meta Ads | getCampaignPerformance, getAdSetMetrics, getAdCreativeMetrics | Ships with v1 (requires setup) |
| Google Ads | getCampaignPerformance, getKeywordPerformance | Ships with v1 (requires setup) |
| Klaviyo | (community skill) | Community contributed |

Integration tools are conditionally loaded based on `marketing-os.config.json` — if an integration is disabled, its tools are not registered with the agent.

---

## 5. Adding New Skills

### Via CLI

```bash
npx create-marketing-os add-skill my-new-skill
```

Creates a skeleton file at `agents/src/mastra/skills/my-new-skill.ts` with the standard metadata + schema + tool structure pre-filled.

### Manually

1. Create a new `.ts` file in `agents/src/mastra/skills/`
2. Export `metadata`, `inputSchema`, `outputSchema`, and `tool`
3. Add the import to `_registry.ts`
4. The console skills library auto-discovers it on next build/deploy

### From Community Registry

```bash
npx create-marketing-os install-skill @marketing-os/skill-klaviyo
```

Downloads the skill package, copies the skill file into the skills directory, and updates the registry.
