# 03 — CLI Specification

> Marketing OS · Open Conjecture · March 2026

---

## 1. Overview

The `create-marketing-os` CLI is the primary entry point for the framework. It is published to npm and invoked via `npx`. It scaffolds the Marketing OS console into an existing or new Shopify theme repository, configures integrations, and optionally deploys to Vercel.

```bash
npx create-marketing-os
```

---

## 2. Package Details

| Field | Value |
|-------|-------|
| npm package name | `create-marketing-os` |
| Binary name | `create-marketing-os` |
| Runtime | Node.js >= 20 |
| Dependencies | commander, inquirer, chalk, ora, execa, fs-extra, degit |
| Dev dependencies | typescript, tsup, vitest |
| Entry point | `dist/index.js` |
| Build tool | tsup (bundles to single ESM file) |

---

## 3. Command Interface

### 3.1 Default (Interactive Mode)

```bash
npx create-marketing-os
```

Launches the interactive prompt sequence (see Section 5).

### 3.2 With Flags (Non-Interactive)

```bash
npx create-marketing-os \
  --store mystore.myshopify.com \
  --repo myorg/mystore-theme \
  --anthropic-key sk-ant-... \
  --supabase-url https://xxx.supabase.co \
  --supabase-anon-key eyJ... \
  --deploy \
  --yes
```

### 3.3 Init Subcommand (Into Existing Repo)

```bash
cd /path/to/my-shopify-theme
npx create-marketing-os init
```

Detects the existing Shopify theme structure and scaffolds around it.

### 3.4 Flags Reference

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--store` | string | (prompt) | Shopify store URL (mystore.myshopify.com) |
| `--repo` | string | (prompt) | GitHub repository (org/repo or full URL) |
| `--dir` | string | `.` | Target directory for scaffolding |
| `--anthropic-key` | string | (prompt) | Anthropic API key |
| `--supabase-url` | string | (prompt) | Supabase project URL |
| `--supabase-anon-key` | string | (prompt) | Supabase anon/public key |
| `--admin-email` | string | (prompt) | Email for the admin user (magic link login) |
| `--deploy` | boolean | false | Auto-deploy to Vercel after scaffolding |
| `--skip-git` | boolean | false | Skip git init and GitHub setup |
| `--skip-supabase` | boolean | false | Skip Supabase setup (use local SQLite for dev) |
| `--yes` / `-y` | boolean | false | Accept all defaults, skip confirmations |
| `--verbose` | boolean | false | Show detailed output |
| `--version` / `-v` | — | — | Print version and exit |
| `--help` / `-h` | — | — | Print help and exit |

---

## 4. Prerequisites Detection

Before prompting, the CLI checks for required tooling and reports missing items:

```
Checking prerequisites...
  ✓ Node.js 20.11.0
  ✓ npm 10.2.4
  ✓ git 2.43.0
  ✓ gh (GitHub CLI) 2.44.1
  ⚠ shopify (Shopify CLI) — not found (optional, needed for theme pull)
  ⚠ vercel (Vercel CLI) — not found (optional, needed for --deploy)
```

Required: `node >= 20`, `git >= 2.28`, `gh` (GitHub CLI)
Optional: `shopify` (Shopify CLI), `vercel` (Vercel CLI)

If `gh` is not authenticated, prompt the user to run `gh auth login` first.

---

## 5. Interactive Prompt Sequence

### Step 1: Store Connection

```
┌─────────────────────────────────────────────────┐
│  Marketing OS Setup                              │
│                                                  │
│  ? Shopify store URL: mystore.myshopify.com     │
│                                                  │
│  ? Do you have an existing theme repo on GitHub? │
│    > Yes — I'll enter the repo                   │
│      No — pull my theme and create a new repo    │
│                                                  │
│  (if Yes):                                       │
│  ? GitHub repository: myorg/mystore-theme        │
│    Cloning repository...                         │
│    ✓ Detected Shopify theme (Dawn-based)         │
│                                                  │
│  (if No):                                        │
│  ? GitHub repository name: mystore-theme         │
│  ? GitHub org or username: myorg                 │
│    Running: shopify theme pull...                │
│    Initializing git repository...                │
│    Creating GitHub repo: myorg/mystore-theme...  │
│    Pushing initial commit...                     │
│    ✓ Theme synced to GitHub                      │
└─────────────────────────────────────────────────┘
```

### Step 2: API Keys & Services

```
┌─────────────────────────────────────────────────┐
│  Service Configuration                           │
│                                                  │
│  ? Anthropic API key: sk-ant-api03-...          │
│    ✓ Key validated                               │
│                                                  │
│  ? Set up Supabase? (recommended)                │
│    > Yes — create a new project                  │
│      Yes — use an existing project               │
│      No — use local SQLite for development       │
│                                                  │
│  (if new project):                               │
│    Opening https://supabase.com/dashboard/new    │
│    ? Supabase project URL: https://xxx.supa...  │
│    ? Supabase anon key: eyJhbGci...             │
│    ✓ Connected to Supabase                       │
│                                                  │
│  ? Admin email for login: me@example.com         │
│    ✓ Admin user will be created on first login   │
└─────────────────────────────────────────────────┘
```

### Step 3: Integrations

```
┌─────────────────────────────────────────────────┐
│  Integrations (you can add more later)           │
│                                                  │
│  ? Which integrations do you want to enable?     │
│    ☑ Shopify Admin API (always enabled)          │
│    ☐ Google Analytics (GA4)                      │
│    ☐ Meta Ads                                    │
│    ☐ Google Ads                                  │
│    ☐ Klaviyo                                     │
│                                                  │
│  (for each selected, prompt for credentials)     │
└─────────────────────────────────────────────────┘
```

### Step 4: Scaffolding

```
┌─────────────────────────────────────────────────┐
│  Scaffolding Marketing OS...                     │
│                                                  │
│  Creating /agents (Next.js + Mastra project)     │
│    ├─ app/ (Console pages)                       │
│    ├─ src/mastra/ (Agents, tools, skills)        │
│    ├─ components/ (UI components)                │
│    ├─ lib/ (Supabase client, utilities)          │
│    └─ package.json                               │
│  Creating /docs                                  │
│    ├─ brand-voice.md (template)                  │
│    └─ product-knowledge.md (template)            │
│  Creating /.github/workflows                     │
│    ├─ marketing-os-agent.yml                     │
│    └─ marketing-os-review.yml                    │
│  Creating CLAUDE.md                              │
│  Creating marketing-os.config.json               │
│                                                  │
│  Installing dependencies in /agents...           │
│  ✓ Scaffolding complete                          │
└─────────────────────────────────────────────────┘
```

### Step 5: Secrets & Deploy

```
┌─────────────────────────────────────────────────┐
│  Setting up secrets...                           │
│                                                  │
│  Setting GitHub Actions secrets via gh CLI:      │
│    ✓ ANTHROPIC_API_KEY                           │
│    ✓ SUPABASE_URL                                │
│    ✓ SUPABASE_ANON_KEY                           │
│    ✓ SHOPIFY_ACCESS_TOKEN                        │
│                                                  │
│  ? Deploy to Vercel now? (Y/n)                   │
│                                                  │
│  (if Yes):                                       │
│    Running: vercel link (root: agents)           │
│    Setting Vercel env vars...                    │
│    Running: vercel --prod                        │
│    ✓ Console live at:                            │
│      https://mystore-agents.vercel.app           │
│                                                  │
│  (if No):                                        │
│    To deploy later, run:                         │
│      cd agents && vercel                         │
│                                                  │
│  ✓ Setup complete!                               │
│                                                  │
│  Next steps:                                     │
│    1. Open https://mystore-agents.vercel.app     │
│    2. Log in with: me@example.com                │
│    3. Edit /docs/brand-voice.md with your brand  │
│    4. Try: "How is my store performing?"          │
└─────────────────────────────────────────────────┘
```

---

## 6. Scaffolding Logic

### 6.1 Theme Detection

The CLI detects a Shopify theme by looking for:
- `config/settings_schema.json` (present in all Shopify themes)
- `layout/theme.liquid` (present in all Shopify themes)
- `templates/` directory

If detected, log the theme name from `config/settings_schema.json`.

### 6.2 Template Rendering

The CLI uses template files stored in the `create-marketing-os` package under `templates/`. Files that need variable interpolation use `{{variable}}` syntax and are processed by a simple string replacement engine (no heavy templating library needed).

Variables available in templates:
- `{{storeName}}` — e.g., "My Store"
- `{{storeUrl}}` — e.g., "mystore.myshopify.com"
- `{{supabaseUrl}}` — e.g., "https://xxx.supabase.co"
- `{{adminEmail}}` — e.g., "me@example.com"
- `{{repoFullName}}` — e.g., "myorg/mystore-theme"
- `{{enabledIntegrations}}` — JSON array of enabled integration IDs

### 6.3 File Conflict Handling

If files already exist (e.g., running `init` in an existing repo):
- `/agents/` directory exists → abort with error message
- `CLAUDE.md` exists → prompt to overwrite or merge
- `.github/workflows/marketing-os-*.yml` exists → prompt to overwrite
- `/docs/` directory exists → skip (don't overwrite user content)

### 6.4 Dependencies Installation

After scaffolding, the CLI runs `npm install` (or detects pnpm/yarn) inside `/agents/`:

```bash
cd agents && npm install
```

---

## 7. Post-Scaffold Commands

The CLI also provides utility commands for after setup:

### `npx create-marketing-os add-skill <name>`

Scaffolds a new skill file in `/agents/src/mastra/skills/` with the correct template.

### `npx create-marketing-os add-integration <name>`

Adds a new integration (GA4, Meta, etc.) to an existing install — creates the tool file, updates config, prompts for credentials.

### `npx create-marketing-os doctor`

Validates the installation — checks all env vars are set, Supabase is reachable, GitHub secrets exist, Vercel project is linked.

---

## 8. Error Handling

| Error | Handling |
|-------|---------|
| Not in a git repo (for `init`) | Error with suggestion: `git init` first |
| `gh` not authenticated | Error with suggestion: `gh auth login` |
| GitHub repo creation fails | Show error, suggest creating manually |
| Shopify CLI not installed (for theme pull) | Show install instructions, offer to continue without |
| Supabase connection fails | Show error, offer to skip (use local SQLite) |
| Vercel CLI not installed (for deploy) | Show install instructions, offer to skip deploy |
| npm install fails | Show error output, suggest running manually |
| API key validation fails | Show error, prompt to re-enter |

All errors should be user-friendly with clear next-step suggestions. Use `chalk` for colored output and `ora` for spinners.
