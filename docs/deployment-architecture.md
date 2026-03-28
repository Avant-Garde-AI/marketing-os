# Marketing OS — Deployment Architecture

Marketing OS supports two deployment models. Both use the same codebase.

---

## Multi-Tenant (Managed Cloud)

**You host one instance. Multiple merchants install and use it.**

### Infrastructure

```
┌─────────────────────────────────────────────────────────────┐
│  YOUR INFRASTRUCTURE (Avant-Garde)                          │
│                                                             │
│  Vercel (one deployment)                                    │
│  ├── /shopify     → Mini admin (embedded in Shopify Admin)  │
│  ├── /            → Full dashboard (branded agent fleet UI) │
│  ├── /api/shopify/auth → OAuth install flow                 │
│  └── /api/chat    → Mastra agent endpoints                  │
│                                                             │
│  Supabase (shared project)                                  │
│  ├── shopify_sessions  → per-merchant tokens                │
│  ├── auth.users        → dashboard users (Supabase Auth)    │
│  └── agent data        → memory, skill runs, activity logs  │
│                                                             │
│  Shopify Partner App (one app, your Client ID)              │
│  └── All merchants install this same app via OAuth          │
└─────────────────────────────────────────────────────────────┘
```

### How a merchant onboards (zero terminal, fully automated)

1. Merchant visits your install URL or finds your app in the Shopify App Store
2. Redirected to Shopify consent screen → authorizes scopes
3. OAuth callback stores their token in your Supabase `shopify_sessions` table
4. Merchant is redirected back into Shopify Admin → sees **onboarding wizard**
5. Onboarding wizard:
   - **Connect GitHub** → merchant provides a GitHub token (or uses GitHub OAuth)
   - Cloud pulls their **live theme** via Shopify Admin API (asset endpoints)
   - Creates a **private GitHub repo** (`{store-name}-theme`)
   - Pushes theme files + Marketing OS scaffold (CLAUDE.md, docs/, GitHub Actions)
   - Sets up GitHub Actions secrets for the agent fleet
6. Onboarding complete → mini admin control center appears
7. "Full Dashboard" button opens your branded fleet management UI in a new tab
8. Slack integration connects agents to their workspace

**The merchant never touches a terminal.** The `/api/shopify/onboard` endpoint
handles theme pulling, repo creation, and scaffold pushing entirely server-side
using the Shopify Admin API and GitHub API.

### Auth flow

```
Merchant (in Shopify Admin)
  → iframe loads your Vercel app with ?shop=xxx&host=yyy
  → middleware checks for shopify_shop cookie
  → if missing: redirects to /api/shopify/auth?shop=xxx
  → Shopify consent screen → callback → token stored
  → cookie set → iframe reloads → /shopify mini admin renders

Merchant (in full dashboard, new tab)
  → Supabase Auth login (email/password)
  → middleware checks Supabase session
  → dashboard renders with merchant's Shopify data
  → Shopify token retrieved from shopify_sessions by shop domain
```

### Multi-tenancy

- **shopify_sessions** table keyed by `shop` domain — one row per merchant
- Mastra tools call `resolveShopCredentials(shop)` to get the right token
- Full dashboard ties Supabase Auth user to their shop domain
- Each merchant's agents only see their own store data

### Environment variables

```bash
# Shopify Partner App
SHOPIFY_CLIENT_ID=your-single-client-id
SHOPIFY_CLIENT_SECRET=your-single-secret
SHOPIFY_SCOPES=read_products,write_products,read_orders,...
SHOPIFY_APP_URL=https://marketing-os.yourdomain.com
SHOPIFY_EMBEDDED=true
NEXT_PUBLIC_SHOPIFY_CLIENT_ID=your-single-client-id
NEXT_PUBLIC_SHOPIFY_EMBEDDED=true

# Supabase (your shared project)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Agents
ANTHROPIC_API_KEY=sk-ant-...
```

### Billing

You can integrate Shopify Billing API to charge merchants a monthly fee.
The access token from OAuth has the scopes needed to create recurring charges.

---

## Self-Hosted (Open Source)

**Developer forks/scaffolds their own instance. They own everything.**

### Infrastructure

```
┌─────────────────────────────────────────────────────────────┐
│  DEVELOPER'S INFRASTRUCTURE                                 │
│                                                             │
│  Their Vercel (their own deployment)                        │
│  ├── /shopify     → Mini admin (if they want embedded)      │
│  ├── /            → Full dashboard                          │
│  └── /api/...     → Same routes                             │
│                                                             │
│  Their Supabase (their own project)                         │
│  ├── shopify_sessions  → their store's token                │
│  └── auth.users        → their team members                 │
│                                                             │
│  Their Shopify Partner App (they create their own)          │
│  └── Their own Client ID / Secret                           │
│                                                             │
│  Their GitHub repo                                          │
│  └── Shopify theme + Marketing OS scaffolded in             │
└─────────────────────────────────────────────────────────────┘
```

### How a developer sets up

1. `npx marketing-os init` → CLI scaffolds Next.js app into their theme repo
2. Developer creates a new app in **their own** Shopify Partner Dashboard
3. Sets App URL + redirect URL pointing to their Vercel deployment
4. Copies Client ID / Secret into their `.env`
5. Creates Supabase project, runs the SQL migration for `shopify_sessions`
6. Deploys to Vercel
7. Installs the app on their store → OAuth → token stored in their Supabase
8. Agents now have access to their store data

### Auth flow

Same OAuth + middleware flow as managed, but:
- Uses their own Partner App (their own Client ID)
- Tokens stored in their own Supabase
- Single-tenant — only their store

### Env-var shortcut (no OAuth)

For development/testing, they can skip OAuth entirely:

```bash
SHOPIFY_EMBEDDED=false
SHOPIFY_STORE_URL=mystore.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxx  # if custom apps still available
```

The Mastra tools fall back to these env vars when no Supabase session exists.

---

## Comparison

| Aspect | Multi-Tenant (Managed) | Self-Hosted |
|--------|----------------------|-------------|
| **Who hosts** | You (Avant-Garde) | The developer |
| **Vercel project** | One, shared | Their own |
| **Supabase project** | One, shared | Their own |
| **Partner App** | Your app (one Client ID) | Their app (their Client ID) |
| **OAuth** | Required | Required (or env-var fallback) |
| **Embedded in Shopify** | Yes (mini admin) | Optional |
| **Full dashboard** | Your branded URL | Their own URL |
| **Slack integration** | Per-merchant workspace | Their workspace |
| **GitHub theme repo** | Per-merchant repo | Their repo |
| **Billing** | Shopify Billing API | N/A (they run it) |
| **Updates** | You deploy, all merchants get it | They pull from upstream |
| **Supabase table** | `shopify_sessions` (many rows) | `shopify_sessions` (one row) |

---

## Surfaces

Both models serve three surfaces:

| Surface | Where | Purpose |
|---------|-------|---------|
| **Slack** | Merchant's Slack workspace | Primary daily interface — chat with agents, approvals, digests |
| **Shopify Mini Admin** | Embedded in Shopify Admin | Glanceable status, quick actions, link to dashboard |
| **Full Dashboard** | Standalone branded URL | Agent fleet management, skill config, history, multi-tenant admin |
