# 08 — What runs where: hosted, self-hosted, and the seams between

Written 2026-09-08, after driving Arthaus's September campaigns from plan to
sent. Everything here was learned by watching the path break; the failures are
named because the shape of the system is easiest to see from where it tore.

Arthaus is the awkward case that makes the boundaries legible: it is a
**self-hosted deployment** (its own Vercel project, its own Supabase, its own
git repo) that nonetheless authenticates as the **hosted, productized Shopify
app** and gets its Shopify token from the **platform broker**. If you assume a
deployment is entirely one or the other, you will misdiagnose it. I did.

---

## 1. The three deployables

| | repo | what it is |
|---|---|---|
| **Platform / gate** | `marketing-os-app` | The Shopify app, the tenant registry, the Action gate, Slack. Multi-tenant. Holds the Postgres that records proposals and audit. |
| **Template / pack** | `marketing-os` | Open source. `templates/agents/` is scaffolded into a customer's console; `packages/email-assembly` is the renderer. Nothing runs here. |
| **Console / runtime** | customer's own repo (Arthaus: `Arthaus-Inc/marketplace`, under `agents/`) | The Next.js app the merchant uses. Runs the agent, owns the artifacts, executes Actions. |

The template is a **source**, not a dependency. A console is a *copy* taken at
scaffold time and updated by upgrade PRs. That is why a fix has to be applied
in two places, and why the sync direction matters — see §6.

---

## 2. Where each piece of state lives

Getting this wrong wastes hours, because a missing row looks identical to
broken code.

**Platform Postgres** (`marketing-os-app`)
- `Tenant` — including `agentsUrl`, the URL the gate calls back to. If this is
  wrong or null, approvals silently do nothing.
- `mos_action_proposals` — every proposed Action, its status, its decision.
- `mos_action_audit` — **the outcome and the error text.** This is the only
  place a failed Action explains itself.

**Console's own database** (Arthaus: its own Supabase)
- `mos_email_campaigns`, `mos_calendar_items` — the projection the console UI
  reads. Files remain truth; this is a cache, and it drifts if you edit
  artifacts by hand.
- `mos_email_review_notes` — review-room notes.

**The store's git repo** — the artifacts. `email/strategy.md`,
`email/campaigns/*/campaign.md`. These are truth.

**Klaviyo** — templates, campaigns, segments. External.

> **When an approved Action appears to do nothing, read `mos_action_audit`
> first.** It carried the exact error for three separate failures while I
> theorised about the gate. The gate was never broken.

---

## 3. The Action gate, end to end

```
console: agent calls propose_action
      → POST {MARKETING_OS_API_URL}/api/actions/propose      (ACTIONS_GATE_SECRET)
platform: stores proposal, posts a Slack card
human:    approves in Slack
platform: looks up tenant.agentsUrl
      → POST {agentsUrl}/api/actions/execute                 (ACTIONS_GATE_SECRET)
console:  re-runs preview, compares previewHash, executes
platform: records outcome in mos_action_audit
```

Three things follow from this that are not obvious:

- **`ACTIONS_GATE_SECRET` must match on both sides.** It lives only in Vercel
  env on each. It is not in any `.env` you can read locally, so you cannot
  stand in for the gate by hand.
- **`tenant.agentsUrl` must resolve and serve the console.** Arthaus's is
  `https://arthaus-agents.vercel.app`, while humans use `www.arthaus.cloud`.
  Both serve the same deployment; do not "fix" one to match the other.
- **The console re-verifies `previewHash`.** If the artifact changed between
  proposal and approval, execute refuses. Editing an artifact after proposing
  invalidates the card.

---

## 4. Credentials: which token is actually in play

This is where I was most wrong, so it gets the most space.

`lib/shopify.ts::resolveAccessToken` picks in this order:

1. an explicit token passed by the caller
2. `HOSTED` → the pooled broker token
3. **`MARKETING_OS_API_URL` + `MARKETING_OS_API_KEY` set → the broker token**
4. otherwise → `SHOPIFY_ACCESS_TOKEN` from env

Arthaus sets (3). So **`SHOPIFY_ACCESS_TOKEN` in its `.env.local` is never
used in production** — it is a local fallback belonging to a different Shopify
app entirely (`Pack Digital (Hydrogen)`).

I identified the app by asking that unused token who it belonged to, concluded
Marketing OS was "borrowing the storefront's credential", and widened the wrong
app's scopes on the strength of it. The right question is:

```graphql
{ currentAppInstallation { app { id title } accessScopes { handle } } }
```

asked **through `getShopifyClient()` inside `runWithTenant()`**, so it resolves
the same token production uses.

Second trap: **a deployed app's scopes and an installation's granted scopes are
different things.** `shopify app deploy` changes what the app *requests*; the
existing installation keeps its old grant until someone re-authorizes. Arthaus's
installation was still holding the pre-minimisation set from months earlier.

---

## 5. Hosted vs self-hosted, feature by feature

| capability | hosted | self-hosted (Arthaus) |
|---|---|---|
| Shopify token | pooled broker | **broker too**, if `MARKETING_OS_API_*` set |
| Email pack enabled by | tenant enablement (05 H1.2) | `EMAIL_PACK_ENABLED=1` |
| External MCP (spec 18) | yes | **yes** — was gated on `HOSTED` and shouldn't have been |
| Artifacts | store repo via GitHub App | store repo, `STORE_REPO_MODE=mirror` |
| Action gate | platform | **platform** — self-hosted still proposes to it |
| Console DB | platform | its own Supabase, bootstrapped from `templates/supabase/` |

The pattern: **self-hosted differs in where its data lives, not in what it can
do.** Every place the code branched on `HOSTED` to withhold a *capability* was
a bug. Branching on `HOSTED` for *where to get a credential* is correct.

---

## 6. Applying a change

A fix must land in **three** places or it regresses:

1. the console (`.../agents/…`) — what actually runs,
2. the template (`packages/marketing-os/templates/agents/…`) — what every
   future store inherits,
3. `git push` on both, then `vercel deploy --prod --cwd agents` for the console.

**Copy console → template with care, never blindly.** The template's
`external-mcp.ts` had a *better* implementation than the console's — stateless
HTTP instead of `MCPClient`, written because the SDK client dies against
stateless MCP servers. Blanket-copying the console over it deleted 227 lines of
hard-won work. Check `git diff --numstat` for files where deletions dominate
before committing.

---

## 7. Things that look fine and are not

Each of these shipped, passed review, and failed later.

- **A reference that resolves at write time and never again.** `strategy.md`
  named a `preview-test` segment that no longer existed in Klaviyo; the rule
  guaranteeing a human sees every email pointed at nothing. Same class: audience
  ids, discount codes, image URLs.
- **An API payload verified against the wrong revision.** The client pins
  `2026-07-15`. Probing with `2024-10-15` returns *opposite* answers about the
  same fields. Always probe with `KLAVIYO_REVISION`.
- **`fetch failed`.** undici's message for every DNS and transport error — no
  URL, no cause. One typo'd host (`cdn..shopify.com`) hid behind it through two
  approval cycles. Wrap fetch; name the URL.
- **A degrade that looks like an absence.** "No data" and "could not reach the
  data" must be different verdicts. A missing scope must never render as a
  missing discount.
- **An agent that says it did the thing.** It appended three pieces when asked
  to replace two, and once finished a turn having never called the write tool at
  all. Diff the artifact; do not trust the transcript.

---

## 8. Still open

- **No analytics sync.** `klaviyo_performance_read` is a live read-through;
  nothing persists, so sent-campaign metrics are not in the console. Needs a
  table and a cron over `campaign-values-reports`.
- **No reference sweep.** Nothing revalidates ids in `strategy.md` against
  Klaviyo. §7's first failure will recur.
- **Reachability is not checked at write time.** The 59-image sweep that caught
  `cdn..shopify.com` was run by hand.
- **`shopify.app.public.toml` is not deployed** with the discount scopes.
- **Arthaus's Labor Day artifact reads `drafted` but the campaign is `Sent`** —
  drift from reconciling by hand, because nothing writes back from the ESP.
