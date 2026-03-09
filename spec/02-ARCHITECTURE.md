# 02 — Technical Architecture

> Marketing OS · Open Conjecture · March 2026

---

## 1. System Overview

Marketing OS is a three-layer system that lives inside a Shopify store's GitHub repository:

```
┌─────────────────────────────────────────────────────┐
│                    TRIGGER LAYER                     │
│  Console Chat │ Skill Execution │ Cron │ Webhooks    │
└──────────┬────────────────────────┬─────────────────┘
           │                        │
     ┌─────▼──────┐          ┌─────▼──────┐
     │  SYNC PATH │          │ ASYNC PATH │
     │  (Mastra   │          │ (GitHub    │
     │   on       │          │  Actions + │
     │   Vercel)  │          │  Claude    │
     │            │          │  Code)     │
     │  Streaming │          │            │
     │  responses │          │  → PR      │
     │  + reports │          │  → Review  │
     │            │          │  → Deploy  │
     └─────┬──────┘          └─────┬──────┘
           │                        │
     ┌─────▼────────────────────────▼─────┐
     │         SHARED CONTEXT LAYER        │
     │  /docs (brand truth)                │
     │  /agents/src/mastra (skills, tools) │
     │  CLAUDE.md (agent instructions)     │
     │  marketing-os.config.json           │
     │  Supabase (persistence + auth)      │
     └────────────────────────────────────┘
```

### Sync Path (Real-Time)
- Next.js app on Vercel with embedded Mastra agents
- Handles: chat conversations, skill execution (read-only), performance queries, report generation
- UI: assistant-ui chat, skill cards, dashboard metrics
- Auth: Supabase magic link
- Never writes to theme files directly

### Async Path (Git-Based)
- GitHub Actions workflow triggered by issues, cron, or repository_dispatch events
- Claude Code runs inside the GHA container with full repo context
- All storefront modifications go through PRs — never direct to main
- CLAUDE.md provides the agent's operating instructions and boundaries
- GitHub webhooks notify the console of PR status changes

### Shared Context Layer
- `/docs/*.md` — brand voice, product knowledge, policies (human-edited)
- `/agents/src/mastra/` — agent definitions, tools, skills (code)
- `CLAUDE.md` — instructions for the Claude Code async path
- `marketing-os.config.json` — store configuration, integration toggles
- Supabase — persistent storage for conversations, activity logs, skill configs

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| CLI | Node.js + Commander.js + Inquirer.js | Standard npm scaffolding toolchain |
| Console Framework | Next.js 15 (App Router) | Vercel-native, SSR + API routes in one project |
| UI | React 19 + Tailwind CSS + shadcn/ui | Modern, composable, Mastra-compatible |
| Chat UI | assistant-ui + @ai-sdk/react | Best-in-class AI chat components with Mastra integration |
| Agent Framework | Mastra | TypeScript-native, Vercel-deployable, built-in memory + evals |
| AI SDK | @mastra/ai-sdk + @ai-sdk/react | Streaming bridge between Mastra agents and React hooks |
| Auth | Supabase Auth (@mastra/auth-supabase) | Magic link default, JWT-based, first-class Mastra support |
| Database | Supabase Postgres (@mastra/pg) | Agent memory, conversation history, activity logs, skill configs |
| Async Execution | GitHub Actions + claude-code-action@v1 | Claude Code in sandboxed GHA containers, PR-based output |
| Deployment | Vercel (monorepo subfolder) | One-click from GitHub, serverless functions for API routes |
| Storefront Sync | Shopify CLI + GitHub integration | Bidirectional sync between theme files and Shopify admin |

---

## 3. Data Flow Diagrams

### 3.1 Chat Conversation Flow

```
User (Console) → Next.js API Route (/api/chat) → Mastra Agent
                                                      │
                                                      ├─ Tool: ga4-reporting → GA4 API → structured data
                                                      ├─ Tool: meta-ads → Meta Marketing API → metrics
                                                      ├─ Tool: shopify-admin → Shopify Admin API → store data
                                                      ├─ Tool: dispatch-to-github → GitHub API → creates issue
                                                      │
                                                      ▼
                                               Streaming Response
                                                      │
                                                      ▼
                                            useChat() → assistant-ui
                                            (renders text + tool cards)
```

### 3.2 Async Storefront Change Flow

```
Trigger (chat dispatch / cron / manual issue)
    │
    ▼
GitHub Issue (labeled: marketing-os)
    │
    ▼
GitHub Actions Workflow (.github/workflows/marketing-os-agent.yml)
    │
    ▼
Claude Code Action (claude-code-action@v1)
    ├─ Reads: CLAUDE.md, /docs/*, theme files, /agents/src/mastra/skills/*
    ├─ Executes: skill logic (modify Liquid, generate copy, update configs)
    ├─ Creates: feature branch + PR with structured description
    │
    ▼
GitHub Webhook → /api/webhooks/github → Supabase (activity log)
    │
    ▼
Console Activity Feed (real-time via Supabase subscriptions)
    │
    ▼
User reviews PR → Approve → Merge → Shopify GitHub integration auto-deploys
```

### 3.3 Skill Execution Flow

```
User clicks "Execute" on Skill Card
    │
    ▼
AutoForm (generated from Zod schema) → User fills inputs → Submit
    │
    ▼
POST /api/skills/[skillId] → Mastra workflow execution
    │
    ├─ If read-only skill (report, analysis):
    │     → Execute inline → return results → render in chat/card
    │
    ├─ If write skill (theme change, campaign creation):
    │     → dispatch-to-github tool → creates issue
    │     → GHA picks up → Claude Code → PR
    │
    ▼
Results displayed in chat (inline) or Activity feed (PR)
```

---

## 4. Authentication & Authorization

### 4.1 Console Auth (Supabase)

```typescript
// agents/src/mastra/index.ts
import { Mastra } from "@mastra/core";
import { MastraAuthSupabase } from "@mastra/auth-supabase";

export const mastra = new Mastra({
  server: {
    auth: new MastraAuthSupabase({
      url: process.env.SUPABASE_URL!,
      anonKey: process.env.SUPABASE_ANON_KEY!,
    }),
  },
});
```

- Default: magic link (email-based, no password)
- CLI creates the admin user during setup
- Supabase RLS policies scope data per `user_id`
- JWT tokens passed via Authorization header to all Mastra API routes
- Session persistence via Supabase client-side SDK

### 4.2 GitHub Auth (for Claude Code path)

- `GITHUB_TOKEN` stored as GitHub Actions secret (created by CLI)
- Claude Code Action uses the GitHub App token for PR creation
- Webhook secret for `/api/webhooks/github` endpoint validation

### 4.3 API Key Management

All third-party API keys are stored as:
1. **GitHub Actions secrets** (for the async Claude Code path)
2. **Vercel environment variables** (for the sync Mastra path)
3. **Never in code or config files** (`.env.example` documents required vars)

Required keys:
- `ANTHROPIC_API_KEY` — for Mastra agents + Claude Code
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`
- `SHOPIFY_STORE_URL` + `SHOPIFY_ACCESS_TOKEN` (Shopify Admin API)

Optional keys (per integration):
- `GA4_PROPERTY_ID` + `GOOGLE_SERVICE_ACCOUNT_KEY`
- `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID`
- `GOOGLE_ADS_DEVELOPER_TOKEN` + `GOOGLE_ADS_CUSTOMER_ID`

---

## 5. Vercel Deployment Architecture

The store's GitHub repository contains both the Shopify theme (root) and the Marketing OS console (`/agents`). These are consumed by two separate systems:

```
GitHub Repository: myorg/mystore-theme
│
├── / (root) ──────── Shopify GitHub Integration (syncs theme files)
│   ├── assets/
│   ├── config/
│   ├── layout/
│   ├── sections/
│   ├── snippets/
│   └── templates/
│
├── /agents ────────── Vercel Project (root directory: agents)
│   ├── app/            Next.js pages
│   ├── src/mastra/     Agent definitions
│   └── package.json    Dependencies
│
├── /docs ─────────── Shared context (read by both paths)
│   ├── brand-voice.md
│   └── product-knowledge.md
│
├── /.github/workflows ── GitHub Actions (async Claude Code path)
│
├── CLAUDE.md ─────── Instructions for Claude Code
└── marketing-os.config.json
```

### Vercel Project Settings

| Setting | Value |
|---------|-------|
| Root Directory | `agents` |
| Framework Preset | Next.js |
| Build Command | `next build` (default) |
| Output Directory | `.next` (default) |
| Include files outside Root Directory | **Enabled** (to access /docs) |
| Node.js Version | 20.x |

### Ignored Build Step

Configure Vercel to only rebuild when `/agents` or `/docs` change:

```bash
# Vercel Ignored Build Step command
git diff HEAD^ HEAD --quiet ./agents/ ./docs/ || exit 1
```

This prevents unnecessary Vercel rebuilds when only theme files change (those are handled by Shopify's GitHub integration).

---

## 6. Database Schema (Supabase)

See `07-DEPLOYMENT.md` for full SQL migrations. High-level tables:

| Table | Purpose |
|-------|---------|
| `auth.users` | Supabase managed auth table |
| `public.profiles` | Extended user profiles (store URL, role) |
| `public.activity_log` | PR events, skill executions, agent actions |
| `public.skill_configs` | Per-store skill configuration and enabled state |
| `public.store_settings` | Store metadata, integration credentials (encrypted) |

Mastra manages its own tables for:
- Conversation threads and messages (via @mastra/pg)
- Observational Memory observations and reflections
- Workflow execution state (for suspend/resume)

---

## 7. Security Boundaries

| Boundary | Enforcement |
|----------|-------------|
| Console access | Supabase Auth (magic link + JWT) |
| Mastra API routes | MastraAuthSupabase middleware on all /api/* routes |
| Storefront writes | All writes go through PRs — never direct API calls to Shopify theme |
| Claude Code permissions | `--allowedTools` flag in GHA limits Claude Code's capabilities |
| API key storage | GitHub secrets + Vercel env vars — never committed to repo |
| Webhook validation | GitHub webhook secret verification on /api/webhooks/github |
| RLS | Supabase Row Level Security on all public tables |
| Theme file access | Mastra agents can READ theme files (via Vercel include setting), but WRITE only via dispatch-to-github |

---

## 8. Error Handling & Resilience

| Scenario | Handling |
|----------|---------|
| Mastra agent tool call fails | Retry with exponential backoff (Mastra built-in), surface error in chat |
| Claude Code GHA fails | GHA posts failure comment on the issue, Activity feed shows error state |
| Vercel function timeout | maxDuration set to 60s for chat routes, 300s for skill execution routes |
| Supabase down | Graceful degradation — chat works without persistence, dashboard shows stale data |
| GitHub webhook missed | Polling fallback — Activity feed refreshes every 30s as backup |
| Invalid skill input | Zod schema validation catches before execution, form shows validation errors |
