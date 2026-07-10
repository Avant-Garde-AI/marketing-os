# 18 — External MCP Integration: Attaching Third-Party Tool Servers to the Hosted Agent

> **Status:** BUILT & DEPLOYED TO PRODUCTION 2026-07-08 (E0–E4). D1–D4 resolved. Awaiting live in-console validation of a cross-domain query for Arthaus (the human "take a look" step). Picasso Concierge is registered active for Arthaus; the runtime loads all 8 of its tools via `@mastra/mcp` (verified against the live server).
> **Depends on:** 12-STORE-MCP-AND-SEMANTIC-LAYER (broker pattern, credential storage), 11-HOSTED-PATH (tenant isolation, pooled runtime), 16-MODEL-AND-CREDENTIAL-TOPOLOGY (per-request tenant resolution in the pooled runtime).
> **Motivating case:** Arthaus's "Picasso Concierge" MCP server (`arthaus-concierge` v0.1.0) — a read-only FalkorDB art-knowledge-graph over its ~35k-artwork Shopify catalog, exposing `ask_concierge`, `search_artworks`, `recommend_similar`, `concept_walk`, `explore_concept`, `faceted_discovery`, `get_artwork_facets`, all keyed on Shopify product handle.

---

## 0. The thesis

The hosted agent today is an MCP **server** only (`app/api/mcp/route.ts` exposes the GA4/Shopify semantic layer to external clients like Claude Desktop). It has no MCP **client** — every tool it calls is a native Mastra `createTool()` wired directly to a first-party lib (`lib/ga4.ts`, `lib/shopify.ts`). There's no way today for the agent to pull in a third-party MCP server's tools and reason over them in the same turn as its own GA4/Shopify data.

Arthaus's art-knowledge-graph MCP is the forcing case: a shopper-facing question like *"which artworks got the most product-page views last month, and what do they have stylistically in common?"* requires joining GA4 pageview data (first-party, store MCP) with concept/style/facet data (third-party, Picasso Concierge) — joined on Shopify product handle, which both sides already speak.

This spec makes "attach an external MCP server to a tenant's agent" a general platform capability, not an Arthaus special case — a new `external_mcp_connections` registry, a console flow to register/review/enable one, and runtime wiring so the pooled agent merges its tools in per-session.

---

## 1. Product shape

- A tenant admin adds an external MCP server from the console Integrations page: name, server URL, optional static bearer token.
- The console does a live handshake (`initialize` + `tools/list`) against the server, shows the admin exactly what tools/instructions it would be granting the agent, and requires an explicit "enable" step — this is not auto-trusted the moment a URL is pasted.
- Once enabled, the next chat session for that tenant (console or Slack) transparently gains those tools alongside its existing GA4/Shopify toolset. The agent decides when to call them, same as any native tool.
- If the external server is down, slow, or rate-limited, the agent degrades to its first-party tools rather than failing the turn.

---

## 2. Architecture

### 2.1 Data model (D1)

`provider_connections` (spec 12/16) is shaped as one row per `(tenant_id, provider)` for a fixed enum (`google`, `meta`) — it assumes a bounded, known provider set. External MCP servers are arbitrary, tenant-supplied, and a tenant may register more than one, so this needs its own table rather than overloading that enum.

New table, same governance model as the existing credential tables (`supabase/migrations/`, RLS-denied to `authenticated`, `service_role`-only, secrets in Vault, `safe_*` view excluding the ref):

```sql
create table external_mcp_connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references "Tenant"(id),
  name          text not null,                -- admin-facing label, e.g. "Picasso Concierge"
  server_url    text not null,
  auth_type     text not null default 'none', -- 'none' | 'bearer_static'
  secret_ref    uuid,                         -- Vault ref, null when auth_type = 'none'
  status        text not null default 'pending_review', -- pending_review | active | disabled | error
  tools_snapshot jsonb,                       -- tools/list result captured at last (re-)review, for drift detection
  server_instructions text,                   -- the server's `initialize` instructions, shown to admin + injected into agent context
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, server_url)
);
```

Reuse `integration_events` (append-only audit log) for lifecycle events: `mcp_connection_registered`, `mcp_connection_enabled`, `mcp_connection_disabled`, `mcp_connection_tool_drift_detected`.

### 2.2 Auth model (D2)

v1 supports `none` (Picasso Concierge's actual shape) and `bearer_static` (Vault-stored static token sent as `Authorization: Bearer <token>`), covering the common case of an internal or partner MCP server with a shared secret. Full OAuth-per-external-MCP (where the *tenant's own* end-user would need to authorize a third-party service) is out of scope for v1 — see §9 Tranche 2.

### 2.3 Tool trust & safety (D3)

An external MCP server's `instructions` and tool descriptions become part of the agent's context, and its tool outputs are treated as data the agent reasons over — this is a prompt-injection surface no different in kind from any other tool result, but the server is third-party-authored rather than first-party code we wrote. Mitigations for v1:

- No auto-enable. Registration requires an explicit review step showing the live `tools/list` output and the server's own `initialize.instructions` before the admin can flip status to `active`.
- `tools_snapshot` is captured at enable time. If a subsequent handshake (see 2.4 caching) sees a different tool set than the snapshot, the connection is flagged (`mcp_connection_tool_drift_detected`) and the agent stops using it until re-reviewed — a server can't silently add a new (e.g. write-capable) tool after being approved for read-only use.
- v1 does not attempt to sandbox or verify that a server is actually read-only — that's asserted by the server's own docs (Picasso Concierge states "All tools are read-only" in its instructions) and is a real limitation, not a guarantee. Called out explicitly in §10.

### 2.4 Runtime wiring (D4)

The pooled hosted-agent runtime already resolves tenant identity per request via `lib/tenant-context.ts` (`AsyncLocalStorage`). This is where external MCP tools get merged in:

1. On session init, the agent template calls a new broker endpoint (analogous to the existing `POST /api/broker/token` pattern in `lib/broker-client.ts`) — e.g. `GET /api/broker/mcp-connections` — authenticated via the same deployment-key / platform-service-key chain already used for GA4/Shopify tokens. It returns the tenant's `active` `external_mcp_connections`, with `secret_ref` resolved server-side to a live bearer value (never persisted client-side, same pattern as the Google token mint).
2. The agent template (new `@mastra/mcp` dependency in `packages/marketing-os/templates/agents/package.json.hbs`, not currently present) instantiates one `MCPClient` per connection and calls `getTools()`, merging the result into the same flat tool map as `ga4Tools` / `shopifyAdminTools` in `marketing-agent.ts.hbs`.
3. This merged toolset is cached per-tenant in the pooled runtime process for a short TTL (~5 min) rather than re-handshaking every chat turn — necessary, not just an optimization: Picasso Concierge's own gateway rate-limits aggressively (observed 429s on back-to-back calls seconds apart during spec research).
4. Bounded timeout (~3s) on the `initialize`/`tools/list` calls; on timeout, rate-limit, or any connection error, that server's tools are omitted for the turn and the failure is logged — the rest of the agent's tools still work. A down or slow third-party MCP server never fails the whole chat turn.

---

## 3. Console UI

New route alongside the existing Integrations page pattern (`app/routes/app.integrations.tsx` in marketing-os-app): `app/routes/app.integrations.mcp.tsx`.

- **Add connection:** name, URL, optional bearer token → server-side test handshake (`initialize` + `tools/list`) → show instructions + tool list → "Enable" (writes the row as `active` with `tools_snapshot`) or discard.
- **List:** existing connections, status, last-reviewed tool count; flagged drift surfaced clearly.
- **Disable / remove:** sets `status = disabled` (agent stops loading its tools next session) or deletes the row.

---

## 4. Chat loop integration

No change to the chat loop's architecture (spec 16: Gemini-driven conversational agent, single flat tool map, AI SDK v6 streaming). External MCP tools are just more entries in that map. The connected server's `instructions` field is appended to the agent's system context so it knows *how* to use the new tools (mirrors how Picasso Concierge's own instructions tell a client to "start open-ended requests with `ask_concierge`").

---

## 5. Decisions — RESOLVED 2026-07-08

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| D1 | Data model for external MCP config | Dedicated `external_mcp_connections` table, not folded into `provider_connections` | Arbitrary tenant-supplied servers, potentially many per tenant — doesn't fit the fixed-enum, one-row-per-provider shape |
| D2 | Scope: Arthaus-only vs. general platform capability | General platform capability | User directive — build this as a registry any tenant can use, prove it via Arthaus first |
| D3 | Config storage location | Tenant registry row in marketing-os-app (Supabase, Vault-backed secret), not a template env var | User directive — needs to be dynamic per-tenant and console-visible, consistent with `provider_connections` governance |
| D4 | Auth model for v1 | `none` + `bearer_static` only; OAuth-per-external-MCP deferred | Covers the actual motivating case (Picasso Concierge is unauthenticated) without building OAuth plumbing with no second consumer yet |

---

## 6. Build phases

| Phase | Scope | Exit criterion | Status |
|---|---|---|---|
| E0 | Data model: `external_mcp_connections` migration + `integration_events` event types, RLS/`safe_*` view | Migration applied, table governed identically to `provider_connections` | ✅ DONE — `003_external_mcp_connections.sql` applied to prod Supabase |
| E1 | Broker read endpoint: `GET /api/broker/mcp-connections`, reusing existing auth chain | Returns a tenant's active connections with live-resolved bearer tokens | ✅ DONE — deployed; auth enforced (401 without key), returns Arthaus's active Picasso row |
| E2 | Agent runtime wiring: `@mastra/mcp` dependency, per-session `MCPClient` instantiation, tool-map merge, TTL cache, timeout/failure handling | A hosted agent session for a tenant with a registered connection shows the external tools in its tool map; a down/rate-limited server degrades gracefully | ✅ DONE — wired in `marketing-os-hosted-agents` (live) + `.hbs` template; MCPClient verified loading all 8 Picasso tools, namespaced, no errors |
| E3 | Console UI: `app.integrations_.mcp.tsx` — add/test/review/enable/disable/remove | Admin can register a server, see its real tool list before enabling, and disable it | ✅ DONE — deployed at `/app/integrations/mcp`, nav link added |
| E4 | Arthaus pilot | Register Picasso Concierge for the Arthaus tenant; validate a cross-domain query (GA4 pageviews + concierge concept/facet data joined on Shopify handle) end to end in console chat and Slack (spec 17) | 🔄 Picasso registered active for Arthaus; both apps deployed; **final in-console cross-domain chat validation pending (human step)** |
| E5 (Tranche 2, not started) | OAuth support for external MCPs needing delegated auth, per-tool allowlisting (not just whole-server enable), rate-limit/circuit-breaker telemetry | — | — |

---

## 7. Non-goals (v1)

- No marketplace/discovery UI for external MCP servers — admin must already know the URL.
- No OAuth flows for external MCP auth — bearer-static or none only.
- No technical enforcement that a connected server is actually read-only — v1 trusts the server's self-declared behavior, mitigated only by the explicit review step and tool-drift detection (§2.3).
- No per-tool allowlisting within a server (it's whole-connection enable/disable in v1) — deferred to E5.

## 8. Open questions

- Tool-drift detection today is checked opportunistically on cache refresh (~5 min TTL) — is that frequent enough, or does a connection need an explicit "re-check now" admin action too?
- What's the right backoff/circuit-breaker policy for a chronically rate-limited external server (Picasso Concierge returned 429 on the very first couple of probe calls seconds apart) — per-tenant, or should the agent runtime share a single rate-limited client across concurrent sessions hitting the same `server_url`?
- Should the console surface *which* tool calls in a transcript came from an external vs. first-party source, for admin trust/debugging?
