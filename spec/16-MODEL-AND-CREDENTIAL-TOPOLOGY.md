# 16 — Model & Credential Topology: Workload Split + Tier Keys

> **Status:** **DECISION of record**, 2026-07-07. Supersedes the implicit "one Anthropic key for everything" assumption.
> **Why this exists:** to fix, unambiguously, *which model provider runs which workload*, *whose compute runs it*, and *whose key pays* — across the pooled-hosted and self-deployed tiers. Written after the first live Slack test hit an empty Anthropic account and forced the question.
> **Related:** 11-HOSTED-PATH (tiers, pooled runtime, eject), 12-STORE-MCP (broker, provider creds), 15-SLACK-INTEGRATION (chat surface), 05-AGENTS-AND-SKILLS (agent/model config).

---

## 0. The decision, in one paragraph

**Model is chosen by *workload*, and only then does key ownership follow the *tier*.** Conversational, high-volume, shared surfaces — the console chat and the Slack bot — run on **Gemini via GCP/Vertex** on the hosted-app side. The **Claude (Anthropic) budget is reserved for Claude Code–oriented work**: the agentic, git-based storefront/theme edits driven through the async pipeline. For that Claude Code workload, the key follows the tier — a **hosted** tenant uses the platform's **shared pool** Anthropic key; a **self-deployed** tenant uses **its own** key. Everything else that is per-tenant (provider creds, memory, data) is isolated by the broker and schema-per-tenant, independent of which model signs the call.

---

## 1. The workload split (the governing axis)

| Workload | What it is | Model / provider | Runs where |
|---|---|---|---|
| **Conversational agent** | Console chat + Slack bot: Q&A, analysis, drafting, orchestration, deciding *when* to dispatch an edit | **Gemini** (GCP / Vertex AI) | Hosted-app side — the pooled runtime for hosted tenants; the tenant's own deployment for self-deployed (see §3) |
| **Claude Code — git edits** | The async pipeline that actually *writes* storefront/theme changes as PRs / draft themes (design-loop, `dispatch-to-github` → Claude Code Action, job runner in Vercel Sandbox) | **Claude** (Anthropic) | Hosted job runner (platform key) or the tenant's GH Actions (tenant key) |

**The seam between them:** the conversational agent (Gemini) never edits code directly. When a user asks for a storefront change, the agent calls the `dispatch-to-github` / `propose_storefront_change` tool, which hands off to the **Claude Code** pipeline. So the boundary is **orchestration (Gemini) → code execution (Claude Code)**. This is also the review-gate boundary from spec 11 D1: edits become draft-theme proposals, never raw pushes.

Rationale: chat is high-volume and latency-sensitive and does not need Claude's code-editing strength; Gemini on GCP is the cost-appropriate substrate for it. Claude Code is where the differentiated, high-value agentic editing happens and is worth the Anthropic spend — metered to whoever's deployment runs it.

---

## 2. Key ownership by tier (per workload)

| | Conversational (Gemini) | Claude Code — git edits (Claude) |
|---|---|---|
| **Pooled hosted** | Platform GCP project / Vertex creds on the pooled runtime; **platform-borne cost** | Platform **shared pool** `ANTHROPIC_API_KEY` (job runner / GH App) |
| **Self-deployed** | The tenant's own Gemini/Vertex creds in its own deployment | The tenant's **own** `ANTHROPIC_API_KEY` (its repo's GH Actions secret / its env) |

Two-plane economics still hold: the hosted plane bears inference cost as part of the managed offering; the OSS/self-deployed path brings its own keys for both providers. The only change from the old model is **which provider serves chat** (now Gemini, not Claude).

---

## 3. What is per-tenant vs shared (unchanged by this decision)

Model choice is orthogonal to tenant isolation. A pooled tenant is fully isolated even while sharing the platform's model keys.

| Concern | Pooled hosted | Self-deployed |
|---|---|---|
| Compute / deployment | Shared (1 runtime) | Own Vercel deployment |
| **Chat model key** (Gemini/Vertex) | Platform GCP | Own GCP |
| **Code-edit key** (Anthropic) | Platform shared pool | Own key |
| Provider creds (GA4/Shopify/Meta) | Per-tenant, brokered, Supabase **Vault** | Own tokens (or brokered while managed) |
| Memory / conversation data | Schema-per-tenant (`tenant_<slug>`) on shared PG | Own Postgres |
| Tenant resolution | Per-request handoff → AsyncLocalStorage | Implicit (deployment = tenant) |

---

## 4. How a chat request flows — as-built vs target

**As-built today (the reason the first Slack test failed):**
```
Slack → marketing-os-app /api/slack/events → streamAgentReply → MOS_POOLED_AGENTS_URL /api/chat
      → marketing-os-hosted-agents → Mastra marketingAgent.stream
      → api.anthropic.com   ← model = claude-sonnet-4-6, PLATFORM Anthropic key (a3645fc8-…, out of credits)
```
Two things are "wrong" relative to this decision: (a) chat runs on **Claude**, not Gemini; (b) chat is hardcoded to the **pooled** runtime and ignores `tenant.agentsUrl` even for self-deployed tenants (e.g. Arthaus, `arthaus-agents.vercel.app`). Both console and Slack share this path.

**Target after this decision:**
```
Slack/console → /api/chat on (tenant.agentsUrl ?? MOS_POOLED_AGENTS_URL)
             → marketingAgent.stream  ← model = gemini-* via Vertex, GCP creds of that deployment
             → (on edit request) dispatch tool → Claude Code pipeline (Anthropic, per-tier key)
```

---

## 5. Implementation to realize the decision

**A. Switch the conversational agent to Gemini** (`marketing-os-hosted-agents` + template `templates/agents`):
- Change `marketingAgent` model from `anthropic/claude-sonnet-4-6` to a Vertex Gemini model (e.g. `google/gemini-2.5-pro` or `gemini-2.5-flash` for cost) via the AI SDK Google/Vertex provider Mastra already supports.
- Provision Vertex creds on the pooled runtime env: Vertex project + location + service-account credentials (or a Gemini API key if using the Gemini API rather than Vertex). No code reference needed beyond the model string + provider — the provider reads its env implicitly, same pattern as `ANTHROPIC_API_KEY`.
- Mirror into the template so self-deployed tenants get the same default (they supply their own GCP creds).

**B. Keep Claude Code on Anthropic, tier-keyed** (no change to intent):
- Hosted job runner / GH App: platform `ANTHROPIC_API_KEY` (on `marketing-os-app`).
- Self-deployed: the tenant repo's `ANTHROPIC_API_KEY` GH Actions secret (already how the scaffold works — `templates/.github/workflows/*` use `secrets.ANTHROPIC_API_KEY`).

**C. Tier-aware chat routing (spec 15 S5, still open):**
- `streamAgentReply` (and the console) should target `tenant.agentsUrl ?? MOS_POOLED_AGENTS_URL`. Independent of the Gemini switch, but needed for self-deployed tenants to run chat (and thus their own Gemini key).

**Credentials needed from the operator to implement A:** the GCP/Vertex project id, region, and a service-account key (or Gemini API key), and the chosen Gemini model tier. Until provided, chat cannot move off Anthropic.

---

## 6. Interim for the live Slack test

Chat cannot reply until it has a *funded* model. Two ways to green-light Arthaus now:
- **Bridge (fastest):** temporarily fund/replace the platform `ANTHROPIC_API_KEY` on `marketing-os-hosted-agents` so the current Claude-based chat works, then migrate to Gemini per §5.
- **Straight to target:** provision Vertex creds + swap the model to Gemini on the pooled runtime, and the Slack bot replies on the intended architecture — no Anthropic top-up needed for chat.

Recommendation: go **straight to Gemini** if GCP/Vertex creds are ready (it's the decided end-state and avoids paying for a provider we're moving chat off of); otherwise bridge on Anthropic for the demo and migrate right after.

---

## 7. Operational quick-reference (target state)

| Key | Project / location | Workload |
|---|---|---|
| Vertex/Gemini creds | `marketing-os-hosted-agents` (Vercel prod) | pooled conversational chat (console + Slack) |
| Vertex/Gemini creds | tenant's own agents deployment | that tenant's chat (self-deployed) |
| Platform `ANTHROPIC_API_KEY` | `marketing-os-app` (Vercel prod) + GH App | Claude Code git-edit pipeline (hosted tenants) |
| Tenant `ANTHROPIC_API_KEY` | tenant repo GH Actions secret / own env | Claude Code git-edit pipeline (self-deployed) |
| Provider secrets (Google/Shopify/Meta) | Supabase **Vault**, per-tenant `secret_ref` | tool execution — never a model key |
