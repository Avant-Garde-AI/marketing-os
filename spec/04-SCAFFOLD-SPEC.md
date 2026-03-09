# 04 — Scaffold Template Specification

> Marketing OS · Open Conjecture · March 2026

---

## 1. Complete Scaffolded File Tree

When `create-marketing-os` runs on a store repo, the following files are created. Files marked with `(template)` use variable interpolation. Files marked with `(static)` are copied as-is.

```
my-store-theme/                          # Existing Shopify theme repo
│
├── agents/                              # NEW — Next.js + Mastra console
│   ├── app/                             # Next.js App Router pages
│   │   ├── layout.tsx                   # (template) Root layout with providers
│   │   ├── page.tsx                     # (static) Dashboard page
│   │   ├── globals.css                  # (static) Tailwind base styles
│   │   ├── login/
│   │   │   └── page.tsx                 # (static) Supabase magic link login
│   │   ├── chat/
│   │   │   └── page.tsx                 # (static) Chat interface
│   │   ├── skills/
│   │   │   └── page.tsx                 # (static) Skills library grid
│   │   ├── activity/
│   │   │   └── page.tsx                 # (static) PR activity feed
│   │   └── api/
│   │       ├── chat/
│   │       │   └── route.ts             # (static) Mastra chatRoute handler
│   │       ├── skills/
│   │       │   └── [skillId]/
│   │       │       └── route.ts         # (static) Skill execution endpoint
│   │       └── webhooks/
│   │           └── github/
│   │               └── route.ts         # (static) GitHub webhook handler
│   │
│   ├── src/
│   │   └── mastra/
│   │       ├── index.ts                 # (template) Mastra instance config
│   │       ├── agents/
│   │       │   ├── marketing-agent.ts   # (template) Primary marketing agent
│   │       │   └── creative-agent.ts    # (static) Creative generation agent
│   │       ├── tools/
│   │       │   ├── shopify-admin.ts     # (static) Shopify Admin API tools
│   │       │   ├── dispatch-to-github.ts# (template) GitHub issue dispatch tool
│   │       │   ├── pr-status.ts         # (static) PR status reader tool
│   │       │   ├── ga4-reporting.ts     # (static) GA4 reporting tool
│   │       │   ├── meta-ads.ts          # (static) Meta Ads reporting tool
│   │       │   └── google-ads.ts        # (static) Google Ads reporting tool
│   │       ├── workflows/
│   │       │   ├── weekly-review.ts     # (static) Weekly performance workflow
│   │       │   └── campaign-launch.ts   # (static) Campaign launch workflow
│   │       └── skills/
│   │           ├── _registry.ts         # (template) Auto-generated skill manifest
│   │           ├── store-health-check.ts# (static) Starter skill
│   │           ├── ad-copy-generator.ts # (static) Starter skill
│   │           └── weekly-digest.ts     # (static) Starter skill
│   │
│   ├── components/
│   │   ├── ui/                          # (static) shadcn/ui primitives
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── tabs.tsx
│   │   │   └── ... (standard shadcn set)
│   │   ├── skill-card.tsx               # (static) Skill library card component
│   │   ├── pr-card.tsx                  # (static) Activity feed PR card
│   │   ├── metric-card.tsx              # (static) Dashboard metric card
│   │   ├── nav.tsx                      # (static) Sidebar navigation
│   │   ├── header.tsx                   # (template) Header with store name
│   │   └── chat/
│   │       └── marketing-chat.tsx       # (static) assistant-ui chat wrapper
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts               # (template) Supabase browser client
│   │   │   ├── server.ts               # (template) Supabase server client
│   │   │   └── middleware.ts            # (static) Auth middleware for Next.js
│   │   ├── github.ts                    # (static) GitHub API helpers
│   │   ├── skills.ts                    # (static) Skill registry loader
│   │   └── utils.ts                     # (static) General utilities (cn, etc.)
│   │
│   ├── middleware.ts                     # (static) Next.js middleware (auth redirect)
│   ├── next.config.ts                   # (static) Next.js config with Mastra externals
│   ├── tailwind.config.ts               # (static) Tailwind config
│   ├── tsconfig.json                    # (static) TypeScript strict config
│   ├── postcss.config.mjs               # (static) PostCSS config
│   ├── package.json                     # (template) Dependencies
│   ├── .env.example                     # (template) Documented env vars
│   └── .env.local                       # (template) Actual env vars (gitignored)
│
├── docs/                                # NEW — Brand context / ground truth
│   ├── brand-voice.md                   # (template) Brand voice guidelines template
│   ├── product-knowledge.md             # (template) Product knowledge template
│   └── policies.md                      # (template) Store policies template
│
├── .github/                             # NEW or UPDATED — GitHub Actions
│   └── workflows/
│       ├── marketing-os-agent.yml       # (template) Claude Code async agent
│       └── marketing-os-review.yml      # (static) PR review workflow
│
├── CLAUDE.md                            # (template) Claude Code instructions
├── marketing-os.config.json             # (template) Top-level config
│
├── .gitignore                           # UPDATED — add agents/.env.local, agents/.next
│
│ (existing Shopify theme files untouched)
├── assets/
├── config/
├── layout/
├── sections/
├── snippets/
└── templates/
```

---

## 2. Key File Contents

### 2.1 `agents/package.json`

```json
{
  "name": "{{storeName}}-marketing-os",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "mastra:dev": "mastra dev"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@mastra/core": "latest",
    "@mastra/ai-sdk": "latest",
    "@mastra/pg": "latest",
    "@mastra/memory": "latest",
    "@mastra/auth-supabase": "latest",
    "@ai-sdk/react": "latest",
    "@ai-sdk/anthropic": "latest",
    "@assistant-ui/react": "latest",
    "@supabase/supabase-js": "^2.0.0",
    "@supabase/ssr": "latest",
    "zod": "^3.23.0",
    "lucide-react": "latest",
    "class-variance-authority": "latest",
    "clsx": "latest",
    "tailwind-merge": "latest",
    "@radix-ui/react-dialog": "latest",
    "@radix-ui/react-tabs": "latest",
    "@radix-ui/react-slot": "latest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "postcss": "^8.0.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.0.0"
  }
}
```

### 2.2 `agents/src/mastra/index.ts`

```typescript
import { Mastra } from "@mastra/core";
import { MastraAuthSupabase } from "@mastra/auth-supabase";
import { PostgresStore } from "@mastra/pg";
import { Memory } from "@mastra/memory";
import { marketingAgent } from "./agents/marketing-agent";
import { creativeAgent } from "./agents/creative-agent";

const storage = new PostgresStore({
  connectionString: process.env.SUPABASE_DATABASE_URL!,
});

const memory = new Memory({
  storage,
  options: {
    lastMessages: 20,
    semanticRecall: false,
  },
});

export const mastra = new Mastra({
  agents: { marketingAgent, creativeAgent },
  memory,
  storage,
  server: {
    auth: new MastraAuthSupabase({
      url: process.env.SUPABASE_URL!,
      anonKey: process.env.SUPABASE_ANON_KEY!,
    }),
  },
});
```

### 2.3 `agents/next.config.ts`

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@mastra/*"],
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
```

### 2.4 `marketing-os.config.json`

```json
{
  "$schema": "https://marketing-os.dev/schema/config.json",
  "version": "1.0.0",
  "store": {
    "url": "{{storeUrl}}",
    "name": "{{storeName}}"
  },
  "integrations": {
    "shopify": { "enabled": true },
    "ga4": { "enabled": false },
    "meta_ads": { "enabled": false },
    "google_ads": { "enabled": false },
    "klaviyo": { "enabled": false }
  },
  "console": {
    "theme": "default",
    "features": {
      "chat": true,
      "skills": true,
      "activity": true,
      "dashboard": true
    }
  },
  "async": {
    "claude_code_model": "claude-sonnet-4-20250514",
    "max_turns": 20,
    "auto_review": false
  }
}
```

### 2.5 `CLAUDE.md`

```markdown
# Marketing OS — Claude Code Instructions

## Store Context
- **Store**: {{storeName}} ({{storeUrl}})
- **Theme**: Shopify Online Store 2.0 (detected from repo)
- **Repository**: {{repoFullName}}

## Your Role
You are the Marketing OS agent for this Shopify store. You execute marketing
skills and make storefront improvements via pull requests.

## Context Files
- `/docs/brand-voice.md` — Brand voice and tone guidelines
- `/docs/product-knowledge.md` — Product catalog knowledge
- `/docs/policies.md` — Store policies (shipping, returns, etc.)
- `/agents/src/mastra/skills/` — Available skill definitions
- `/marketing-os.config.json` — Store configuration

## Rules
1. **Never push directly to main.** Always create a feature branch and PR.
2. **Never modify files in /agents/.** You only modify theme files and /docs.
3. **Read /docs/ before every task** to ensure brand consistency.
4. **PR descriptions must be structured** with: skill name, what changed, why.
5. **Test Liquid changes** by validating syntax before committing.
6. **Respect the config.** Check marketing-os.config.json for enabled features.

## PR Description Template
```
## Marketing OS: [Skill Name]

### What Changed
- [File]: [Description of change]

### Why
[Brief explanation of the marketing rationale]

### Skill
`[skill-id]` triggered by [user/cron/webhook]

### Review Checklist
- [ ] Brand voice consistency checked against /docs/brand-voice.md
- [ ] Liquid syntax valid
- [ ] No breaking changes to theme structure
```

## Available Skills
Read `/agents/src/mastra/skills/` for the full list of available skills
and their expected inputs/outputs.
```

### 2.6 `.github/workflows/marketing-os-agent.yml`

```yaml
name: Marketing OS Agent

on:
  issues:
    types: [opened, labeled]
  issue_comment:
    types: [created]
  schedule:
    - cron: '0 14 * * 1'  # Monday 9am ET (14:00 UTC)
  repository_dispatch:
    types: [marketing-os-trigger]

jobs:
  agent:
    runs-on: ubuntu-latest
    if: |
      (github.event_name == 'issue_comment' &&
       contains(github.event.comment.body, '@marketing-os')) ||
      (github.event_name == 'issues' &&
       contains(github.event.issue.labels.*.name, 'marketing-os')) ||
      github.event_name == 'schedule' ||
      github.event_name == 'repository_dispatch'
    steps:
      - uses: actions/checkout@v4

      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            You are the Marketing OS agent for this Shopify store.
            Read CLAUDE.md for full instructions and context.
            Read /docs/ for brand guidelines.

            Event: ${{ github.event_name }}
            ${{ github.event_name == 'issues' &&
                format('Issue Title: {0}', github.event.issue.title) || '' }}
            ${{ github.event_name == 'issues' &&
                format('Issue Body: {0}', github.event.issue.body) || '' }}
            ${{ github.event_name == 'issue_comment' &&
                format('Comment: {0}', github.event.comment.body) || '' }}
            ${{ github.event_name == 'schedule' &&
                'Scheduled task: Run weekly performance digest skill.' || '' }}
            ${{ github.event_name == 'repository_dispatch' &&
                format('Dispatch payload: {0}',
                  toJSON(github.event.client_payload)) || '' }}

            Execute the appropriate skill and create a PR with your changes.
          claude_args: >-
            --max-turns 20
            --model claude-sonnet-4-20250514
            --allowedTools Edit,Read,Write,Bash
```

### 2.7 `agents/.env.example`

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
SUPABASE_DATABASE_URL=postgresql://postgres:...@db.xxx.supabase.co:5432/postgres

# Shopify
SHOPIFY_STORE_URL=mystore.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_...

# Optional integrations
# GA4_PROPERTY_ID=123456789
# GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
# META_ACCESS_TOKEN=EAAG...
# META_AD_ACCOUNT_ID=act_123456789
# GOOGLE_ADS_DEVELOPER_TOKEN=...
# GOOGLE_ADS_CUSTOMER_ID=123-456-7890

# GitHub (for webhook validation)
GITHUB_WEBHOOK_SECRET=whsec_...
```

---

## 3. Template Variable Resolution

The CLI resolves template variables from user input during the interactive prompt:

| Variable | Source |
|----------|--------|
| `{{storeName}}` | Derived from store URL (e.g., "mystore" → "My Store") or user input |
| `{{storeUrl}}` | User input (Shopify store URL) |
| `{{supabaseUrl}}` | User input |
| `{{supabaseAnonKey}}` | User input |
| `{{adminEmail}}` | User input |
| `{{repoFullName}}` | User input or derived from git remote |
| `{{enabledIntegrations}}` | Computed from integration selection step |
| `{{anthropicApiKey}}` | User input (written to .env.local only, never to templates committed to git) |

---

## 4. .gitignore Additions

The CLI appends the following to the repo's `.gitignore`:

```
# Marketing OS
agents/.next/
agents/node_modules/
agents/.env.local
agents/.env
.vercel/
```
