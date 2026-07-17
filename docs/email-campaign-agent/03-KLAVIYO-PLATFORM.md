# Klaviyo Developer Platform — Researched Facts (2026)

> Researched 2026-07-16 from developers.klaviyo.com (docs default to API revision **2026-07-15**) + changelog. Dense facts with sources; **uncertainties flagged inline and collected in §12**. Verify per-endpoint details (especially rate limits) against the live reference at build time — Klaviyo revisions move quarterly.

---

## 1. Auth — OAuth vs private keys (the multi-tenant answer)

Three auth methods: **private API keys** (server-side), **OAuth** (server-side, "for third-party integrations and app partners"), and a public 6-char company ID (client-side tracking only — irrelevant here).

**Private keys:** created in Settings → API keys, prefixed `pk_`, shown once. Header `Authorization: Klaviyo-API-Key <key>`. Three scoping levels: Full Access, Read-Only, **Custom** (per-API selective access). **Scopes are immutable after creation** — delete and recreate to change. Never client-side.

**OAuth — the fit for a multi-tenant platform where each store connects THEIR Klaviyo:**
- Klaviyo's docs: "If you're building an app with Klaviyo, use OAuth to provide secure delegated access to users via access tokens."
- **Authorization code + PKCE; PKCE mandatory** for both public and confidential clients.
- Endpoints: authorize `https://www.klaviyo.com/oauth/authorize`; token `https://a.klaviyo.com/oauth/token`; revoke `https://a.klaviyo.com/oauth/revoke`. (Since 2025-03-31 token traffic must use `a.klaviyo.com`.)
- **Access token ~1 hour** (explicitly "subject to change"). **Refresh token valid until app uninstall; revoked after 90 days of non-use.** Token-endpoint refresh limited to ~10/min per install.
- **Scopes:** space-separated `resource:read|write` (e.g. `lists:write campaigns:write metrics:read`); `accounts:read` required by default; every API reference page lists its needed scopes (full scopes-per-API table linked from the authenticate guide). Klaviyo requires "the least permissive scope set possible."
- **Unlisted OAuth apps are allowed:** "Your app does not have to be listed to share and use your installation URL with customers" — **OAuth works privately, no marketplace review required.** This is the decisive fact for our v1 (02 §2).
- **Migration pressure:** published marketplace partners are being forcibly migrated — "Your app will be delisted if you do not upgrade to OAuth," with their private-key customers transitioned within 3 months. Also: **Universal Content and Webhooks APIs are gated to OAuth apps**, and OAuth apps get **per-install rate quota** (§9).
- **Uncertainty:** no explicit ToS clause was found forbidding an *unlisted* platform from using a customer-supplied private key — only the published-partner mandate. Private-key bootstrap is defensible; OAuth is the compliant trajectory.

Sources: [Authentication](https://developers.klaviyo.com/en/docs/authenticate_) · [Set up OAuth](https://developers.klaviyo.com/en/docs/set_up_oauth) · [Migrate to OAuth](https://developers.klaviyo.com/en/docs/migrate_to_oauth_from_private_key_authentication) · [Create a public OAuth app](https://developers.klaviyo.com/en/docs/create_a_public_oauth_app) · [Update your OAuth scopes](https://developers.klaviyo.com/en/docs/update_your_oauth_scopes) · [Handle your app's OAuth flow](https://developers.klaviyo.com/en/docs/handle_your_apps_oauth_flow)

## 2. API basics

- Base URL `https://a.klaviyo.com/api`; **date-based `revision: YYYY-MM-DD` header** on every request. Latest stable GA revision **2026-07-15** (beta `2026-07-15.pre`). Revisions supported ~2 years; Klaviyo recommends upgrading every 12–18 months. **Pin `2026-07-15` in the client adapter.**
- Full **JSON:API**: relationships, sparse fieldsets (`?fields[TYPE]=…`), `?include=`, endpoint-specific `?filter=`, cursor pagination (`?page[cursor]=`), `?sort=`, ISO-8601/RFC-3339 datetimes. Every reference page links its OpenAPI definition.

Sources: [API overview](https://developers.klaviyo.com/en/reference/api_overview) · [Changelog](https://developers.klaviyo.com/en/docs/changelog_)

## 3. Templates API — the assembly pipeline's landing zone

- **Full CRUD**: `GET/POST /templates`, `GET/PATCH/DELETE /templates/{id}`, `POST /templates/{id}/render`, `POST /templates/{id}/clone` (clone fails at 1,000+ templates/account).
- **Raw HTML creation: YES.** `editor_type` enum: **`CODE`** (pure HTML — what our assembler targets), `USER_DRAGGABLE` (hybrid HTML/drag-drop), `SYSTEM_DRAGGABLE` (native drag-drop via structured JSON `definition`; API-creatable since revision 2026-04-15). Content fields: `html`, `text`, `amp`, `definition`.
- **Render endpoint** returns HTML + plaintext (+ AMP) with a supplied JSON `context` interpolated — a server-side preview lane (WS4 weighs it vs our own preview route).
- **Reading existing template HTML for ingestion: YES** — single-template GET includes content (`definition` needs `?additional-fields[template]=definition` in lists). This is what makes reference-skeleton ingestion (04 §3) viable.
- **Universal content blocks:** dedicated CRUD API (`/universal-content`), **OAuth-app-gated** — but "our APIs do not natively support referencing universal content blocks directly in the payload": blocks must be **fetched and inlined** into template HTML. Consequence for 04 §3: ingestion must inline any universal blocks the reference templates use; we cannot round-trip block references.
- Beta: **Template Preview Send API** (send test emails) — watch; a "send me a test" affordance rides it when GA.
- Scopes: `templates:read` / `templates:write`.

Sources: [Templates API overview](https://developers.klaviyo.com/en/reference/templates_api_overview) · [Changelog](https://developers.klaviyo.com/en/docs/changelog_)

## 4. Campaigns API — create, assign, audience, schedule, send

GA (revision 2026-07-15):
- **Create campaign** with `campaign-messages` (channel `email`; content = subject, preview text, from-email/label) and **`audiences: {included: [...], excluded: [...]}`** — list AND segment IDs.
- **Template assignment is a separate endpoint** ("Assign Template to Campaign Message") after campaign creation; **an email campaign cannot be scheduled without a template assigned**. So `klaviyo.create_campaign_draft`'s execute is a 3-step sequence: create template (CODE, assembled HTML) → create campaign+message → assign template. Idempotency: record each created id on campaign.md as it lands; re-execute resumes.
- **Send strategies:** `static` (with `is_local` recipient-local-timezone + `send_past_recipients_immediately`), `throttled` (`throttle_percentage`), `immediate` (default), `smart_send_time` (revision 2026-04-15+, email/SMS). v1 uses `static`.
- `send_options.use_smart_sending` (default true — skips recently-contacted profiles; keep it, it's free frequency-cap hygiene). **`tracking_options`: `is_add_utm` + `utm_params[]`**, `is_tracking_clicks`/`is_tracking_opens` — **native UTM decoration**; our readback UTM discipline (02 §5) rides this rather than rewriting links in HTML.
- **Send jobs:** Create Campaign Send Job (async trigger of the scheduled send), Get (status queued/processing/cancelled/complete), **Update = cancel or revert to draft** — the `klaviyo.cancel_send` Action's substrate. Cancelled campaigns must be **cloned** to resend.
- **Recipient estimation:** Create/Get Campaign Recipient Estimation Job — the audience-size number on the approval card.
- **A/B testing: NOT exposed in the GA Campaigns API** (results readable via reporting/metric-aggregates only). Confirms PRD §4's non-goal.
- **Omni Campaigns API (beta, GA planned 2026-10-15):** Campaign → Audience → Message → **Variation** hierarchy, multi-channel (email/SMS/push/WhatsApp), template assignment moves to variation level. **Do not build on it** (shapes may change); revisit at its GA — variations may bring A/B semantics.

Sources: [Campaigns API overview](https://developers.klaviyo.com/en/reference/campaigns_api_overview) · [Omni Campaigns API overview (beta)](https://developers.klaviyo.com/en/reference/campaigns_omni_api_overview)

## 5. Images API

- **Upload From URL** (`import_from_url`) and **Upload From File** (multipart `file`/`name`/`hidden`). **Max 5 MB; formats jpeg, png, gif** — note **no webp/svg**: design-surface boards export as PNG (or JPEG if 5MB binds at @2x).
- Response carries hosted **`image_url`** → referenced in template HTML `<img src>`. PATCH supports rename/hide. Campaign-variation image endpoints exist (rev 2025-01-15).
- Pipeline consequence (04 §4): assembly uploads each board export to Klaviyo Images, then writes the returned `image_url` into the HTML — never hotlink our own hosts in sent mail.

Sources: [Images API overview](https://developers.klaviyo.com/en/reference/images_api_overview) · [Changelog](https://developers.klaviyo.com/en/docs/changelog_)

## 6. Lists & Segments

- **Lists:** full CRUD + add/remove profiles (≤1,000/request) + Get Profiles; profile-count via `additional-fields` carries stricter rate limits. Scopes `lists:read`/`lists:write`.
- **Segments:** read + **Create/Update/Delete** via `definition` of `condition_groups` (AND between groups, OR within; condition types include profile-attribute, profile-metric, profile-marketing-consent, profile-predictive-analytics). Hard limits: **max 5 segments processing at a time, max 100 created/day.**
- MVP uses read-only (audience selection); segment *creation* is a natural later Action (`klaviyo.create_segment`) — the API supports it.

Sources: [Lists API overview](https://developers.klaviyo.com/en/reference/lists_api_overview) · [Segments API overview](https://developers.klaviyo.com/en/reference/segments_api_overview)

## 7. Flows API (out of MVP — noted for v2)

No longer read-only: **Create Flow (`POST /api/flows/`) with full JSON `definition` is GA** (rev 2025-01-15); flows create as **Draft**. `PATCH /flows/{id}` is **status-only** (Draft/Manual/Live) — editing an existing flow's definition is not documented. Flow message templates are reachable (`GET /api/flow-messages/{id}/template/`) and editable via the Templates API — meaning **v2 could re-skin existing flow emails through the same assembly pipeline without touching flow logic**. 2025-10-15 added a Flow Actions API; beta adds custom actions (Python/Node in flows). UI trick: append `.json` to a flow URL to see its definition.

Sources: [Flows API overview](https://developers.klaviyo.com/en/reference/flows_api_overview) · [Changelog](https://developers.klaviyo.com/en/docs/changelog_)

## 8. Reporting / Metrics — performance readback

- **Reporting API:** **`campaign-values-report`** (the readback workhorse), flow-values/flow-series, form- and segment-reports. Series intervals exist for flows/forms/segments only — **no campaign series report** (campaign readback is totals-per-campaign; time-series needs Query Metric Aggregates).
- **Statistics available:** delivery (delivered/bounced/failed + rates), engagement (opens/clicks, uniques, CTOR), compliance (**unsubscribes, spam complaints** + rates), conversion (conversions, uniques, **conversion value/revenue, revenue-per-recipient, AOV**).
- **`conversion_metric_id` is REQUIRED on every report** — for Shopify stores, the Shopify "Placed Order" metric id. WS1 must resolve + store it per tenant at connect time (Metrics API lists metrics).
- **Attribution model:** campaign reporting is **by send date** (matches Klaviyo UI); **Query Metric Aggregates** buckets by event-occurrence time — the two disagree by construction. Report both honestly; the semantic-layer join (UTM → GA4/Shopify) is a *third* counting system — glossary discipline applies (spec 12).
- Timeframes: presets or custom ISO-8601, **max 1 year**; list filters ≤100 items, AND-only.
- **Metrics API:** Get Metrics / **Query Metric Aggregates** (count/sum, filters, group-by, hourly→monthly) — the custom-analysis route. Events API reads per-profile events; rev 2026-07-15 added a `backfill` flag for historical events.
- Scopes: `campaigns:read`, `metrics:read`, `events:read` (+ flows/forms/segments read as used).

Sources: [Reporting API overview](https://developers.klaviyo.com/en/reference/reporting_api_overview) · [Metrics API overview](https://developers.klaviyo.com/en/reference/metrics_api_overview) · [Query Metric Aggregates guide](https://developers.klaviyo.com/en/docs/using_the_query_metric_aggregates_endpoint) · [Changelog](https://developers.klaviyo.com/en/docs/changelog_)

## 9. Rate limits

- Fixed-window, **two windows per endpoint: burst (1s) + steady (1min)**; per-endpoint limits on each reference page. Default tiers: XS 1/s·15/m · S 3/s·60/m · M 10/s·150/m · L 75/s·700/m · XL 350/s·3500/m.
- Headers: `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` (steady window); on 429, `Retry-After` seconds. Guidance: exponential backoff + jitter, retry after Retry-After.
- **Enforced per account.** The multi-tenant fact: **"OAuth apps receive their own rate limit quota per installed app instance (per account per app), while private key integrations share the same rate limit quota per account."** OAuth = our quota is ours per tenant; private key = we contend with the merchant's other integrations.
- No daily caps documented. **Unverified:** per-endpoint tiers for Templates/Campaigns/Reporting weren't captured (overview pages omit them); Reporting has historically been low-tier — check per endpoint at build time and encode limits in the client adapter.

Sources: [Rate limits, status codes, and errors](https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling) · [API overview](https://developers.klaviyo.com/en/reference/api_overview)

## 10. App review / marketplace

- **Unlisted OAuth needs no review** — build, share the install URL with merchants, done (§1).
- **Marketplace submission requires ≥5 active installs** with real API activity (test accounts excluded). Review checks: OAuth implementation + least-privilege scopes, testing instructions, TLS ≥1.2, client-credential rotation practices, listing content.
- Beta Applications API (2026-07-15.pre) lists published integrations programmatically.
- Consequence: listing is a **commercial milestone after 5 tenants**, not a build gate. Nothing in the MVP blocks on Klaviyo review.

Sources: [Submit your app for review](https://developers.klaviyo.com/en/docs/submit_your_app_for_review) · [Pass your app review](https://developers.klaviyo.com/en/docs/pass_your_app_review) · [App listing requirements](https://developers.klaviyo.com/en/docs/klaviyo_app_listing_requirements)

## 11. AI / agent surfaces (and why we don't build on them)

- **Official Klaviyo MCP server, GA:** remote `https://mcp.klaviyo.com/mcp` (OAuth w/ dynamic client registration, requires Owner/Admin/Manager role) or local (private key). ~80+ tools: campaigns (create, assign templates), templates (create/update/clone/render), reporting, segments/lists, profiles, catalogs, events. Modes via query params: `read-only`, `core-tools-only`, `disable-tools-with-user-generated-content`, `beta`.
  **Position:** we do NOT build the module on it. Spec 20's rule makes third-party MCP tools untrusted reads only; Klaviyo's MCP tools *write* (create campaigns/templates), which we could never wire to execute without adoption — and our Actions need `preview()`, idempotent `execute()`, and audit, which means first-party adapter code over the REST API anyway. The MCP server *is* useful as: (a) an attachable spec 18 read source in `read-only` mode for ad-hoc exploration, and (b) a reference catalog of what Klaviyo considers agent-shaped operations.
- **Customer Agent API (beta, 2026-04-15.pre+):** configure/run Klaviyo's own Customer Agent (skills, tools, secrets, knowledge sources; preview/live modes; new `agents:read`/`agents:write` scopes). This is Klaviyo's competing generic-ESP-AI — the thing the PRD's thesis is against. Not a dependency; know it exists when positioning.
- **Brand APIs (beta, 2026-07-15.pre):** logos, colors, buttons, voice, email defaults — a future DISTRIBUTE target for brand.md/DESIGN.md (push the brand system *into* Klaviyo the way spec 23 §5 pushes it into Penpot). Watch for GA; not MVP.
- Klaviyo launched its broader AI-agents suite in public beta 2026-06-30.

Sources: [Klaviyo MCP server](https://developers.klaviyo.com/en/docs/klaviyo_mcp_server) · [Changelog](https://developers.klaviyo.com/en/docs/changelog_) · [Klaviyo AI agents launch (Business Wire, 2026-06-30)](https://www.morningstar.com/news/business-wire/20260630493754/klaviyo-launches-ai-agents-that-work-together-to-drive-revenue-for-consumer-brands)

## 12. Collected uncertainties (re-verify at build time)

1. No explicit ToS ban found on unlisted platforms using customer private keys — legal-check if the bootstrap lane matters commercially; OAuth sidesteps it.
2. Per-endpoint rate-limit tiers for Templates/Campaigns/Reporting not captured; Reporting historically low-tier. Encode from live reference pages during WS1.
3. A/B testing absence is inferred from documentation silence; the omni-beta's Variations may grow A/B semantics by its 2026-10-15 GA.
4. Access-token lifetime (1h) explicitly subject to change — never hardcode; refresh on 401.
5. The complete scopes-per-endpoint enumeration was not extracted — pull the full table from the authenticate guide during WS1.
6. Omni Campaigns API GA (planned 2026-10-15) may deprecate patterns above on Klaviyo's 2-year revision clock — pin revision 2026-07-15 and schedule a revisit.
