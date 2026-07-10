# 20 — The Capability Suite & the Action Framework

> **Status:** DRAFT — architecture of record for how capabilities compose. Awaiting catalog input + build go.
> **Depends on:** 05-AGENTS-AND-SKILLS (skill format, registry), 08-COMMUNITY-ECOSYSTEM (distribution, quality gates), 14-OFFER-SURFACES (approval-gated deploy), 15-SLACK-INTEGRATION (the surface), 17-RICH-SURFACES (approval cards), 18-EXTERNAL-MCP (third-party tool servers), 19-SCHEDULED-REPORTS (recurring delivery).
> **Closes:** spec 18 §2.3's admitted gap — "v1 does not attempt to verify that a server is actually read-only."

---

## 0. Thesis

Marketing OS is not a dashboard and not one agent. It is **a growing suite of open-source Mastra skills a team picks from**, invoked the way teams already work — by talking to a coworker in Slack. Reports were use case #1. The product is: *a store team runs their Shopify/marketing/support work by asking Marketing OS.*

That only works if pulling an off-the-shelf capability is **safe**. So the governing rule:

> **Reads compose freely. Writes narrow through one gate.**

Any capability — first-party tool, community skill, third-party MCP server, sub-agent — may contribute **reads** to the agent. Nothing mutates the store except through an **Action**: a declared, previewable, role-gated, audited unit of change. The Action is the unit of trust, and it is exactly what the Slack approval card renders.

We already proved the loop end-to-end (offer proposed → branded card → Approve → real state change → card rewrites → audit). This spec **generalizes that one hardcoded path into the platform's core primitive.**

---

## 1. The four capability sources

| Source | Contributes | Trust |
|---|---|---|
| **Native tools** (semantic layer, GA4, Shopify admin) | reads + declared Actions | first-party code |
| **Skills** (`packages/skills/*`, community registry — spec 05 §3, 08) | reads + declared Actions + instructions + optional reports/surfaces | reviewed, versioned, quality-gated |
| **External MCP servers** (spec 18) | reads **only** by default | third-party; tools snapshot + drift detection |
| **Sub-agents** (creative, brand, offer) | delegated capability | first-party |

A **sub-agent is just a skill that happens to wrap an agent.** The unit of distribution stays the *skill*.

## 2. The Action contract (the core primitive)

```ts
export interface Action<P> {
  kind: string;                    // "order.refund" | "product.update_price" | "offer.activate"
  title: string;                   // human title for the card
  summary: (p: P) => string;       // one line: what will change
  rows?: (p: P) => Row[];          // card detail rows (branded renderer, spec 17)
  scopes: string[];                // e.g. ["shopify:write_orders"] — checked before offer
  risk: "low" | "medium" | "high"; // drives who may approve (§4)
  preview: (p: P) => Promise<Preview>;   // MUST be read-only. What exactly changes; may return previewUrl
  execute: (p: P) => Promise<Result>;    // the mutation. Idempotent where possible
  undo?: (r: Result) => Promise<void>;   // reversible where possible
}
```

**Invariants**
1. `preview()` never mutates. The card shows *its* output, so the approver sees the real diff, not the agent's prose.
2. `execute()` runs **only** after an approval event bound to that action instance (nonce), never from a tool call.
3. Every execute writes an **audit record**: `{action, params, previewHash, approver, at, result}`.
4. An Action declares its **scopes**; missing scope ⇒ never offered to the agent, never rendered.

The agent's job is to **propose** an Action, not to perform it. Proposing is a tool call (`propose_action`); performing is the platform's, after a human clicks.

## 3. How each source maps onto it

- **Native / skill Actions** — declared in code alongside tools. `offer.activate` and `storefront.publish` (today's hardcoded approve paths) become the first two entries; nothing about the Slack card changes.
- **External MCP (spec 18)** — a server's tools are **untrusted reads**. They are exposed to the agent as read-only tools and never wired to `execute`. For a third-party tool to mutate, someone must **adopt it into an Action**: a first-party adapter that names it, declares `scopes` + `risk`, and supplies `preview()`. Until adopted, a write-capable MCP tool is simply not callable. *This closes spec 18 §2.3 without needing to sandbox or trust the server's own docs.*
- **Sub-agents** — may propose Actions; may not execute.

**Consequence:** you can install an off-the-shelf skill or attach a random MCP server and the blast radius is bounded by construction. The worst a rogue/broken capability does is give the agent bad *information* (a prompt-injection surface we already accept for any tool result) — it cannot change the store.

## 4. The gate: propose → preview → approve → execute → audit

```
agent: propose_action(kind, params)
  → platform: scope check → risk tier → preview()          [read-only]
  → render approval card (spec 17): branded image + Approve/Decline (+ Preview URL)
  → approver check (§ roles)  → execute()  → audit + card rewrite (+ undo offer)
```

**Roles / risk tiers** (extends spec 15 §6's installer-only allowlist):

| Risk | Examples | Who may approve |
|---|---|---|
| low | draft a reply, tag a product | any workspace member on the allowlist |
| medium | change a price, activate an offer | store admins |
| high | refund, publish theme, bulk edit | store admins + confirmation dialog; optional 2nd approver |

Read-only capability needs **no gate at all** — that's what keeps the suite pleasant.

## 5. The Skill package (extends spec 05 §3.1)

```ts
export const metadata = { id, name, description, category, version, author };
export const requires = { providers: ["shopify","ga4"], scopes: ["shopify:write_products"] };
export const tools    = { /* Mastra read tools */ };
export const actions  = [ /* Action<P> declarations */ ];
export const instructions = "…appended to the agent when enabled…";
export const reports  = [ /* optional: spec 19 report prompts */ ];
export const surfaces = [ /* optional: spec 14 storefront surfaces */ ];
```

Backwards compatible with today's skills (`store-health-check`, `weekly-digest`, `ad-copy-generator` declare only `tools`). New fields are additive.

**Install / enable** is per-tenant, versioned, and merges at request time into the agent's tools + instructions — exactly the dynamic-merge pattern spec 18 built for external MCP (`tools: async () => ({...base, ...enabled})`). One mechanism, three sources.

**Distribution** rides spec 08: registry, contribution format, quality gates. Add one gate: *a skill that declares `actions` requires review of every `preview()`/`execute()` pair.*

## 6. Surfaces

An Action and its result are **surface-agnostic specs**. Renderers:
- **Slack** (primary, spec 15/17) — branded card image + Block Kit buttons; the interactivity handler is the approve seam (built).
- **Console** (admin, spec 19 R1/C2) — enable/disable skills, audit history, the same actions as buttons.

One Action → many renderers. Same shape as the report/chart work.

## 7. Catalog (the suite) — proposed; replace with the real list

| Category | Reads | Actions (gated writes) |
|---|---|---|
| **Insight** | store-health-check*, weekly-digest*, funnel, cohort/retention, SEO audit, ads audit | — |
| **Orders & support** | order lookup, fulfillment status, customer history | `order.refund`, `order.cancel`, `support.draft_reply` |
| **Catalog & merch** | inventory check, price history | `product.update_price`, `product.update_inventory`, `product.publish`, `product.retag` |
| **Marketing** | ad-copy-generator*, creative brief | `campaign.launch`, `offer.activate`* |
| **Storefront** | theme diff | `storefront.publish`* |
| **Lifecycle** | segment explorer | `segment.create`, `email.draft` |

`*` exists today in some form. **The everyday grind — order lookup, refund, price/inventory edit, draft customer reply — is the wedge**; it's what makes "automate what we do in Shopify" true.

## 8. Build phases

- **A0 — Action framework.** The contract, the gate, the audit table. Refactor the two hardcoded approve paths (`offer`, `proposal`) onto it. No user-visible change; everything after is cheap.
- **A1 — `propose_action` tool + roles/risk tiers.** The agent can propose any registered Action; the card renders from `preview()`.
- **A2 — First write catalog.** `order.refund`, `product.update_price`, `product.update_inventory`, `support.draft_reply`. Proves the wedge.
- **A3 — Skill package v2 + registry enable.** `actions`/`reports`/`surfaces` fields; per-tenant enable; console skill list.
- **A4 — External MCP write adoption.** Adapter that promotes a reviewed third-party tool into an Action. Closes spec 18 §2.3.
- **A5 — Proactive triggers.** Anomaly watcher → pushes a card into Slack (reuses spec 19's cron + card plumbing). Turns "I asked it" into "it told me."

## 9. Non-goals (v1)

- Sandboxing third-party code. We bound blast radius by **gating writes**, not by isolating execution.
- Auto-classifying an MCP tool as safe-to-write from its description. Adoption is an explicit, reviewed act.
- Agent-to-agent autonomy that mutates without a human. Every write has an approver until an explicit, per-action "auto-approve under threshold" policy exists (A6+).

## 10. Open questions

1. **Auto-approve policy.** Teams will want "refunds under $50 don't need me." Per-action thresholds + spend caps + a daily budget — worth designing before someone asks for it.
2. **Undo.** Which Actions get `undo()`? Refunds can't be un-refunded; price edits can. Should the card offer "Revert" for the reversible ones?
3. **Where the catalog lives.** `packages/skills/*` (OSS, in this repo) vs a separate registry repo. Spec 08 §3.2 leans in-repo; the hosted plane just enables them per-tenant.
4. **The real list.** This catalog is a proposal. The actual set should come from what store teams do manually every week.
