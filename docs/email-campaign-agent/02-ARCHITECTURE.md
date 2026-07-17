# Email Campaign Agent — System Architecture

> Companion to 01-PRD.md. This document says **where every piece lives and why**, following the social agent's precedent (spec 24 + `packages/skills/social-media/`) deliberately and exactly: same artifact doctrine, same pack shape, same runtime seams, same Action semantics. Divergences are called out and justified; if you find yourself inventing a new mechanism, check whether spec 24 already answered it.

---

## 0. The four repos and what lands where

| Repo | Role (as-built) | This module adds |
|---|---|---|
| **marketing-os** (this repo — canonical packages + template) | OSS packages (`packages/*`), specs, the scaffolded console template (`packages/marketing-os/templates/agents/`, v0.14.0 shipped) | `packages/skills/email-campaign/` (the pack: artifacts, tools, Actions, instructions); `packages/design-surfaces` multi-board ComposeSpec extension + email compose templates; `packages/email-assembly/` (skeleton+slots HTML assembler — see §4); console calendar/campaign components mirrored into `templates/agents/` for template distribution |
| **marketing-os-hosted-agents** (pooled runtime; **CLI-deployed** to Vercel via `vercel deploy --prod` from a verified checkout — it does NOT auto-deploy from git) | The Mastra agent runtime all hosted tenants share; where packs are enabled/merged today (manually); design-surface tools live here (validated 2026-07-17) | Pack enable + tool wrapping (the `createTool` wrap pattern from the social README); `EmailRepo`/`SocialRepo` binding to the tenant store repo; Klaviyo client calls **through the broker** (never raw keys here); `/api/cron/email` (spec 19 shape); assembled-HTML preview route (like `/api/design-surfaces/export/[fileId]`) |
| **marketing-os-app** (Shopify app / platform / Supabase / Vault / crons) | Credential broker (`/api/broker/token`), Vault, provider connections, tenant provisioning, DB migrations | Klaviyo `provider_connections` type + Vault storage + broker issuance (mirrors GA4/Shopify); OAuth callback route if/when OAuth (WS1); migrations: `mos_email_campaigns`, the shared `mos_calendar_items` index (§6), applying the drafted-but-unapplied `mos_design_surfaces`; Action audit table when spec 20 A0 lands |
| **Store repos** (e.g. Arthaus-Inc/marketplace — receive template→upgrade PRs; console CLI-deployed from `agents/`) | The tenant's console + the canonical artifact home (`agents/brand/`, `social/`) | `email/` artifact tree (§3); console surfaces arrive **only via template→upgrade PRs** (never direct console edits — the spec 22 upgrade-workflow rule); NB: `marketing-os upgrade --yes` is currently not actually non-interactive (REVISIT.md) |

**Rule of thumb (the social precedent):** *capability logic* is an OSS package in marketing-os; *tenant binding and execution* is hosted-agents; *credentials and platform state* are marketing-os-app; *artifacts and the store's own console* are the store repo.

## 1. The pack: `packages/skills/email-campaign/`

Spec 20 §5 shape, byte-for-byte the social pack's conventions (`packages/skills/social-media/` is the reference implementation — read its README and `src/types.ts` first):

```ts
export const metadata = { id: "email-campaign", name: "Email Campaign Agent",
  category: "campaign", version: "0.1.0", author: "Avant-Garde" };
export const requires = { providers: ["klaviyo"], scopes: ["klaviyo:read", "klaviyo:write_campaigns"] };
export const tools = createEmailTools(repo, klaviyo);   // factory — see bindings below
export const actions = [approvePlan, createCampaignDraft, scheduleCampaign, cancelSend];
export const instructions = "…";   // canonical copy in instructions.md, sync-tested
```

Conventions inherited without re-litigation:
- **Plain `SkillToolDefinition` objects, not Mastra tools** — no `@mastra/core` dependency; the hosted runtime wraps at merge time (social README shows the wrap).
- **Factory over bindings.** Two seams instead of social's one: `EmailRepo` (same interface as `SocialRepo` — `readFile`/`writeFile`/`list`; bind to store repo in prod, in-memory map in tests) and `KlaviyoClient` (an interface this pack *defines*; hosted runtime supplies the broker-backed implementation, tests supply a fake). The pack never sees a credential.
- **`actions` ships in the package from day one** (unlike social's SM0 empty array) because the Action contract (spec 20 §2) is a plain interface — but they are **inert until spec 20 A0/A1 exists** in the runtime. State this in the package README.

### Reads (compose freely)

| Tool | What |
|---|---|
| `email_plan_propose` | Deterministic calendar scaffold from `email/strategy.md` (cadence/archetype rotation, the `social_plan_propose` pattern: pure, no clocks, month from input) + semantic-layer/seasonal context woven in; returns structure + ready-to-propose `calendar/{month}.md` markdown; does not write |
| `email_calendar_read` | A month's plan + gap analysis (mirrors `social_calendar_read`) |
| `email_campaign_read` | Parsed campaign.md |
| `klaviyo_audiences_read` | Lists + segments with profile counts (audience selection needs real sizes) |
| `klaviyo_templates_read` | The store's existing templates (id, name, editor type, HTML) — feeds skeleton ingestion (04 §3) |
| `klaviyo_performance_read` | Campaign performance (03 §8 reporting endpoints), normalized |
| `email_render_preview` | Assemble skeleton + current section state + copy → HTML preview URL (read-only; no Klaviyo write) |

### Actions (the gate)

| Action `kind` | What it does | Risk | Undo |
|---|---|---|---|
| `email.approve_plan` | Approves a month calendar proposal; batch-creates campaigns as `approved` | medium | — |
| `klaviyo.create_campaign_draft` | Creates the Klaviyo template (assembled HTML) + campaign + message + audience binding, as a **draft** in Klaviyo. No send scheduled. `preview()` = assembled render + audience estimate | medium | delete draft |
| `klaviyo.schedule_campaign` | Binds a `drafted` campaign to its send time. **Approval = consent to send at T** (spec 24 D2 semantics); the send job fires without a second touch. `preview()` = final render + subject/preview + audience size + time | **high** (full-list blast radius; spec 20 §4: admins + confirmation, optional 2nd approver) | cancel before send |
| `klaviyo.cancel_send` | Cancels/reverts a scheduled send (Klaviyo supports cancel of scheduled campaigns — 03 §4) | low | — |

**Nonce discipline (spec 24 D2, verbatim):** any post-approval change — copy edit, canvas edit after export (spec 23 `edited` flag; polling fallback until webhooks), audience change, time move, *or a skeleton re-ingestion* — invalidates the nonce → status back to `approved`/`drafted` → card re-arms. What was approved is exactly what sends.

## 2. Credential topology (mirrors GA4/Shopify through the broker)

Spec 16's rule — the key follows the tier; chat models are Gemini; **provider credentials live in marketing-os-app's Vault and are issued short-lived by the broker** (`/api/broker/token`, live since spec 12).

```
store owner connects Klaviyo (console settings / onboarding)
  → marketing-os-app: provider_connections row {tenant, provider: "klaviyo", scopes}
  → credential (private key v1 / OAuth token+refresh later) → Vault
  → hosted runtime / cron: broker.token(tenant, "klaviyo") → short-lived credential
  → KlaviyoClient (pack interface) — revision-pinned, rate-limit-aware (03 §9)
```

- **Position — v1: unlisted OAuth app** (verified 03 §1/§10: "your app does not have to be listed to share and use your installation URL" — OAuth without any marketplace review). Authorization code + PKCE; access token ~1h, refresh token until uninstall; marketing-os-app owns the app credentials, the callback route, and refresh — exactly the GA4 shape. Two structural reasons OAuth beats key-paste even for v1: **per-install rate-limit quota** (private keys share the merchant account's quota with every other integration they run — 03 §9) and Klaviyo's active migration pressure toward OAuth for platforms (03 §1). Scopes requested = the pack's `requires`, least-privilege (`accounts:read` + lists/segments/templates/campaigns/metrics read + templates/campaigns write + images write).
- **Bootstrap lane: custom-scoped private API key** paste (Arthaus day one / dev): same Vault row shape with `auth_type: "private_key"`, so the broker seam is identical and swapping Arthaus to OAuth later is a re-connect, not a migration. Marketplace listing (needs ≥5 active installs anyway — 03 §10) is a later commercial decision, not a build gate.
- **Rate limiting is per-account in Klaviyo** — the client implementation (hosted runtime) honors per-endpoint burst/steady budgets and retries on 429 with the returned headers (03 §9). One tenant's usage must never starve another's: budget per tenant, not per process.

## 3. Data model — artifacts in the store repo + DB index (spec 22 D1, mirroring spec 24 §1)

**In the store repo** (`email/` alongside `social/` and `agents/brand/`), all YAML-front-matter markdown, parse/serialize in the pack like `packages/skills/social-media/src/artifacts.ts`:

```
email/
  strategy.md                    # the standing email strategy (co-created from brand.md)
  templates/
    skeletons/{skeleton-id}/
      skeleton.md                #   provenance: which Klaviyo template it came from, when, owner approval
      skeleton.html              #   the sanitized structural frame + named slots (04 §3)
  calendar/{YYYY-MM}.md          # the month's plan: | slot | audience | archetype | intent | campaignId | status |
  campaigns/{id}/
    campaign.md                  # the campaign spec (below)
    assets/                      # design-surface exports (per section) — spec 23 export contract delivers here
    email.html                   # the assembled artifact — exactly what klaviyo.create_campaign_draft uploads
```

- **`strategy.md`** — audience roster (`{key, klaviyoRef(list|segment id), description, cadenceCap}`), campaign archetypes as pillars (`{name, messagingRef → brand.md, weight}` — e.g. new-arrivals, editorial-story, promotion, replenishment), send-day/time preferences, seasonal arcs, guardrails (frequency caps, quiet periods). Versioned + provenance-tagged like brand.md; co-created, never blank-formed.
- **`campaign.md`** front matter: `id, archetype, audience {included[], excluded[]}` (Klaviyo list/segment refs + human names + estimated size at draft time), `subjectCandidates[], subject, previewText, copyFormulaRef, skeletonRef, sections[]` (`{slot, type: "surface"|"html", surfaceId?|html-source}`), `scheduledAt?, utm {campaign, source: "klaviyo", medium: "email"}`, `klaviyo {templateId?, campaignId?, messageId?}`, `provenance[]` (owner/agent/data claims), `status`; body = the agent's rationale prose.
- **Lifecycle:** `proposed → approved → drafted → scheduled → sent → measured` (+ `declined`, `cancelled`, `failed`). vs. spec 24: `drafted` replaces `asset_ready` — the gate-worthy milestone for email is "exists in Klaviyo as a draft", which *requires* assets, so it subsumes it. Assets-ready-but-not-drafted is visible as section state on campaign.md, not a lifecycle stage.

**DB index** — `mos_email_campaigns` (marketing-os-app migration): tenant, campaign id, audience refs, scheduled_at, status, calendar month, design surface id, skeleton ref, action nonce, klaviyo campaign/message/template ids, sent_at, readback rollup. What the console reads, the cron scans, readback joins on. **Rebuildable from files** — the doctrine's test.

## 4. The HTML assembly seam — `packages/email-assembly/`

New OSS package (small, pure, heavily tested — it produces the bytes that land in inboxes): `assembleEmail(skeleton, sections, copy, tokens) → html`. Position, pipeline, and fidelity analysis in **04-DESIGN-SURFACE-PIPELINE.md** (the central design problem — read it in full). Architecturally what matters here:

- It is a **pure function** repo-side: campaign.md + skeleton.html + assets/ fully determine email.html. Deterministic assembly = diffable artifacts = honest nonce hashing.
- It lives in marketing-os (OSS, like design-surfaces), is consumed by the hosted runtime (preview route + the `create_campaign_draft` execute path), and never talks to Klaviyo or Penpot itself.
- Ingestion's sanitizer/slot-extractor (04 §3) lives in the same package — one place owns email-HTML parsing.

## 5. Recurring execution

`/api/cron/email` in hosted-agents (spec 19 shape: idempotent, `CRON_SECRET`-gated, self-limiting):
- **Send watch:** Klaviyo executes scheduled sends itself (the schedule lives in Klaviyo once `klaviyo.schedule_campaign` runs) — so unlike `/api/cron/social`, the email cron does not *execute* sends; it **verifies and reconciles**: confirm scheduled campaigns still exist/valid in Klaviyo, detect out-of-band changes (someone edited in Klaviyo's UI → nonce concern → flag in Slack), mark `sent` when Klaviyo reports it.
- **Readback sweep:** for `sent` campaigns past a maturation window, pull reporting (03 §8), write the rollup, mark `measured`.
- **The rituals (mirroring spec 24 §5):** weekly "this week in email" card; monthly plan proposal seeded with readback. Ride the same cron.

## 6. The shared calendar — the cross-channel abstraction (new; the two-agent forcing function)

Spec 24 §6 gave the console a *social* calendar; this module makes it **the calendar**. Position (needs Garrett sign-off — PRD §8 Q3, and it touches spec 24's unapplied `mos_social_posts` migration, which makes now the cheap moment):

**One generic index, per-channel detail tables.** A `mos_calendar_items` table (or view — implementer's call, table recommended for cron scan cheapness): `{tenant, item_id, channel ("social"|"email"|…), pack_id, scheduled_at, status, month, title, intent, detail_ref (post id | campaign id), surface_id?}`. Pack-specific truth stays in `mos_social_posts` / `mos_email_campaigns` (and ultimately in files); the calendar index is a **projection** both packs write through a shared helper. The console calendar view reads only `mos_calendar_items` and knows nothing about channels beyond rendering chips; click-through resolves `detail_ref` via the owning pack's detail route.

The abstraction (define in a shared package or the template's `lib/`):

```ts
interface CalendarItem {
  channel: string;            // "social" | "email" — opaque to the calendar
  packId: string;
  itemId: string;             // detail_ref into the owning pack
  scheduledAt?: string;       // ISO; absent = planned-but-unscheduled (renders in the month's backlog lane)
  month: string;              // YYYY-MM
  status: string;             // pack lifecycle string; calendar renders chips, doesn't interpret
  title: string; intent: string;
  thumbnailUrl?: string;      // surface export, if any
}
```

**Files stay per-pack** (`social/calendar/`, `email/calendar/`) — merging them into one file would tangle pack ownership and approval scopes for zero user benefit; unification is a *read-side* concern. The console gets channel filter chips; "what's going out this week" spans both.

## 7. Surfaces

- **Slack (primary):** plan cards, campaign approval cards (rendered preview image + audience + time), send confirmations, weekly ritual, recap reports — all spec 17 branded-card plumbing, nothing new.
- **Console:** the shared calendar (§6); campaign detail (subject/preview/copy with provenance chips, section list with thumbnails, "Open canvas" per spec 23 — full-window/share-link until DS4, assembled HTML preview via the hosted preview route, audit trail); Klaviyo connection in settings. All console work ships **template-first** (spec 22 upgrade-workflow rule): build in `packages/marketing-os/templates/agents/`, distribute as upgrade PRs.
- **Email preview rendering:** the hosted runtime serves assembled HTML at a guarded route (brand-image access model, like `/api/design-surfaces/export/[fileId]`); the Slack card renders a screenshot of it (spec 17 resvg/Puppeteer precedent) — decide in WS4 whether Klaviyo's own template-render endpoint (03 §3) is the previewer instead; recommendation: our route (works pre-Klaviyo-write, previews are ungated reads).

## 8. What this module deliberately does NOT build

- No Action framework of its own — spec 20 A0/A1, built once, consumed here (PRD §7).
- No design-tool integration of its own — spec 23 seams only (`composeSurface`/`exportSurface`; the pack never imports Penpot types).
- No email-sending infrastructure — Klaviyo sends; we never touch SMTP.
- No second agent — skill pack in the main agent (spec 24 D4 mirrored).
- No per-tenant Klaviyo apps — one platform credential topology, per-tenant grants.
