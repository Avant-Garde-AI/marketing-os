# Marketing OS — Specification Documents

> Open Conjecture · March 2026

## Overview

Marketing OS is an open-source CLI + framework that turns any Shopify store's GitHub-synced theme repository into an AI-powered marketing operations platform. It scaffolds an opinionated Next.js admin console (powered by Mastra agents) into the store's existing theme repo, deploys to Vercel in minutes, and connects a Claude Code-driven async workflow for safely making storefront changes via pull requests.

The goal: a store owner or agency partner goes from syncing their Shopify theme to GitHub → logging into a branded agents console → executing automated marketing improvements on their store in **under 10 minutes**.

## Document Index

| # | Document | Description |
|---|----------|-------------|
| 1 | [01-PRD.md](./01-PRD.md) | Product Requirements Document — vision, personas, user stories, success metrics |
| 2 | [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) | Technical Architecture — system design, data flow, infrastructure topology |
| 3 | [03-CLI-SPEC.md](./03-CLI-SPEC.md) | CLI Specification — `create-marketing-os` command design, flags, scaffolding logic |
| 4 | [04-SCAFFOLD-SPEC.md](./04-SCAFFOLD-SPEC.md) | Scaffold Template Specification — complete file tree, every generated file's purpose and content |
| 5 | [05-AGENTS-AND-SKILLS.md](./05-AGENTS-AND-SKILLS.md) | Agent & Skills Specification — Mastra agent definitions, tool contracts, skill format, community registry |
| 6 | [06-UI-SPEC.md](./06-UI-SPEC.md) | UI/UX Specification — Console pages, components, chat integration, skill cards, activity feed |
| 7 | [07-DEPLOYMENT.md](./07-DEPLOYMENT.md) | Deployment & Infrastructure — Vercel config, Supabase schema, GitHub Actions workflows, CI/CD |
| 8 | [08-COMMUNITY-ECOSYSTEM.md](./08-COMMUNITY-ECOSYSTEM.md) | Community & Ecosystem — skill contribution format, governance, partner integration patterns |
| 9 | [09-REPOSITORY-STRUCTURE.md](./09-REPOSITORY-STRUCTURE.md) | Repository Structure — the `marketing-os` monorepo itself (the repo that builds and publishes the CLI + templates) |
| 10 | [10-IMPLEMENTATION-PLAN.md](./10-IMPLEMENTATION-PLAN.md) | Implementation Plan — phased build order, milestones, and agent coding instructions |

## Key Technology Decisions

- **CLI**: Node.js, published to npm as `create-marketing-os`
- **Admin Console**: Next.js 15 (App Router) + React 19 + Tailwind CSS + shadcn/ui
- **Agent Framework**: Mastra (TypeScript-native, Vercel-deployable, AI SDK compatible)
- **Chat UI**: assistant-ui + @ai-sdk/react hooks
- **Auth**: Supabase Auth (magic link default)
- **Database**: Supabase Postgres (Mastra @mastra/pg adapter)
- **Async Execution**: GitHub Actions + Claude Code Action (claude-code-action@v1)
- **Deployment**: Vercel (monorepo subfolder deploy from /agents)
- **Storefront Sync**: Shopify CLI + GitHub integration (bidirectional)

## Conventions for Coding Agents

When using these specs to bootstrap the project:

1. Read `09-REPOSITORY-STRUCTURE.md` first — it defines the monorepo you are building
2. Read `10-IMPLEMENTATION-PLAN.md` for build order and phase gates
3. Each spec document is self-contained but cross-references others by filename
4. Code examples in specs are canonical — use them as starting points, not pseudocode
5. All TypeScript, strict mode, ESM-only
6. Use pnpm as the package manager for the monorepo
7. Follow the file naming conventions in `04-SCAFFOLD-SPEC.md` exactly
