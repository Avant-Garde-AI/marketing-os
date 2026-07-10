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
| 11 | [11-HOSTED-PATH.md](./11-HOSTED-PATH.md) | Hosted Path — platform-owned deployment (default tier): Shopify App front door, pooled multi-tenant runtime, git-on-demand, draft-theme review loop, eject path |
| 12 | [12-STORE-MCP-AND-SEMANTIC-LAYER.md](./12-STORE-MCP-AND-SEMANTIC-LAYER.md) | Storefront MCP — per-store unified MCP endpoint, marketing semantic layer over GA4/Shopify, credential broker, App Proxy delivery (Tranche 1 SHIPPED 2026-07; as-built in marketing-os-app/docs/PLATFORM.md) |
| 13 | [13-CONSOLE-DESIGN-RETROFIT.md](./13-CONSOLE-DESIGN-RETROFIT.md) | Console Design Retrofit — light-primary UX overhaul of the agents console: tokens, typography registers, screen-by-screen IA, motion system, embedded tier, phased build plan (Spec 12 = Store MCP, tracked in phase commits) |
| 14 | [14-OFFER-SURFACES.md](./14-OFFER-SURFACES.md) | Storefront Surfaces & the Offer Agent — app-embed surface framework (manifest, runtime, events) + the AI offer engine: persona-grounded offers, gated + approved + shipped as experiments; the suite's first-party conversion anchor |
| 15 | [15-SLACK-INTEGRATION.md](./15-SLACK-INTEGRATION.md) | Slack Integration — one-click "Add to Slack" from the embedded admin; DM/@mention/slash chat with the tenant's agents via the existing chat handoff; thread↔memory continuity; proactive digests + gated approvals; hosted + client-deployed tiers (S0–S1 built + deployed) |
| 16 | [16-MODEL-AND-CREDENTIAL-TOPOLOGY.md](./16-MODEL-AND-CREDENTIAL-TOPOLOGY.md) | Model & Credential Topology — DECISION: model chosen by workload (Gemini/GCP for conversational chat surfaces; Claude reserved for Claude Code git-edit pipeline), key ownership follows tier (hosted shared pool vs self-deployed own key); what's per-tenant vs shared; chat-routing as-built vs target |
| 17 | [17-RICH-SURFACES-SLACK.md](./17-RICH-SURFACES-SLACK.md) | Rich Surfaces — bring the console generative UI (charts, metric cards, approval cards) into Slack via a shared structured-artifacts contract: mrkdwn/Block Kit, chart PNGs, interactive buttons (BUILDING) |
| 19 | [19-SCHEDULED-REPORTS.md](./19-SCHEDULED-REPORTS.md) | Scheduled Reports & Dashboards — save an insight as a recurring report (conversationally via /mos report, or console); cron runs due reports and drops branded cards into Slack; Option A chart types (compare/funnel/rich-KPI). R0 built + live (renumbered from 18; external-MCP owns 18) |
| 20 | [20-CAPABILITY-SUITE-AND-ACTIONS.md](./20-CAPABILITY-SUITE-AND-ACTIONS.md) | The Capability Suite & the Action Framework — how native tools, community skills, external MCP servers, and sub-agents compose: reads compose freely, writes narrow through one governed Action gate (preview → role → approve → execute → audit). Closes spec 18 §2.3. Slack is the primary surface; console is admin |
| 21 | [21-BRAND-CONVERSION-AGENT.md](./21-BRAND-CONVERSION-AGENT.md) | Brand Conversion Design Agent & Skill Pack — Vaan Group BCD thesis (anchor brand + transact relentlessly) as the first spec-20 skill pack: 4 read skills (profile+score, heuristic audit, scorecard, copy coherence) compose freely; 3 async skills are Actions that dispatch to the shipped design-loop → draft-theme proposal → approval card. No new execution infra (renumbered from external 11) |
| 18 | [18-EXTERNAL-MCP-INTEGRATION.md](./18-EXTERNAL-MCP-INTEGRATION.md) | External MCP Integration — attach third-party MCP tool servers to a tenant's hosted agent: `external_mcp_connections` registry (Vault-backed), broker read endpoint, per-session `@mastra/mcp` client merge with TTL cache + graceful degrade, console review-before-enable UI; first use = Arthaus's Picasso Concierge art knowledge-graph merged with GA4/Shopify (E0–E4 BUILT & DEPLOYED 2026-07-08) |

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
