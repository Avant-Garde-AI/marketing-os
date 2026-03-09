# 01 — Product Requirements Document

> Marketing OS · Open Conjecture · March 2026

---

## 1. Vision

Marketing OS is an open-source framework that transforms any Shopify store's GitHub-synced theme repository into an AI-powered marketing operations platform. It provides:

- A **CLI** (`create-marketing-os`) that scaffolds an opinionated admin console into an existing Shopify theme repo
- A **Next.js admin console** deployed to Vercel where store owners and agency partners can chat with their store's AI marketing agent, browse and execute skills, and review AI-generated changes
- A **Claude Code async pipeline** that safely modifies the storefront via pull requests — every change is tracked, reviewable, and reversible
- A **community skills ecosystem** where Shopify partners and developers contribute reusable marketing automation skills

The north star metric is: **store synced to GitHub → logged into console → first automated improvement executed in under 10 minutes.**

---

## 2. Target Personas

### 2.1 Brand Owner / DTC Operator
- Runs a mid-market Shopify store ($1M–$50M revenue)
- Semi-technical — comfortable with Shopify admin, not comfortable with code
- Wants to improve marketing performance without hiring a full agency
- Cares about: ROI, speed, maintaining brand voice, not breaking the store

### 2.2 Agency Account Manager
- Manages 5–30 Shopify stores for clients
- Needs to execute repeatable marketing playbooks across stores
- Wants to delegate routine tasks to AI while maintaining quality control
- Cares about: efficiency, client visibility, consistent execution, scalable process

### 2.3 Shopify Developer / Technical Partner
- Builds themes, apps, and integrations for Shopify stores
- Wants to contribute skills to the ecosystem and integrate with their own tools
- Cares about: clean APIs, extensibility, community recognition, monetization potential

---

## 3. User Stories

### Setup & Onboarding

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S-01 | As a brand owner, I want to run a single CLI command to set up Marketing OS on my store | CLI scaffolds /agents, creates GitHub workflows, generates CLAUDE.md, outputs a working Vercel-deployable project |
| S-02 | As a brand owner, I want to connect my existing Shopify theme repo | CLI detects existing Shopify theme structure and scaffolds around it without modifying theme files |
| S-03 | As a brand owner, I want to deploy to Vercel in one step | CLI runs `vercel link` with correct root directory config, sets env vars, and deploys |
| S-04 | As a brand owner, I want to log in with just my email | Supabase magic link auth — no password setup required |
| S-05 | As a brand owner, I want the whole setup to take under 10 minutes | Measured from `npx create-marketing-os` to first successful agent interaction in console |

### Console — Chat

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| C-01 | As a brand owner, I want to chat with my store's marketing agent | Streaming chat interface with markdown rendering, tool result cards, and conversation history |
| C-02 | As a brand owner, I want to ask about my store's performance | Agent can query GA4, Meta Ads, Google Ads via MCP tools and return structured data |
| C-03 | As a brand owner, I want to request storefront changes via chat | Agent creates GitHub issue → Claude Code GHA picks it up → PR appears in Activity feed |
| C-04 | As a brand owner, I want to generate ad copy that matches my brand | Agent reads /docs/brand-voice.md and generates copy consistent with brand guidelines |
| C-05 | As an agency manager, I want conversation history to persist across sessions | Mastra memory with Supabase Postgres persistence, Observational Memory for long conversations |

### Console — Skills Library

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| K-01 | As a brand owner, I want to browse available skills as visual cards | Card grid with skill name, description, category, and "Execute" button |
| K-02 | As a brand owner, I want to execute a skill with a simple form | Clicking "Execute" opens a form generated from the skill's Zod input schema |
| K-03 | As a brand owner, I want to see pre-installed starter skills | At least 3 starter skills ship with every install: Store Health Check, Ad Copy Generator, Weekly Performance Digest |
| K-04 | As an agency manager, I want to install community skills | CLI command or console UI to add skills from the community registry |
| K-05 | As a developer, I want to contribute a skill to the ecosystem | Documented skill format with metadata, Zod schemas, and a submission/review process |

### Console — Activity Feed

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| A-01 | As a brand owner, I want to see all AI-generated changes | Timeline of PRs created by Claude Code with status (open/merged/closed), diff summary, and skill attribution |
| A-02 | As a brand owner, I want to approve or reject changes from the console | Approve/reject buttons that proxy to GitHub PR review API |
| A-03 | As a brand owner, I want to see real-time updates when PRs are created | GitHub webhook → Supabase real-time subscription → Activity feed updates without page refresh |

### Async Pipeline (Claude Code)

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| P-01 | As a system, when a GitHub issue with the `marketing-os` label is created, Claude Code should execute | GitHub Actions workflow triggers on issue creation with correct label |
| P-02 | As a system, Claude Code should read CLAUDE.md and /docs for store context | CLAUDE.md includes store URL, brand guidelines location, skill instructions, and permission boundaries |
| P-03 | As a system, Claude Code should create a PR with its changes, never push to main | Claude Code creates a feature branch, commits changes, opens PR with structured description |
| P-04 | As a system, scheduled workflows should trigger on cron | Weekly performance digest runs on Monday 9am, posts results to Supabase |

---

## 4. Out of Scope (v1)

- Multi-tenant agency dashboard (single store per install for v1)
- Shopify app store listing (this is a CLI/open-source tool, not a Shopify app)
- Custom theme builder / visual editor (we modify themes via Claude Code PRs)
- Direct Shopify Admin API write operations from the console (all writes go through PRs)
- Paid tiers / billing (v1 is fully open source, BYOK for API keys)
- Mobile app (responsive web console is sufficient)
- Hydrogen / headless storefront support (theme-based stores only for v1)

---

## 5. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time to first agent interaction | < 10 minutes | Measured from CLI start to first chat message in console |
| Setup completion rate | > 80% | Users who start CLI and successfully deploy to Vercel |
| Weekly active console users | Track | Users who log in and interact with chat or skills at least once per week |
| PRs created by Claude Code | Track | Volume of automated storefront changes per store per week |
| PR approval rate | > 70% | Percentage of Claude Code PRs that get merged (vs closed) |
| Community skills contributed | 20+ in first 6 months | Skills submitted and accepted to the community registry |
| GitHub stars | 1,000 in first 3 months | Open source traction signal |

---

## 6. Naming

- **Package name**: `create-marketing-os` (npm)
- **GitHub repo**: `openconjecture/marketing-os`
- **Console URL pattern**: `{store-name}-agents.vercel.app` (or custom domain)
- **Brand**: "Marketing OS" — always two words, always capitalized
- **Tagline**: "AI marketing operations for Shopify, powered by your git repo"
