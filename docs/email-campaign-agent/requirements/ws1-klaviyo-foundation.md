# WS1 — Klaviyo Foundation

> **Objective:** a store connects its Klaviyo account through the platform's credential governance, and the platform can read (audiences, templates, performance) and write (templates, campaigns, send jobs) against a revision-pinned, rate-limit-aware client — with the store's reference templates fetched and ready for WS2's skeleton extraction.
>
> **Grounding docs:** 03-KLAVIYO-PLATFORM.md (all facts + §12 uncertainties), 02-ARCHITECTURE.md §2 (topology). Precedents to mirror: GA4/Shopify connection flow in marketing-os-app (Vault + `provider_connections` + `/api/broker/token` — spec 12's broker, live).

## In scope
Auth (OAuth app + private-key bootstrap lane), Vault/broker integration, the `KlaviyoClient` adapter, audience + template + reporting reads, per-tenant connect flow (API side), conversion-metric resolution. Fetch side of reference-template ingestion (extraction itself is WS2).

## Out of scope
Any Klaviyo write Action semantics (WS3), skeleton extraction/sanitization (WS2), console connect UI polish (WS4 — a minimal settings form ships here), segments creation, flows, SMS.

---

## WS1-R1 — Klaviyo provider type + Vault storage *(marketing-os-app)*

Add `klaviyo` to the provider-connections model with two auth lanes behind one row shape: `{tenant, provider: "klaviyo", auth_type: "oauth" | "private_key", scopes[], status, metadata {account_id, conversion_metric_id?}}`; secrets (key, or token+refresh pair) in Vault, never in the row.

**Acceptance:**
- A tenant row + Vault secret can be created for both lanes; secrets never appear in logs or API responses.
- Disconnect revokes (OAuth revoke endpoint — 03 §1) and tombstones the row; broker issuance fails closed afterward.
- Pack enablement gating (05 H1.2) can query connection liveness.

**Targets:** marketing-os-app — the provider-connections module + migration (follow the GA4 provider's file layout); Vault helpers.

## WS1-R2 — OAuth flow (unlisted app) + private-key bootstrap *(marketing-os-app)*

Implement the authorization-code+PKCE flow against Klaviyo (03 §1: authorize on www.klaviyo.com, token/revoke on a.klaviyo.com; access ~1h, refresh until uninstall, ≤10 refresh/min/install), storing tokens per WS1-R1. Scopes: exactly the pack's `requires` set (02 §2), `accounts:read` included. Private-key lane: a paste field validated by a live `GET /api/accounts` probe before storing.

**Acceptance:**
- Full OAuth round-trip against a real Klaviyo test account: connect → tokens vaulted → API call succeeds → forced 401 triggers refresh → revoke on disconnect.
- Refresh is single-flight per tenant (no thundering herd on the 10/min budget).
- The Klaviyo app itself (client id/secret) is platform config, documented in the app repo's env reference.
- Arthaus connected via whichever lane Garrett picked (PRD §8 Q1).

**Dependencies:** Garrett creates the Klaviyo OAuth app (external, day 1).
**Open question:** OAuth callback host — marketing-os-app is the natural owner (it owns every other provider callback); confirm no need for per-tenant redirect URIs (Klaviyo apps take a fixed redirect list).

## WS1-R3 — `KlaviyoClient` adapter *(hosted-agents `lib/`, interface defined in the pack)*

The pack defines the `KlaviyoClient` interface (02 §1); hosted-agents implements it: broker-issued credentials, `revision: 2026-07-15` pinned, JSON:API envelope handling (cursor pagination, sparse fieldsets), and rate-limit discipline — honor `Retry-After` on 429, exponential backoff + jitter, per-tenant budget so one tenant can't starve another (03 §9).

**Acceptance:**
- Interface methods for MVP: `listAudiences` (lists+segments with profile counts), `listTemplates`/`getTemplate` (with HTML), `createTemplate(CODE html)`, `renderTemplate`, `createCampaign`, `assignTemplate`, `createSendJob`/`getSendJob`/`cancelSendJob`, `estimateRecipients`, `campaignValuesReport`, `listMetrics`, `uploadImage(file)`.
- A recorded-fixture test suite (no live calls in CI) + one live smoke script (the design-surfaces `verify-*` script pattern) run against the Arthaus account.
- Per-endpoint rate tiers captured from live reference pages during build and encoded in the client (03 §12.2).
- 429/5xx paths tested; all calls carry the pinned revision.

**Dependencies:** WS1-R1/R2 (credentials).

## WS1-R4 — Reference-template fetch + audience reads as pack tools *(marketing-os pack, wired in hosted-agents)*

`klaviyo_templates_read` and `klaviyo_audiences_read` as `SkillToolDefinition`s over the client (02 §1 read table). Templates read must inline universal content blocks (03 §3 — fetch + inline; blocks aren't referenceable in payloads) and annotate each template with `editor_type` and last-used recency where available.

**Acceptance:**
- Agent (dev harness ok) lists Arthaus's real templates with HTML and its lists/segments with counts.
- Universal blocks in a fixture template are inlined verbatim.
- Output shapes are stable/typed — WS2's extractor consumes `klaviyo_templates_read` output directly.

## WS1-R5 — Conversion metric resolution *(marketing-os-app connect flow + pack)*

At connect time, resolve and store the tenant's conversion metric id (Shopify "Placed Order" — 03 §8: `conversion_metric_id` is required on every report). Store on the connection row metadata; expose to the pack via config (05 H1.3).

**Acceptance:** Arthaus's connection row carries a verified metric id; a `campaign-values-report` call using it returns revenue fields.
**Open question:** stores with multiple candidate metrics (e.g., recharge/subscription events) — auto-pick Shopify Placed Order when present, else ask the owner in the connect flow?

## WS1-R6 — Performance readback read *(pack tool)*

`klaviyo_performance_read`: given campaign ids (or a timeframe), return normalized stats — delivery, engagement (opens/clicks/CTOR), compliance (unsub/spam), conversion (count, revenue, rev-per-recipient) — via `campaign-values-report`, with the attribution caveat surfaced in the payload (by-send-date vs event-time — 03 §8; the agent must state which model a number uses, spec 12 glossary discipline).

**Acceptance:**
- Real numbers for a historical Arthaus campaign match the Klaviyo UI (same attribution basis).
- Timeframe >1yr rejected client-side with a clear error (API limit).
- Output includes `conversion_metric_id` used + attribution basis string.

**Dependencies:** WS1-R3, WS1-R5. Feeds WS3's planning-with-readback and the spec 19 "Email Recap" report (WS4).

---

## Open questions (human)
1. PRD §8 Q1 — OAuth vs key for v1 (build order within this WS depends on it; R2's OAuth half can trail if key-first).
2. WS1-R2 — confirm marketing-os-app as OAuth callback owner.
3. WS1-R5 — multi-metric stores: auto-pick vs ask.
4. Do we request `segments:write` scope now (empty use) or re-consent later when segment creation ships? Recommendation: later — least-privilege reads better in the grant screen.
