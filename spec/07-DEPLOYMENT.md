# 07 — Deployment & Infrastructure

> Marketing OS · Open Conjecture · March 2026

---

## 1. Vercel Configuration

### 1.1 Project Settings

The Vercel project is connected to the same GitHub repository as the Shopify theme. Vercel only builds and deploys the `/agents` subdirectory.

| Setting | Value |
|---------|-------|
| Root Directory | `agents` |
| Framework Preset | Next.js |
| Build Command | `next build` |
| Output Directory | `.next` |
| Install Command | `npm install` |
| Node.js Version | 20.x |
| Include files outside Root Directory | **Enabled** |

### 1.2 Ignored Build Step

Only rebuild when `/agents` or `/docs` change:

```bash
git diff HEAD^ HEAD --quiet ./agents/ ./docs/ || exit 1
```

This prevents Vercel rebuilds when only Shopify theme files change.

### 1.3 Environment Variables

Set in Vercel project settings (via CLI or dashboard):

| Variable | Required | Scope |
|----------|----------|-------|
| `ANTHROPIC_API_KEY` | Yes | Production, Preview |
| `SUPABASE_URL` | Yes | Production, Preview |
| `SUPABASE_ANON_KEY` | Yes | Production, Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Production only |
| `SUPABASE_DATABASE_URL` | Yes | Production, Preview |
| `SHOPIFY_STORE_URL` | Yes | Production, Preview |
| `SHOPIFY_ACCESS_TOKEN` | Yes | Production, Preview |
| `GITHUB_TOKEN` | Yes | Production, Preview |
| `GITHUB_REPO` | Yes | Production, Preview |
| `GITHUB_WEBHOOK_SECRET` | Yes | Production only |
| `GA4_PROPERTY_ID` | Optional | Production, Preview |
| `META_ACCESS_TOKEN` | Optional | Production, Preview |

### 1.4 Function Configuration

| Route | Max Duration | Memory |
|-------|-------------|--------|
| `/api/chat` | 60s | 1024 MB |
| `/api/skills/*` | 300s | 1024 MB |
| `/api/webhooks/*` | 10s | 256 MB |

Configure in `vercel.json` (placed in `/agents/`):

```json
{
  "functions": {
    "app/api/chat/route.ts": {
      "maxDuration": 60,
      "memory": 1024
    },
    "app/api/skills/*/route.ts": {
      "maxDuration": 300,
      "memory": 1024
    }
  }
}
```

---

## 2. Supabase Schema

### 2.1 Database Migrations

The CLI generates a migration file or the user runs this SQL in Supabase Studio:

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  store_url TEXT,
  role TEXT DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity log table
CREATE TABLE public.activity_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('pr', 'skill', 'chat', 'scheduled')),
  action TEXT, -- e.g., 'opened', 'merged', 'closed', 'executed'
  title TEXT,
  description TEXT,
  -- PR-specific fields
  pr_number INTEGER,
  pr_title TEXT,
  pr_url TEXT,
  pr_status TEXT CHECK (pr_status IN ('open', 'merged', 'closed')),
  branch TEXT,
  -- Skill-specific fields
  skill_id TEXT,
  skill_inputs JSONB,
  skill_output JSONB,
  -- General
  metadata JSONB DEFAULT '{}',
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Skill configurations
CREATE TABLE public.skill_configs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  skill_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  last_executed_at TIMESTAMPTZ,
  execution_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Store settings
CREATE TABLE public.store_settings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users can read all (single-tenant for v1)
CREATE POLICY "Authenticated users can read profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Authenticated users can read activity"
  ON public.activity_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert activity"
  ON public.activity_log FOR INSERT
  TO service_role
  USING (true);

CREATE POLICY "Authenticated users can manage skills"
  ON public.skill_configs FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage settings"
  ON public.store_settings FOR ALL
  TO authenticated
  USING (true);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable Realtime on activity_log
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;

-- Indexes
CREATE INDEX idx_activity_log_type ON public.activity_log (type);
CREATE INDEX idx_activity_log_created_at ON public.activity_log (created_at DESC);
CREATE INDEX idx_activity_log_pr_status ON public.activity_log (pr_status)
  WHERE type = 'pr';
```

### 2.2 Mastra Storage Tables

Mastra's `@mastra/pg` adapter auto-creates its own tables on first connection:
- `mastra_threads` — Conversation threads
- `mastra_messages` — Individual messages
- `mastra_observations` — Observational Memory observations
- `mastra_reflections` — OM reflections
- `mastra_workflow_runs` — Workflow execution state

These are managed by Mastra and should not be manually modified.

---

## 3. GitHub Actions

### 3.1 Required Secrets

Set via `gh secret set` during CLI setup:

| Secret | Source |
|--------|--------|
| `ANTHROPIC_API_KEY` | User input during CLI setup |
| `SHOPIFY_STORE_URL` | User input |
| `SHOPIFY_ACCESS_TOKEN` | User input |

### 3.2 Workflow: marketing-os-agent.yml

See `04-SCAFFOLD-SPEC.md` for the full workflow file. Key behaviors:

- **Issue trigger**: Fires when an issue is created or labeled with `marketing-os`
- **Comment trigger**: Fires when a comment contains `@marketing-os`
- **Cron trigger**: Weekly Monday 9am ET for scheduled skills
- **Dispatch trigger**: For programmatic triggers from the console

### 3.3 Workflow: marketing-os-review.yml

Auto-review PRs created by Marketing OS:

```yaml
name: Marketing OS PR Review

on:
  pull_request:
    types: [opened]

jobs:
  review:
    if: contains(github.event.pull_request.title, '[Marketing OS]')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Review this PR created by Marketing OS.
            Check for:
            1. Liquid syntax errors
            2. Brand voice consistency (check /docs/brand-voice.md)
            3. No breaking changes to theme structure
            4. No security issues (no exposed keys, etc.)
            Approve if everything looks good, or request changes with specifics.
          claude_args: "--max-turns 5"
```

### 3.4 GitHub Webhook Setup

The CLI configures a webhook on the repository:

```bash
gh api repos/{owner}/{repo}/hooks \
  --method POST \
  --field "name=web" \
  --field "config[url]=https://{vercel-url}/api/webhooks/github" \
  --field "config[content_type]=json" \
  --field "config[secret]={webhook_secret}" \
  --field "events[]=pull_request" \
  --field "active=true"
```

---

## 4. Local Development

### 4.1 Running Locally

```bash
cd agents
cp .env.example .env.local  # Fill in values
npm install
npm run dev                  # Starts Next.js on localhost:3000
```

### 4.2 Mastra Dev Server (Optional)

For testing agents in Mastra Studio independently:

```bash
cd agents
npx mastra dev              # Starts Mastra Studio on localhost:4111
```

### 4.3 Local Supabase (Optional)

For offline development without a cloud Supabase project:

```bash
npx supabase init
npx supabase start
# Use the local Supabase URL and keys in .env.local
```

---

## 5. Domain Configuration

### Default

Vercel auto-assigns: `{project-name}.vercel.app`

### Custom Domain

Users can add a custom domain in Vercel settings:
- `agents.mystore.com`
- `marketing.mystore.com`
- `console.mystore.com`

Requires a CNAME record pointing to `cname.vercel-dns.com`.
