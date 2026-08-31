# 07 — Review Links & the Artifact Lane

> Shipped and verified in production against Arthaus, 2026-08-29 → 08-31.
> Companion to `02-ARCHITECTURE.md` (§7 preview) and `spec/26` (the same
> machinery, written for the social pack).

Two capabilities landed together because they answer the same question — *where
does a campaign live, and how does a human see it?*

1. **Review links** — hosted, token-gated surfaces where anyone can review a
   campaign without a console account.
2. **The artifact lane** — campaign artifacts in the store's git repo, with the
   database demoted to a rebuildable index.

---

## 1. Review links

### The three surfaces

| Surface | Path | What it is |
|---|---|---|
| Raw preview | `/api/email/preview/{id}` | The assembled email, nothing around it. What the ESP receives. For iframes and "open full size". |
| Review room | `/review/email/{id}` | The email **with its context** — subject, preview text, send date, rationale, provenance, audience, gate state — plus a desktop/mobile toggle and a notes thread. **This is the link you hand a person.** |
| Contact sheet | `/review/email?month=YYYY-MM` | A month on one page, hero-thumbnailed. One link per planning session instead of five. |

All three are exempt from console auth in both middlewares, alongside
`/brand/` and the design-surface exports.

### The token

`lib/email/review-links.ts` — HMAC-SHA256 over
`email-link:v2:{scope}:{shop}:{id}:{expDay}`, signed with
`ACTIONS_GATE_SECRET ?? CRON_SECRET`, truncated to 32 base64url chars.

- **Scope is signed** (`preview | review | sheet`), so a preview token cannot be
  replayed against the room or the sheet.
- **Expiry is inside the signature** — 30 days by default — so it cannot be
  edited without breaking the token. `verifyLink()` returns
  `ok | expired | invalid`; expired answers **410** with actionable copy, not a
  flat 403 that reads like a bug.
- **Comparison is constant-time.** These tokens are short and an attacker can
  request as many as they like.
- `ttlRemaining()` — a room mints its embedded preview link with the *remaining*
  life of the link that opened it. Otherwise opening a room on its last day
  hands out a fresh 30-day link and the expiry leaks.

There is no legacy path. The previous scheme (HMAC over shop+campaign, valid
until the secret rotated) was cut over completely: honouring unexpiring tokens
"for compatibility" preserves the exact property the expiry exists to remove.

**Mint links through the minting function.** Never string-build a guarded URL —
the console did exactly that and 403'd every embedded iframe in production while
working in dev, where the scheme is off with no secret configured.

### Notes, and why they are not approvals

`mos_email_review_notes` (migration `008`) + `POST /api/email/review-notes` +
MCP tools `email_review_notes` / `email_review_notes_resolve`.

A token proves possession of a link. It does not prove identity. `author` is
whatever the reviewer typed, stored with `source = 'link'`, and every read path
carries that caveat outward rather than laundering it. **A note is a request,
never an authorisation.** Approval keeps its own path — Slack, a real user id, a
row in `mos_action_audit`.

The blast radius of a leaked link is therefore bounded: read the campaign, and
append rows to a notes table a human reads. Nothing touches campaign state.

The note *shape* lives in `review-note-shape.ts`, a module with **no imports at
all**, because `review-notes.ts` reaches `platform-db` → `pg` → `node:net`, and
the thread is a client component. `tsc` erases type-only imports; webpack still
walks the graph.

---

## 2. The artifact lane

`lib/store-repo/` binds the existing `StoreRepo` seam
(`readFile`/`writeFile`/`list`) to the store's GitHub repo.

### Modes — `STORE_REPO_MODE`

| Mode | Truth | Read | Write | On git failure |
|---|---|---|---|---|
| `db` *(default)* | `mos_*_artifacts` | DB | DB | n/a |
| `mirror` | git | git, falls back to DB | git first, then DB | **falls back to the DB** and logs loudly |
| `git` | git | git | git | **fails the write** |

`mirror` exists so a store migrates one artifact at a time under ordinary use,
and rolls back by flipping an env var. Its failure posture differs from `git`
on purpose: a transitional mode strictly more fragile than the `db` it replaces
is one nobody keeps enabled, so the migration never happens. Only when *both*
sides refuse does the caller see an error — reporting a save that went nowhere
is the one outcome worse than failing.

Write order is git-then-DB. If the DB write fails afterwards, truth is still
correct and the cron sweep repairs the index. The reverse leaves the index
claiming an artifact that was never committed.

### Credentials

`lib/store-repo/app-auth.ts` prefers a **GitHub App installation token**, minted
per repo, expiring hourly, narrowed explicitly to
`{ repositories: [name], permissions: { contents: "write" } }` rather than
inheriting an org-wide installation's grant.

`GITHUB_TOKEN` is the **self-hosted fallback only** — one console, one store, one
credential. On the hosted platform a shared PAT would make every tenant's
artifacts writable with the same secret.

**How to tell which path ran:** look at the commit author. The App commits as
`{app-slug}[bot]`; a PAT commits as the token's owner.

### Environment

| Var | Purpose |
|---|---|
| `STORE_REPO_MODE` | `db` \| `mirror` \| `git` |
| `STORE_REPO_PREFIX` | Path prefix inside the repo (Arthaus: `agents`) |
| `GITHUB_REPO` | `owner/name`; per-tenant `Tenant.githubRepo` wins when set |
| `GITHUB_BRANCH` | Defaults to the repo's default branch |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | Preferred auth. PKCS#8 PEM; escaped `\n` tolerated |
| `GITHUB_TOKEN` | Fallback auth |

### Migration runbook

1. `npx tsx scripts/backfill-artifacts-to-git.ts --shop <shop>` — dry run.
   Reports what would be written, what already matches, and any path that
   differs between repo and DB (**conflicts are left alone** — choosing a winner
   would discard whatever an editor changed in the repo).
2. Re-run with `--commit`.
3. Run it a third time. It should report zero writes; that run *is* the
   verification.
4. Set `STORE_REPO_MODE=mirror`, redeploy.
5. Confirm a commit lands and the review surfaces still read.
6. When the repo is complete, `STORE_REPO_MODE=git`.

Identical content is skipped, so re-saving makes no empty commit and history
records real changes.

---

## 3. Self-hosted bootstrap

`templates/supabase/self-hosted-bootstrap.sql` — one idempotent paste creating
everything a console needs: `Account`, `Tenant`, both projections, the Action
gate's tables, design surfaces, skill enablements, provider connections, and
review notes.

It exists because `lib/email/repo.ts` and `lib/social/repo.ts` both
`CREATE TABLE IF NOT EXISTS` on first write and **nothing else does**. A
self-hosted deployment that never ran the platform migrations reaches a
convincing halfway state — artifacts save, previews render, the agent answers —
while every projection-backed surface reads empty and silently degrades. Nothing
errors. It just shows nothing, for months.

Verified by applying it twice into a scratch schema inside a rolled-back
transaction: 10 tables, 29 indexes, 11 FKs, RLS on all 10, identical after the
second pass.

**Seed the `Tenant` row.** `Tenant.shop` must match `SHOPIFY_STORE_URL` exactly,
or `tenantIdForShop()` returns null and every projection read returns `[]` with
no error anywhere.

---

## 4. The failure mode this whole document is about

Every read path in this codebase degrades rather than throws. That is right for
resilience and **catastrophic for diagnosis**: empty is indistinguishable from
broken.

Four separate bugs this week presented identically, as "the page is blank":

- the console reading email campaigns from the *social* artifact table;
- `tenantIdForShop` trusting a context tenant id issued by a different database;
- a self-hosted DB missing every table that doesn't self-create;
- a preview URL built by hand without its token.

None of them logged anything. When adding a read path, log the degrade with its
cause, and distinguish *"no data"* from *"could not reach data"* in the return
type. `github.ts`'s 401/403 handler and `addNote()` returning `null` rather than
swallowing are the two patterns to copy.
