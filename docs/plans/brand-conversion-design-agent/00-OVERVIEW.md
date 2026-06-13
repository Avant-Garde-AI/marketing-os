# Brand Conversion Design Agent — Build Plan (Overview)

**Source spec:** Brand Conversion Design Agent Technical PRD v1.1
**Status (2026-06-13):** Phases **0 + 1 shipped** (stub tier) in `packages/design-loop` + the steered GH-runner planner. Build/typecheck/tests/bench all green; live I/O adapters and npm publish are the open items. Next: Phase 2 (Design MCP client + capture-bundle upload) and live-adapter validation.
**This repo's role:** the **experience plane** — the OSS Mastra harness that runs in the client environment.
**Companion (out of scope here):** `marketing-os-agents` — the **knowledge plane** (Design ontology, Design MCP, skill library, eval/bench). We build *against* its contracts; we do not build it.

> This overview maps the PRD's 9 build phases onto **what actually exists in this repo today**, names the one architectural decision Phase 0 must resolve, and tracks the external dependencies that gate each phase. Per-phase detail lives in the sibling docs.

---

## 1. As-built reality (what we are extending)

The PRD talks about "the Mastra harness in the client's environment." In this repo that is **not a standalone app** — it is a **template** the CLI scaffolds into a client's Shopify theme repo:

| Thing | Location | State today |
|-------|----------|-------------|
| CLI scaffolder | `packages/marketing-os/` (`@avant-garde/marketing-os` v0.6.0, published) | Scaffolds the harness via `create` / `init` |
| **The harness** (ships to clients) | `packages/marketing-os/templates/agents/` | Next.js 15 + Mastra console |
| Mastra instance | `…/templates/agents/src/mastra/index.ts.hbs` | `@mastra/core ^1.42.0`, agents: `marketingAgent`, `creativeAgent` |
| Conversational agent | `…/src/mastra/agents/marketing-agent.ts.hbs` | model `anthropic/claude-sonnet-4-6`, tools + memory |
| Tools | `…/src/mastra/tools/` | `shopify-admin`, `ga4-reporting`, `meta-ads`, `dispatch-to-github`, `pr-status` |
| Skills | `…/src/mastra/skills/` + `_registry.ts.hbs` | registry pattern: `{metadata, inputSchema, outputSchema, tool}` |
| Shopify client | `…/templates/agents/lib/shopify.ts` | broker-aware (Spec 12 token broker → falls back to access token) |
| Dev server | `…/templates/agents/scripts/dev/start.sh` | runs Next on `:3000`, `shopify theme dev` on `:9292` (`--shopify`) |
| **Code-editing agent** | `…/templates/.github/workflows/marketing-os-agent.yml` | **Claude Code (`anthropics/claude-code-action@v1`) in GitHub Actions** |
| PR review | `…/templates/.github/workflows/marketing-os-review.yml` | Claude Code reviews Liquid PRs |

**Two execution surfaces exist, neither is the PRD's design coding agent yet:**

1. **Console (Mastra, on client Vercel):** conversational. When asked to change the storefront it does **not** edit code — it calls `dispatch-to-github` to open an issue. Serverless; no persistent browser or theme server.
2. **CI (Claude Code in GHA):** the thing that *actually edits Liquid* and opens PRs, triggered by the issue. Ephemeral runner; **can** run `shopify theme dev` + a headless browser + screenshot within a job.

The PRD's Phase B agent — *read `brand-design.md` → consult Design MCP → edit theme → render → **see it** → refine → PR* — is a **new capability** that overlaps the CI surface, not the console.

---

## 2. Topology: planner orchestrator → design-code deep agent (RESOLVED)

The VLM + agent-browser + Shopify dev-loop needs three things alive at once: a **running theme preview**, a **headless browser** (Playwright), and a **VLM critic** endpoint. That rules out the serverless console — it has to run where there's a real workspace: the **GH runner**.

**Resolved architecture** (full design in `agent-topology-and-contract.md`):

- **Planner / orchestrator = Claude Code in an updated GH runner.** General-purpose. Interprets the ad-hoc store-improvement request, plans it, owns the PR — and is **steered to delegate all code implementation**, never editing Liquid itself.
- **Implementer = a design-code _deep agent_ on the Mastra harness.** Narrow, maniacal, on-brand conversion-driven Liquid implementation. Has its own planner-within + **managed sub-agents** + the dev-loop as its execution core. Invoked by the planner as a managed sub-agent.
- **Engine = `packages/design-loop/` (Phase 0).** The render→see→refine mechanic the implementer drives; its outputs map 1:1 onto the work contract.
- **Contract = the Design Work Contract.** A versioned, parent-agnostic protocol (TaskSpec ↓ / ProgressEvent ↑ / WorkReport ↑ / RevisionSpec ↓) over **MCP** (CLI fallback). The implementer reports its work upward so the planner updates its plan from the report.

This supersedes the earlier A/B/C options: the dev-loop is built as the standalone `packages/design-loop/` package (the old "C"), wrapped by the Mastra deep agent, and driven by the Claude-Code planner via the contract (a sharper "A"). A pure Mastra-native planner ("B") can replace Claude Code later behind the same contract without rework.

**Continual fine-tuning** is staged (PRD §0 forbids RL-ing taste into weights in v1): v1 = skill/prompt/graph optimization from WorkReport traces; later = a distilled/fine-tuned implementer model swapped behind the same MCP contract. See `agent-topology-and-contract.md` §5.

---

## 3. PRD phase → repo mapping

| PRD Phase | Deliverable | Lands in this repo at | Detail doc |
|-----------|-------------|------------------------|------------|
| **0** | Shopify dev-loop subsystem (VLM + agent-browser + preview + visual-diff + bounded refine) + work-contract schemas | new `packages/design-loop/` | `phase-0-dev-loop.md` |
| **1** | Design-code **deep agent** (Mastra) + MCP/CLI delegation surface + steered Claude-Code planner in GH runner + the Design Work Contract | `templates/agents/src/mastra/` (deep agent) + `design-code-agent` MCP server + `templates/.github/workflows/` | `agent-topology-and-contract.md` + `phases-1-8-roadmap.md` |
| **2** | Design MCP client + capture-bundle contract | `templates/agents/src/mastra/` MCP client; capture-bundle producer in `design-loop` | `phases-1-8-roadmap.md` |
| **3** | Guided Brand Definition flow + `brand-design.md` authoring/commit | new console flow in `templates/agents/` + a brand-definition agent | `phases-1-8-roadmap.md` |
| **4** | Skill-library integration (pinned pull + invoke) | extend `lib/skills.ts` + `_registry` with versioned remote skill-set pull | `phases-1-8-roadmap.md` |
| **5** | NeuroGraph MCP persona fork | new MCP client; persona → `brand-design.md §2`; reconciliation PRs | `phases-1-8-roadmap.md` |
| **6** | Measure-better instrumentation (emit traces, client-side scrub) | trace emitter in `design-loop` + console; de-id before egress | `phases-1-8-roadmap.md` |
| **7** | Release pipeline + canary cohort | `packages/marketing-os` release flow + changesets + bench gate | `phases-1-8-roadmap.md` |
| **8** | Conformance gate + pixel polish + dark-pattern processor | deterministic output-processor in `design-loop`; rubric in MCP call | `phases-1-8-roadmap.md` |

**MVP cut (PRD):** Phases 0–3 = shippable onboarding MVP. 4–8 = persona grounding, network learning, release machine.

---

## 4. External dependencies (knowledge plane) — gating status

These come from `marketing-os-agents`. We build against **stubs/contracts** until they land. Phase 0's exit is a **bench pass against a stub**, so Phase 0 is **not** blocked.

| Dependency | Needed by | Phase-0 workaround |
|------------|-----------|--------------------|
| Design ontology spec | conformance semantics | local stub rubric (a11y + token fidelity + dark-pattern) |
| Design MCP server + §4.1 contract | Phase 2+ | local mock implementing the 5 tools, fixed responses |
| Capture-bundle ingestion (signed URLs) + §4.2 schema | Phase 2/6 | write bundle to local dir matching §4.2 layout |
| Skill Library v0 + release mechanism | Phase 4 | n/a (Phase 0 has no skills) |
| Bench runner + smoke/full suites (§4.6) | Phase 0 exit, Phase 7 gate | **build a minimal local bench harness + stub cases** |
| Trace ingestion endpoint + de-id boundary | Phase 6 | emit traces to local JSONL |

**Action:** open the §4.1 (Design MCP) and §4.2 (capture-bundle) contract shapes with the knowledge-plane team early — Phase 2 hard-depends on them and Phase 0 should produce capture bundles in the agreed §4.2 shape from day one to avoid rework.

---

## 5. Hard requirements carried from the PRD (don't drop these)

- **Bounded refine loop**, default **N=4**, then escalate with best candidate + critique (PRD §1 Phase B). Runs on client token budget.
- **No dark patterns** enforced **mechanically** — deterministic output-processor blocklist (countdown timers, fake stock counters, confirmshame copy, pre-checked upsells) **+** a rubric item. Not a doc note (PRD §3, §8).
- **Accessibility floor** = WCAG, zero-tolerance in the release gate (PRD §7, §9).
- **Asset boundary:** never reproduce a scraped brand's assets/copy; abstain-and-redirect is the only pass on "recreate brand X's hero" (PRD §4.4) — becomes a bench red-team case.
- **Capture bundle is the single evidence artifact** for both conformance and traces (PRD §4.2).
- **Version vector** stamped on every trace: agent × skill-set × MCP snapshot × brand-doc (PRD §6).
- **Model serving is endpoint-configurable** — OSS accepts any endpoint; hosted points at central GCP (PRD §3).

---

## 6. Sequencing & definition of done

**Build order:** 0 → 1 → 2 → 3 (MVP) → then 4–8.
Phase 0 is the de-risk gate: until the agent can *see and improve its own output against a target within N iterations*, nothing downstream matters.

**MVP done =** a store owner can run a guided brand definition → `brand-design.md` committed → the agent makes ≥1 visible on-brand improvement via the bounded visual loop → change lands as a reviewed PR (PRD §8 "immediate proof").

**Next:** see `phase-0-dev-loop.md` to start.
