# 09 — Repository Structure

> Marketing OS · Open Conjecture · March 2026

---

## 1. Overview

This document describes the structure of the `marketing-os` **monorepo** — the repository that you (the coding agent) are building. This is NOT the store's theme repo. This is the source repo that builds and publishes the CLI, templates, and skills.

The monorepo uses **pnpm workspaces** and **turborepo** for task orchestration.

---

## 2. Monorepo Structure

```
marketing-os/                          # The repo you are building
│
├── packages/
│   ├── create-marketing-os/           # The CLI package (published to npm)
│   │   ├── src/
│   │   │   ├── index.ts              # CLI entry point (Commander.js)
│   │   │   ├── commands/
│   │   │   │   ├── init.ts           # `init` command (scaffold into existing repo)
│   │   │   │   ├── create.ts         # Default create flow (interactive prompts)
│   │   │   │   ├── add-skill.ts      # `add-skill` command
│   │   │   │   ├── add-integration.ts# `add-integration` command
│   │   │   │   └── doctor.ts         # `doctor` command (validate install)
│   │   │   ├── prompts/
│   │   │   │   ├── store.ts          # Store connection prompts
│   │   │   │   ├── services.ts       # API keys + Supabase prompts
│   │   │   │   ├── integrations.ts   # Integration selection prompts
│   │   │   │   └── deploy.ts         # Vercel deployment prompts
│   │   │   ├── scaffold/
│   │   │   │   ├── index.ts          # Orchestrates scaffolding
│   │   │   │   ├── detect-theme.ts   # Detects Shopify theme structure
│   │   │   │   ├── render-template.ts# Template variable interpolation
│   │   │   │   ├── write-files.ts    # File creation with conflict handling
│   │   │   │   └── install-deps.ts   # npm/pnpm/yarn detection + install
│   │   │   ├── services/
│   │   │   │   ├── github.ts         # GitHub CLI interactions (gh)
│   │   │   │   ├── vercel.ts         # Vercel CLI interactions
│   │   │   │   ├── supabase.ts       # Supabase project validation
│   │   │   │   └── shopify.ts        # Shopify CLI interactions
│   │   │   └── utils/
│   │   │       ├── logger.ts         # Chalk + ora based logger
│   │   │       ├── validate.ts       # API key validation
│   │   │       └── config.ts         # marketing-os.config.json reader/writer
│   │   ├── templates/                 # Template files (copied during scaffold)
│   │   │   ├── agents/               # The entire /agents directory template
│   │   │   │   ├── app/
│   │   │   │   │   ├── layout.tsx.hbs
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   ├── globals.css
│   │   │   │   │   ├── login/
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   ├── chat/
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   ├── skills/
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   ├── activity/
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   └── api/
│   │   │   │   │       ├── chat/
│   │   │   │   │       │   └── route.ts
│   │   │   │   │       ├── skills/
│   │   │   │   │       │   └── [skillId]/
│   │   │   │   │       │       └── route.ts
│   │   │   │   │       └── webhooks/
│   │   │   │   │           └── github/
│   │   │   │   │               └── route.ts
│   │   │   │   ├── src/
│   │   │   │   │   └── mastra/
│   │   │   │   │       ├── index.ts.hbs
│   │   │   │   │       ├── agents/
│   │   │   │   │       │   ├── marketing-agent.ts.hbs
│   │   │   │   │       │   └── creative-agent.ts
│   │   │   │   │       ├── tools/
│   │   │   │   │       │   ├── shopify-admin.ts
│   │   │   │   │       │   ├── dispatch-to-github.ts.hbs
│   │   │   │   │       │   ├── pr-status.ts
│   │   │   │   │       │   ├── ga4-reporting.ts
│   │   │   │   │       │   ├── meta-ads.ts
│   │   │   │   │       │   └── google-ads.ts
│   │   │   │   │       ├── workflows/
│   │   │   │   │       │   ├── weekly-review.ts
│   │   │   │   │       │   └── campaign-launch.ts
│   │   │   │   │       └── skills/
│   │   │   │   │           ├── _registry.ts.hbs
│   │   │   │   │           ├── store-health-check.ts
│   │   │   │   │           ├── ad-copy-generator.ts
│   │   │   │   │           └── weekly-digest.ts
│   │   │   │   ├── components/
│   │   │   │   │   ├── ui/           # shadcn/ui components
│   │   │   │   │   ├── skill-card.tsx
│   │   │   │   │   ├── pr-card.tsx
│   │   │   │   │   ├── metric-card.tsx
│   │   │   │   │   ├── nav.tsx
│   │   │   │   │   ├── header.tsx.hbs
│   │   │   │   │   └── chat/
│   │   │   │   │       └── marketing-chat.tsx
│   │   │   │   ├── lib/
│   │   │   │   │   ├── supabase/
│   │   │   │   │   │   ├── client.ts.hbs
│   │   │   │   │   │   ├── server.ts.hbs
│   │   │   │   │   │   └── middleware.ts
│   │   │   │   │   ├── github.ts
│   │   │   │   │   ├── skills.ts
│   │   │   │   │   └── utils.ts
│   │   │   │   ├── middleware.ts
│   │   │   │   ├── next.config.ts
│   │   │   │   ├── tailwind.config.ts
│   │   │   │   ├── tsconfig.json
│   │   │   │   ├── postcss.config.mjs
│   │   │   │   ├── package.json.hbs
│   │   │   │   ├── vercel.json
│   │   │   │   ├── .env.example.hbs
│   │   │   │   └── .gitkeep
│   │   │   ├── docs/                 # /docs directory template
│   │   │   │   ├── brand-voice.md.hbs
│   │   │   │   ├── product-knowledge.md.hbs
│   │   │   │   └── policies.md.hbs
│   │   │   ├── github/               # .github/workflows template
│   │   │   │   └── workflows/
│   │   │   │       ├── marketing-os-agent.yml.hbs
│   │   │   │       └── marketing-os-review.yml
│   │   │   ├── CLAUDE.md.hbs         # CLAUDE.md template
│   │   │   └── marketing-os.config.json.hbs
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   └── skills/                        # Community skills packages
│       ├── community/
│       │   ├── klaviyo-sync/
│       │   │   ├── index.ts
│       │   │   ├── README.md
│       │   │   └── package.json
│       │   └── ... (more community skills)
│       └── README.md
│
├── apps/
│   └── docs/                          # Documentation site (optional, future)
│       └── ... (Astro or Next.js docs site)
│
├── examples/
│   └── demo-store/                    # Example scaffolded store for testing
│       ├── assets/                    # Minimal Shopify theme
│       ├── config/
│       ├── layout/
│       ├── sections/
│       ├── templates/
│       ├── agents/                    # Pre-scaffolded /agents
│       ├── docs/
│       ├── .github/workflows/
│       ├── CLAUDE.md
│       └── marketing-os.config.json
│
├── .github/
│   └── workflows/
│       ├── ci.yml                     # Lint, type-check, test on PRs
│       ├── publish.yml                # Publish to npm on release
│       └── integration-test.yml       # E2E test: scaffold + build
│
├── pnpm-workspace.yaml
├── turbo.json
├── package.json                       # Root package.json
├── tsconfig.base.json                 # Shared TS config
├── .eslintrc.js
├── .prettierrc
├── .gitignore
├── LICENSE                            # MIT
├── README.md                          # Project README
├── CONTRIBUTING.md
└── CHANGELOG.md
```

---

## 3. Package Configuration

### 3.1 Root `package.json`

```json
{
  "name": "marketing-os",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "changeset": "changeset",
    "release": "turbo run build && changeset publish"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "turbo": "^2.0.0",
    "typescript": "^5.7.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### 3.2 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
  - "packages/skills/*"
  - "apps/*"
  - "examples/*"
```

### 3.3 `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "test": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

### 3.4 `create-marketing-os/package.json`

```json
{
  "name": "create-marketing-os",
  "version": "0.1.0",
  "description": "AI marketing operations for Shopify, powered by your git repo",
  "type": "module",
  "bin": {
    "create-marketing-os": "./dist/index.js"
  },
  "files": [
    "dist",
    "templates"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "@inquirer/prompts": "^7.0.0",
    "chalk": "^5.0.0",
    "ora": "^8.0.0",
    "execa": "^9.0.0",
    "fs-extra": "^11.0.0",
    "glob": "^11.0.0",
    "handlebars": "^4.7.0",
    "validate-npm-package-name": "^6.0.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "vitest": "^2.0.0",
    "@types/fs-extra": "^11.0.0",
    "typescript": "^5.7.0"
  },
  "keywords": [
    "shopify",
    "marketing",
    "ai",
    "agents",
    "mastra",
    "claude",
    "ecommerce"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/openconjecture/marketing-os"
  },
  "homepage": "https://marketing-os.dev"
}
```

### 3.5 `create-marketing-os/tsup.config.ts`

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  dts: false,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
```

---

## 4. Template File Convention

Files that need variable interpolation use the `.hbs` extension (Handlebars). The CLI processes these during scaffolding:

- `file.ts.hbs` → rendered to `file.ts` in the target directory
- `file.ts` (no `.hbs`) → copied as-is (static file)

The Handlebars context object passed to templates:

```typescript
interface TemplateContext {
  storeName: string;        // "My Store"
  storeUrl: string;         // "mystore.myshopify.com"
  supabaseUrl: string;      // "https://xxx.supabase.co"
  supabaseAnonKey: string;  // "eyJhbGci..."
  adminEmail: string;       // "me@example.com"
  repoFullName: string;     // "myorg/mystore-theme"
  enabledIntegrations: string[]; // ["ga4", "meta_ads"]
  packageManager: string;   // "npm" | "pnpm" | "yarn"
  version: string;          // CLI version (e.g., "0.1.0")
}
```

---

## 5. CI/CD Workflows

### 5.1 `ci.yml` — PR Checks

```yaml
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo typecheck lint test build
```

### 5.2 `publish.yml` — npm Release

```yaml
name: Publish
on:
  push:
    branches: [main]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm, registry-url: "https://registry.npmjs.org" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build
      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm changeset publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```
