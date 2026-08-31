# 26 — Social Media Agent: Aligning the Pack with the Proven Artifact + Review Loop

> **Status:** TRD — binding on the social pack's next build increment. Sections marked **⟨BUILD⟩** are the pack team's work; everything else is inherited and must not be reimplemented.
> **Depends on:** 20-CAPABILITY-SUITE (writes are Actions), 22-BRAND-SOUL (files are truth), 24-SOCIAL-MEDIA-AGENT (the pack's own spec), 25-COMPOSABLE-BLOCKS (§7 pack-owned schemas, §6 storage split).
> **Proven on:** the Email Campaign Agent, end to end against Arthaus, 2026-08-29 → 08-31.
> **First target:** Arthaus. **Written:** 2026-08-31.

---

## 0. The loop we proved

Build in a Claude Code session or the console → the agent writes an artifact to the store repo → it mints a **hosted review link** → teammates who have never opened the console review it and leave notes → the agent reads those notes back **through MCP** and revises → final approval happens **in Slack**.

That loop is live for email. Every part of it except the review room itself is channel-agnostic, and the social pack is already sitting on the storage half of it (`lib/social/repo.ts` routes through `resolveStoreRepo`). This document says what to inherit, what to build, and which seven failure modes to design against — all seven are real bugs found this week, not hypotheticals.

### 0.1 Why approval cannot happen on the review link

A review link carries an HMAC over `(scope, shop, id, expDay)` — `lib/email/review-links.ts`, signed with `ACTIONS_GATE_SECRET ?? CRON_SECRET`, 30-day default TTL, expiry *inside* the signature so it cannot be edited without breaking it. Scope is one of `preview | review | sheet` and is signed, so a preview token cannot be replayed against the room.

**A token proves possession of a link. It does not prove identity.** Anyone holding the URL is "someone with the URL" and nothing more. There is therefore no honest way for the review surface to produce an approver record, and it is not allowed to try. `ReviewNote.author` is self-declared free text, stored with `source = 'link'`, and every read path — the DB layer, the MCP tool description, the rendered thread — repeats that a note is *a request, never an authorisation*.

Approval lives in Slack because a Slack interaction carries a real user id, which becomes the `actor` column on `mos_action_audit` alongside `preview_hash`, `params`, and `outcome`. That is an audit row you can defend. The review room shows approval *state* and stops.

The one write a review link may make is `POST /api/email/review-notes`: it re-verifies the `review`-scoped token, caps the body at `MAX_NOTE_LENGTH` (4000), appends a row, and touches no campaign state. Blast radius of a leaked link: read the artifact, add rows to a notes table a human reads. Bounded on purpose.

---

## 1. Artifacts belong in git; the DB is a rebuildable index

`lib/store-repo/index.ts` exposes a three-way `STORE_REPO_MODE`:

| Mode | Truth | Read | Write | Failure posture |
|---|---|---|---|---|
| `db` (default) | `mos_*_artifacts` | DB | DB | unchanged from before |
| `mirror` | git, DB kept in step | git, **falls back to DB** | git first, **then** DB | git failure → DB write + loud `console.error`; only when *both* refuse does the caller see an error |
| `git` | git | git | git | a failed commit **fails the write** — there is nowhere else for truth to live |

Write order is deliberate: git first. If the DB write fails afterwards, truth is still correct and the cron sweep rebuilds the index. The reverse order leaves the index claiming an artifact that was never committed — the index lying about truth is the worse failure and the harder one to notice.

The git binding is `lib/store-repo/github.ts` — the GitHub **contents API** for `readFile`/`writeFile` (read-through for the current `sha`, identical content skipped so history records real changes) and the **trees API** (`?recursive=1`) for `list`, because walking `contents/` per directory is one request per post. `assertSafePath` rejects `..`, leading `/`, and control characters: the agent chooses these path strings, so they are untrusted input. A truncated tree warns rather than silently returning a short list.

Credentials: `lib/store-repo/app-auth.ts` mints a **GitHub App installation token per repo**, narrowed explicitly to `{ repositories: [name], permissions: { contents: "write" } }`, cached with a 5-minute expiry skew. `GITHUB_TOKEN` is the self-hosted fallback only — one console, one store, one credential. A shared PAT on the hosted platform would make every tenant's artifacts writable with one secret.

**Social's artifact paths, verified in `lib/social/artifacts.ts`:**

| Constant / helper | Path |
|---|---|
| `STRATEGY_PATH` | `social/strategy.md` |
| `calendarPath(month)` | `social/calendar/{YYYY-MM}.md` (month regex-validated) |
| `postPath(id)` | `social/posts/{id}/post.md` (id must match `[A-Za-z0-9._-]+`) |

Same physical format as `brand.md`: YAML front matter + markdown body, zod-validated, with a `parse(serialize(x)) === x` round-trip guarantee.

Migration path: run `npx tsx scripts/backfill-artifacts-to-git.ts --shop <shop> --prefix social/` (dry run by default; `--commit` to write; conflicts are *reported*, never overwritten), then flip `STORE_REPO_MODE=mirror`. Rollback is one env var.

---

## 2. Inherit vs. build

### Inherit — do not reimplement

- **The StoreRepo lane.** `lib/skill-kit/repo.ts` defines the three-method seam; `socialRepo` in `lib/social/repo.ts` already resolves the lane **per call** (mode and `githubRepo` are request-scoped; a binding frozen at import pins every tenant to whichever warmed the lambda). Read through `socialRepo`, never through the free `readSocialFile`/`listSocialFiles` — those query `mos_social_artifacts` directly and are blind to the mode.
- **The token scheme.** Same construction, same signed scope, same `ttlRemaining()` discipline: a room opened on its last day must mint its embedded preview link with the *remaining* life, or the expiry leaks.
- **The Action gate.** `mos_action_proposals` → nonce + `preview_hash` → Slack card → `mos_action_audit`. `social.schedule_post`, `social.publish_post`, `social.cancel_post` are built (`lib/social/actions.ts`); `/api/cron/social` re-verifies consent against current file state plus the bound surface's `revn` before publishing.
- **The calendar contract.** `mos_calendar_items` stays platform-owned in `public`; packs write through `upsertCalendarItem` (`lib/calendar.ts`) and the console reads through `lib/calendar/console-data.ts`, which treats `channel` and `status` as **opaque** strings. `lib/calendar/routes.ts` already maps `social → /social/posts/{id}`.

### Build ⟨BUILD⟩

1. **The social index-sync.** Today **only `lib/email/index-sync.ts` calls `upsertCalendarItem`.** Nothing in the social pack writes the projection, and `mos_social_posts` (spec 24 §1) **does not exist in any repo** — not in the template, not in the Arthaus console, not in `self-hosted-bootstrap.sql`. This is not inherited; it is missing.
2. **A social review room.** A post is not an email. It needs multi-platform variants side by side, correct aspect ratios per platform, per-platform scheduled times, and the caption in the platform's own type treatment. `/review/social/[id]` and a month sheet at `/review/social`.
3. **Notes for social.** The email implementation is email-scoped throughout: table `mos_email_review_notes` keyed on `campaign_id`, route `/api/email/review-notes`, tools `email_review_notes` / `email_review_notes_resolve`. Either generalise to `(pack_id, item_id)` or clone the pattern. **Copy the module split**: the note *shape* lives in an import-free module (`review-note-shape.ts`) because the thread is a client component and the DB module pulls in `pg`.
4. **A social thumbnail rule.** `lib/email/hero.ts` walks email sections/blocks for the first `https?://` image. Social's equivalent is the bound Design Surface export, and it must be a *durable* URL — composed imagery URLs are signed and expire in 24h.
5. **Middleware allowlist entries.** `middleware.ts` exempts `/review/` (so `/review/social/…` is already public-by-token) but **not** `/api/social/review-notes` or any social preview route. Add them, with the same in-route verification.
6. **The pack's own schema** (§3).

---

## 3. Pack-owned schemas

Per spec 25 §7 and **D4**: first-party packs may run DDL at enablement; a third-party ecosystem must **declare-and-review**. The social pack is first-party, so it ships migrations applied at enablement — but it must be written as though it were third-party, because the boundary is what makes the ecosystem possible.

- **Namespaced schema per pack**: `pack_social`, not more prefixed tables in `public`. Clean ownership, trivial teardown, collision-free.
- **Cross-pack contracts stay platform-owned in `public`**: `mos_calendar_items` is the published contract every channel writes through; `mos_action_proposals` / `mos_action_audit` likewise.
- **Tenant isolation stays `tenant_id` + RLS.** Per-tenant schemas do not scale.
- Enablement is recorded in `mos_skill_enablements` (`tenant_id, pack_id, version, enabled, config`) — the migration runner keys off the same row.

---

## 4. Hosted vs. self-hosted

| Concern | Where | Why |
|---|---|---|
| Shopify app install / OAuth / webhooks / billing | **always hosted** | one app listing, one partner account |
| Tenant identity + registry (`Tenant.agentsUrl`, `mcpSubdomainStatus`) | **always hosted** | this *is* the routing table |
| Connector tokens + verification (`POST /api/connector/verify`) | **always hosted** | revocation must propagate globally (60s cache) |
| Credential broker (`POST /api/broker/token`) | **always hosted** | Vault governance; `MARKETING_OS_DEPLOYMENT_KEY` client-owned, `MOS_PLATFORM_SERVICE_KEY` + `x-mos-tenant-shop` pooled |
| MCP router, pack registry / versions / upgrade channel | **always hosted** | one place a store's capabilities are described |
| Agent runtime, projections, render + review surfaces | **deployment-local** | pooled runtime or the store's own console |
| The artifacts | **repo-owned** | diffable, revertible, survives a DB restore |

**Consequence for social:** publish tokens must resolve through the broker (`brokerTokenSource`), not from `SOCIAL_IG_ACCESS_TOKEN` env vars. Those exist as a staging convenience and are not the model.

---

## 5. Seven failure modes to design against

1. **The console read email campaigns from `mos_social_artifacts`** while email artifacts lived in `mos_email_artifacts`. The lookup could never hit; it degraded to empty; nothing errored. Every campaign detail page and review room said "no campaign lives here" while the preview URL for the same id served the email perfectly. → **One artifact store per pack, one read path per pack.**
2. **`email_campaign_upsert` wrote the artifact but never synced the index.** Campaigns rendered perfectly at their preview URL and appeared nowhere in the console or the calendar. → **Write through to the projection at the write.** The cron sweep is the backstop, not the mechanism.
3. **`tenantIdForShop` trusted a context tenant id blindly.** Correct hosted; wrong self-hosted, where that id comes from the platform's token verification — a *different database*. Reads queried a tenant that does not exist locally and returned `[]`. Writes were fine, because `index-sync` resolves by shop. Data saved correctly and read back empty. → **Verify a context id against the local `"Tenant"` table once, then fall back to the shop lookup.**
4. **A self-hosted DB had only the two tables that `CREATE TABLE IF NOT EXISTS` on first write.** Everything else was missing; every projection-backed surface read empty, with no error, for months. `templates/supabase/self-hosted-bootstrap.sql` closes this in one paste — **and does not yet contain a social index table.**
5. **The preview route required an HMAC token; the console hand-built its preview URL** with no `shop` and no token. Every embedded iframe 403'd in production while working in dev, where `verifyLink` returns `"ok"` with no secret configured. → **Mint links through the minting function. Never string-build a guarded URL.**
6. **A client component imported a type from a module that imports `pg`.** `tsc` erases type-only imports; webpack still walks the graph, and the build failed on `node:net`. → **Contracts shared with client components live in modules with no imports at all.**
7. **Flipping to `mirror` with a read-only token failed every write**, taking authoring down, because git-first failed hard. → **A transitional mode must not be more fragile than what it replaces.**

**The unifying lesson.** Every read path in this codebase degrades rather than throws. That is right for resilience and catastrophic for diagnosis: **empty is indistinguishable from broken.** Bugs 1, 3, 4 and 5 all presented as "the page is blank." The pack must therefore (a) log every degrade with the pack tag and the cause, and (b) distinguish *"no data"* from *"could not reach data"* in every return type the UI or an MCP tool consumes — the `github.ts` 401/403 handler and `addNote()` returning `null` rather than swallowing are the two patterns to copy.

---

## 6. Acceptance criteria

1. **Round-trip.** With `STORE_REPO_MODE=git`, `social_post_upsert` writes `social/posts/{id}/post.md`, a commit appears in the store repo, and `socialRepo.readFile` returns byte-identical content on a cold process. `list("social/posts/")` finds it via the trees API.
2. **Backfill.** `backfill-artifacts-to-git.ts --prefix social/` dry-runs clean, commits once, and a second run makes **zero** commits.
3. **Review link.** A minted `review`-scoped link renders the post with its variants and per-platform times for someone with no console account. A `preview`-scoped token against the same URL returns 403; an expired token returns **410** with actionable copy, not a flat 403.
4. **Notes.** A note left on the link is readable in-session via the social equivalent of `email_review_notes`, carries its "self-declared author / not an approval" caveat, and disappears from the open worklist after `…_resolve`. A note that cannot be persisted returns an error to the reviewer — never a silent success.
5. **Calendar.** The post appears in `mos_calendar_items` with `channel = "social"`, correct `month`, a durable `thumbnail_url`, and click-through to `/social/posts/{id}` — written **at the authoring write**, verified before any cron runs.
6. **Approval.** No status advances past `approved` from any surface but Slack; the resulting `mos_action_audit` row carries a real Slack user id in `actor`.
7. **Nothing publishes without an approved Action.** A copy edit, a time move, or a canvas `revn` bump after approval drops the post to `asset_ready` and the cron publishes nothing.
8. **Self-hosted parity.** On a fresh bootstrap DB with the social tables present, all of the above passes; with them absent, every surface *logs* the missing relation rather than rendering silently empty.

---

## 7. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Notes: generalise `mos_email_review_notes` to `(pack_id, item_id)` vs. a `pack_social` table | **Generalise.** Two clones is where a third becomes inevitable; the shape is already channel-neutral apart from the column name. |
| D2 | Social index table: build `mos_social_posts` (spec 24 §1) or project straight into `mos_calendar_items` | **Both, minimally**: `pack_social.posts` for pack-private state (platform id, permalink, nonce), `mos_calendar_items` for the shared view. Do not overload the calendar with pack state. |
| D3 | Review-room unit: one post, or a post *group* across platforms | **Group.** Variants are reviewed together or the register drift the pack exists to catch is invisible. |
| D4 | Social thumbnail source | The bound Design Surface export, **re-hosted durably**. Never a 24h signed compose URL. |
| D5 | `social.approve_plan` — specced in 24 §4, **not implemented** | Build it. Without it, a month's plan is approved post-by-post, which is the ritual the calendar was meant to replace. |
| D6 | Pack DDL trust boundary (spec 25 D4) | First-party: DDL at enablement, `pack_social` schema. Ship the migration **declaratively** now so the ecosystem path is a runner change, not a rewrite. |
| D7 | Does the month sheet get a per-post note affordance, or notes only in the room? | Sheet gets counts (the `countNotes` one-query pattern); composing a note stays in the room. |
| D8 | Do review notes on a `scheduled` post invalidate the nonce? | **No** — a note is a request, and auto-invalidating would let anyone with a link cancel a publish. Surface the open-note count on the card and let the human decide. |
