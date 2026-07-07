# 11 — Hosted Path (Platform-Owned Deployment)

> Marketing OS · Open Conjecture · July 2026
> Status: **BUILT & LIVE-VERIFIED (2026-07-05→07) — all phases H1–H5.**
> H1 front door (listing items in `marketing-os-app/docs/LISTING-READINESS.md`) ·
> H2 pooled runtime + embedded native console (per-request tenancy, 2-tenant isolation
> verified) · H3 reconcile + draft-theme review loop (live storefront previews; 3 real
> theme swaps caught by the D2 guard) · H4 job runner + sandboxed Claude Code executor
> (chunked steps, stale-lease reclaim, budget metering; design-loop = command #2 next) ·
> H5 eject (canonical flip / repo transfer / pg_dump / credential mint, verified on a
> demo tenant). Tenant mirrors live in GitHub org **Marketing-OS-Sites** under the
> **marketing-os-platform** GitHub App identity (App ID 4231174).
> **As-built operational reference: `marketing-os-app/docs/PLATFORM.md`.** Remaining:
> human click-pass, App Store submission, per-tenant hosted chat memory.
> Original spec below, decisions unchanged (D1/D2/D3 all held in production).

---

## 1. Purpose & Positioning

Marketing OS ships two deployment paths:

| Path | Who owns infra | Who it's for | Status |
|------|----------------|--------------|--------|
| **Client-owned** (`npx marketing-os`) | Store: GitHub + Vercel + Supabase + Shopify | Agencies, technical merchants, enterprise/data-residency | ✅ Tested end-to-end |
| **Hosted** (this spec) | Platform: git + compute + state + broker | Everyone else — **the default** | 🔨 To build |

The hosted path is not "the same install, we run the infra." It **inverts the ownership boundary**: the store's entire ask is a Shopify OAuth grant. The platform owns git, compute, state, and credentials. The client-owned path remains as the **eject/graduation tier** (§8) — "hosted by default, own it when you outgrow us."

```
CLIENT-OWNED (today)                    HOSTED (default)
Store: GitHub repo + Vercel +           Store: Shopify store + OAuth grant.
       Supabase + Shopify                      That's the entire ask.
Platform: credential broker (opt-in)    Platform: git + compute + state +
                                                  broker + review UI
```

---

## 2. Committed Decisions

These three forks shape everything downstream. Defaults are committed; each records the alternative and the condition under which we'd revisit.

### D1 — Review surface: **Shopify draft themes, git underneath**
Agent-proposed theme changes are applied to a Shopify **draft theme** the merchant previews live in their own storefront. "Approve" publishes the draft and merges the corresponding git branch. Git provides diff, history, blame, and one-click revert — the merchant never sees GitHub.
*Alternative:* surface real PR diffs in the console. Revisit as an optional "technical mode" toggle for agencies; never as the merchant default.

### D2 — Source of truth (hosted): **Shopify-canonical, git as mirror + staging**
Merchants can and will edit their theme in Shopify's own editor. A reconcile job (theme-publish webhook + periodic sweep) pulls merchant edits back into git **before any agent proposal branches**, so agents always branch from current reality and never clobber a merchant edit.
Note the deliberate inversion: **client-owned is git-canonical; hosted is Shopify-canonical.** This is the cleanest seam between the two paths.
*Alternative:* git-canonical + lock the Shopify editor. Rejected — fighting merchant behavior loses.

### D3 — Console home: **embedded in Shopify admin (App Bridge)**
The console loads inside Shopify admin via the Shopify App. Session token → tenant resolution gives auth for free and the App Store becomes the acquisition funnel. A standalone domain can follow later for deep-work surfaces; embedded is the front door.
*Alternative:* standalone hosted app first. Rejected — weaker funnel, we'd rebuild auth Shopify gives us.

---

## 3. Architecture

```
┌───────────────────────────── PLATFORM ─────────────────────────────┐
│                                                                     │
│  Shopify App (front door)                                           │
│   • OAuth: read_themes/write_themes + data scopes                   │
│   • Embedded console (App Bridge, session token → tenant_id)        │
│                                                                     │
│  Pooled Agents Deployment (one Vercel project, all tenants)         │
│   • Existing Mastra runtime; tenant_id resolved PER REQUEST         │
│     from session — never implied by the deployment                  │
│                                                                     │
│  Shared Postgres — schema-per-tenant                                │
│   • tenant_<shop>.mastra_threads / _messages / … (fixed Mastra      │
│     table names, per-request search_path)                           │
│                                                                     │
│  Credential Broker (mandatory in hosted)                            │
│   • Existing /api/broker/token + /api/tenants, deployed live        │
│   • Per-tenant vaulted Shopify/GA4 tokens, short-lived issuance     │
│                                                                     │
│  Git-on-Demand (platform GitHub org: mos-tenants/<shop>)            │
│   • Provisioner: snapshot live theme → main on install              │
│   • Reconcile job: Shopify → git on theme-publish webhook + sweep   │
│                                                                     │
│  Async Job Runner (replaces store-owned GitHub Actions)             │
│   • Queue + worker (Vercel Sandbox or container) running            │
│     Claude Code / design-loop against mos-tenants/<shop>            │
│   • Output feeds the draft-theme review loop                        │
└─────────────────────────────────────────────────────────────────────┘
┌────────────────────────────── STORE ───────────────────────────────┐
│  Shopify store + OAuth grant. No Vercel, Supabase, GitHub, or CLI.  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.1 Compute & tenancy — pooled, not per-tenant-provisioned
One pooled Next.js/Mastra deployment on the platform Vercel account. No per-tenant Vercel or Supabase projects: provisioning latency and project sprawl kill onboarding and ops. Tenant identity moves from "implied by the deployment" (client-owned) to "resolved from the request" (hosted). Physical isolation is not lost — it's sold, via eject (§8).

### 3.2 State — schema-per-tenant on shared Postgres
Chosen over `tenant_id`-column + RLS because:
- Maps onto Mastra's **fixed table names** without patching `@mastra/pg` (set `search_path` per request).
- Cross-tenant leakage becomes structurally hard, not one-missing-WHERE-clause away.
- Eject is trivial: `pg_dump --schema=tenant_<shop>` is the customer's complete dataset.

Scales to low-thousands of tenants; whales graduate to dedicated DBs via the eject/enterprise tier.

### 3.3 Git-on-demand — git as engine, invisible to the merchant
On install: platform creates private repo `mos-tenants/<shop>`, pulls the live theme via the Admin Theme Asset API, commits as the `main` snapshot. The review loop:

```
agent proposes change
  → branch in mos-tenants/<shop>            (diff, history, revert live here)
  → change applied to a Shopify DRAFT theme (Admin API)
  → merchant previews the draft live in their own storefront
  → Approve = publish draft + merge branch
  → git records the published state
```

"Connect your own GitHub" is an eject affordance, not an onboarding requirement.

### 3.4 Async write path — platform job runner
Client-owned runs Claude Code on the **store's** GitHub Actions; hosted has no store GHA. Replacement: platform queue + worker executing Claude Code / `packages/design-loop` against the platform-owned repo, emitting draft-theme proposals. **This is the largest net-new infrastructure component** and is scoped as its own phase (H4).

### 3.5 Onboarding flow (target experience)
```
Merchant installs "Marketing OS" from Shopify App Store
  → OAuth (theme + data scopes) → platform mints tenant_id
  → broker vaults Shopify/GA4 tokens for this tenant
  → platform creates mos-tenants/<shop>, snapshots live theme into git
  → tenant schema provisioned in shared Postgres
  → embedded console loads inside Shopify admin
  → merchant is live. No Vercel, no Supabase, no GitHub, no CLI.
```
Target: **install → live console in under 2 minutes**, no infra provisioned in the loop.

---

## 4. Reuse vs. Build

| Piece | Status | Notes |
|---|---|---|
| Credential broker, per-tenant keys, `link` (`src/commands/link.ts`, `templates/agents/lib/ga4.ts`, `lib/shopify.ts`) | **Exists** | Deploy live; make mandatory in hosted |
| Semantic layer + GA4/Shopify connectors (`templates/agents/src/mastra/semantics/`) | **Exists** | Already broker-based; ~no change |
| Mastra agents/tools/skills (`templates/agents/src/mastra/`) | **Exists** | Make `tenant_id` request-resolved |
| Shopify App: OAuth, embedded admin (App Bridge), tenant registry, live broker, App Proxy, GDPR compliance webhooks | **Exists** — sibling repo `marketing-os-app` (`Avant-Garde-AI/marketing-os-app`) | Most of H1 is already built and live at avant-garde-marketing-os.vercel.app; Arthaus runs through it as a normal tenant |
| Pooled deployment + schema-per-tenant routing | **Build** | H2 |
| Draft-theme review loop | **Build** | H3 — extends `marketing-os-app` |
| Git-on-demand provisioner + reconcile job | **Build** | H3 |
| Platform async job runner | **Build** | H4 — largest net-new piece |

> **Repo of record:** the hosted platform (Shopify app, broker, router) lives in the sibling repo `marketing-os-app`, not this monorepo. This repo owns the CLI, `templates/agents/` (the client side of every platform contract), and specs.
> **H1 execution plan:** `marketing-os-app/docs/LISTING-READINESS.md` — task-level work plan (tenant purge, privacy policy, review-readiness checks, listing collateral) with hard constraints protecting the live Arthaus tenant and cross-repo API contracts.

---

## 5. Build Phases

Sizing is relative (S/M/L ≈ days / ~1 wk / 2+ wks focused work).

| Phase | Deliverable | Size | Depends on |
|---|---|---|---|
| **H1 — Front door** | ~~Shopify app, tenant registry, broker~~ **largely exists in `marketing-os-app`.** Remaining: listing readiness — GDPR compliance webhooks (done 2026-07), Billing API or managed pricing, protected-customer-data approval for `read_orders`/`read_customers`, privacy policy URL, listing assets, App Store submission | **S–M** | — |
| **H2 — Pooled runtime** | Agents app runs multi-tenant on platform Vercel; per-request tenant resolution; schema-per-tenant Postgres + search_path routing; embedded console renders in Shopify admin | **L** | H1 |
| **H3 — Git-on-demand + review loop** | Repo provisioner (`mos-tenants/<shop>` + theme snapshot); Shopify→git reconcile (webhook + sweep); draft-theme apply/preview/approve/publish loop | **L** | H1 (H2 only for the approve UI) |
| **H4 — Async job runner** | Queue + worker running Claude Code / design-loop against platform repos, feeding H3's review loop | **L** | H3 |
| **H5 — Eject** | Repo transfer to customer org; `pg_dump` schema → their Supabase; reverse-`link` to their Vercel/tokens | **M** | H2, H3 |

**Critical path: H1 → H2.** H3 can start in parallel with H2 after H1 lands (it needs OAuth tokens and the tenant registry, not the pooled runtime). H4 is the long pole and gated on H3. H5 is deliberately last — but eject *design constraints* (schema-per-tenant, platform-org repos, broker indirection) are baked into H2/H3 from day one, which is what keeps H5 an M and not a rewrite.

**Read-only hosted milestone (end of H2):** chat, analytics, semantic-layer queries, reports — no theme writes. This is shippable to design partners before H3/H4 exist.

---

## 6. Two-Path Invariants

Rules that keep client-owned and hosted from diverging into two products:

1. **One template tree.** `templates/agents/` is the single source for both paths; hosted-specific behavior is config/env-driven (`MARKETING_OS_MODE=hosted`), never a fork.
2. **Broker is the only credential seam.** Client-owned may hold its own tokens; hosted must use the broker. No third pattern.
3. **Git is always the change ledger.** Both paths record every storefront change as commits; only *who owns the remote* and *what is canonical* (D2) differ.
4. **Skills/tools are tenancy-agnostic.** A skill never knows which path it runs in; tenancy is resolved by the runtime.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Theme drift / clobbering merchant edits | D2: Shopify-canonical + reconcile-before-branch; never generate a proposal from a stale snapshot |
| Cross-tenant leakage in pooled runtime | Schema-per-tenant (structural), per-request search_path set in one middleware chokepoint, no raw cross-schema queries |
| Shopify App Store review latency (weeks) | Submit a minimal app at end of H1; iterate console behind it |
| Mastra `@mastra/pg` assumptions about single schema | Spike in H2 week 1: verify search_path routing under connection pooling before committing |
| Job runner cost/isolation (Claude Code per tenant) | Per-tenant queue caps + budget metering from day one; Vercel Sandbox first, containers if needed |

---

## 8. Eject Path (Graduation Tier)

Eject is a product feature, not a migration project:

1. **Repo** — transfer `mos-tenants/<shop>` to the customer's GitHub org; flip to client-owned theme sync (git-canonical).
2. **Data** — `pg_dump --schema=tenant_<shop>` → restore into customer Supabase.
3. **Compute** — `npx marketing-os link` in reverse: their Vercel deploy, their env, broker optional.

The narrative: **"Hosted by default. Own it when you outgrow us."**
