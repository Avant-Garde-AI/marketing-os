# 12 — Storefront MCP: Unified Endpoint, Semantic Layer & Credential Broker

> Marketing OS · Open Conjecture · July 2026
> Status: **Tranche 1 SHIPPED & LIVE-VERIFIED (2026-07-05→06).** Phases A→F, H, I, I2, J
> all live; acceptance demo passed (LLM with no docs answered the canonical
> traffic+revenue question via explore→describe→explain→query with glossary caveats).
> Tranche 2 (G blended views, gads GAQL proxy, K Meta, L visualize) not started.
> As-built reference: `marketing-os-app/docs/PLATFORM.md`. This file is the condensed
> spec of record; the original long-form draft lived outside the repo.

## 1. Product intent

Every store gets **one MCP endpoint**, reachable at two URLs hitting the same server:

```
https://{shop-primary-domain}/apps/mcp?token=…            ← Shopify App Proxy (primary) — LIVE
https://{slug}.mcp.avant-garde.ai/api/mcp?token=…          ← platform subdomain (router built; wildcard DNS pending)
```

Any MCP client can: **introspect** the store's marketing data model
(`explore_schema`, `describe_field`), **query** through a governed semantic layer that
compiles to GA4 / Shopify (Google Ads & Meta in T2), **refine** autonomously (errors
teach with did-you-mean; results are self-describing envelopes; `explain_query` is a
zero-quota planner), and fall back to **GA4 official-parity primitives**
(`get_account_summaries`, `get_property_details`, `list_google_ads_links`,
`run_report`, `run_realtime_report`, `get_custom_dimensions_and_metrics`).

Trust model: the platform holds identities and durable credentials (Vault); store
deployments hold nothing durable and fetch short-lived tokens from the broker at
tool-execution time.

## 2. Semantic layer (as built — vendored in `templates/agents/src/mastra/semantics/`)

Declarative manifest (views → measures/dimensions/time/segments with field-level
provenance, synonyms, caveats) compiled **per store**: availability from connected
providers, GA4 custom dimensions/metrics auto-discovered and merged, currency/timezone
from `shop.json`. Default model:

| View | Requires | Status |
|---|---|---|
| `traffic`, `acquisition`, `site_events` | ga4 | live |
| `commerce` | shopify (always on) | live |
| `ads_performance` | gads\|meta (partialOk) | declared; surfaces as VIEW_UNAVAILABLE w/ connect prompt |
| `marketing_overview` (blended_roas/MER/CAC) | shopify+ads | declared; comingSoon (T2 federation) |

`query`: validate → compile (GA4 `runReport` / Shopify orders fetch + client-side
aggregation, 250-order cap w/ honest truncation) → **envelope**
(`data` + `meta{coverage,row_count,truncated,time{grain,range,timezone},currency,
freshness,applied_defaults,caveats}`). Error taxonomy (all structured, all teach):
`UNKNOWN_VIEW · VIEW_UNAVAILABLE · INVALID_FIELD (did_you_mean: synonym +
edit-distance, cross-view) · INVALID_QUERY · RANGE_UNSUPPORTED · RECONNECT_REQUIRED ·
PROVIDER_ERROR`. Verified: 25/25 malformed-query suite.

Glossary is first-class (platform vs blended ROAS, sessions ≠ clicks, three conversion
counting systems, freshness) and load-bearing for LLM correctness.

## 3. Delivery & auth (as built)

- **MCP server**: stateless Streamable HTTP in the scaffold (`app/api/mcp/route.ts`) —
  tools + `semantic://` resources (manifest/views/{view}/glossary/connections/cookbook)
  + 3 analysis prompts + ~300-word server instructions. GET → 405 (no event-stream).
- **Auth modes**: connector token (`mos_`, Bearer or `?token=`, sha256 at rest,
  verified against platform w/ 60s cache) OR router-signed proxy handoff
  (`x-mos-proxy-*`, HMAC over shop+ts, ±2 min).
- **App Proxy path** (`/shopify-proxy` on the platform): verifies Shopify's app-proxy
  HMAC — **no-delimiter sorted `key=value` digest** (differs from OAuth's `&` join),
  timing-safe, ±90s timestamp — then **requires a connector token matched to THIS
  shop's tenant** (open item #3 decided ON, 2026-07-06; cross-tenant reuse 401s),
  then forwards with the signed handoff. `Cache-Control: no-store` throughout.
- **Edge router** (`/api/mcp` on the platform): `{slug}.mcp.avant-garde.ai` →
  `tenant.agentsUrl`; body must be buffered (streams don't survive the runtime).
- **Connector Install page** (embedded admin "AI Connector"): token issue-once/revoke,
  leads with the full copy-paste **primary-domain** tokenized URL (myshopify 301 drops
  POST bodies), client snippets for Claude/Claude Code/Cursor.
- **Broker**: `POST /api/broker/token` — deployment keys (client-owned) or platform
  service key + tenant assertion (pooled); providers `google`(ga4) + `shopify`(admin,
  auto-refresh of expiring offline tokens). Google refresh tokens in Supabase Vault;
  GDPR purge covers them.

## 4. Resolved open items

1. Vercel direct domain attach — deferred (router-only). 2. Token-in-URL posture —
accepted (capability URL + rotation + redaction). 3. `require_token_on_proxy` —
**ON, shipped**. 4. Authorization-header passthrough through Shopify's proxy —
moot: proxy path authenticates via `?token=` (HMAC-covered) + handoff headers.
5. Proxy timeout — no issues observed at current query latencies. 8. `apps/mcp`
locked at launch (registered in `marketing-os-6`).

## 5. Tranche 2 (not started)

Google Ads: `adwords` scope, broker GAQL proxy (developer token never leaves the
platform), `gads_*` primitives, `search_terms` + ads columns. **G — federation**:
conformed keys (date/channel/campaign via `campaign_mappings`), blended
`marketing_overview` (blended_roas = Shopify revenue / spend). K — Meta provider.
L — `visualize` + ChatGPT Actions generator. Roadmap: BigQuery-export warehouse
semantics (`sql_query` name reserved), write tools behind scopes, Klaviyo provider,
package-ization to `@marketing-os/semantics` + `@marketing-os/tools` (currently
vendored; the planned upgrade-surface shrink).
