# Agent Topology & Work Contract (orchestrator ↔ design-code deep agent)

**Status:** design — refines OVERVIEW §2 (resolves the "where does the dev-loop run" decision).
**Origin:** the build is a **design-code deep agent** (Mastra harness) that a **general-purpose planner (Claude Code in the GH runner)** delegates implementation to, as a managed sub-agent, over a **formal work contract** so the planner can update its plan from the report.

---

## 1. The topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  Updated GitHub runner (client repo, ephemeral)                      │
│                                                                       │
│  ┌──────────────────────────┐        Design Work Contract           │
│  │  PLANNER / ORCHESTRATOR  │  ── TaskSpec ───────────────▶          │
│  │  Claude Code             │  ◀── ProgressEvent (n) ─────  ┌──────────────────────────┐
│  │  (claude-code-action)    │  ◀── WorkReport ────────────  │  IMPLEMENTER             │
│  │                          │  ── RevisionSpec ───────────▶ │  Design-Code Deep Agent  │
│  │  - reads issue/intent    │                               │  (Mastra harness)        │
│  │  - plans store change    │                               │                          │
│  │  - delegates code impl   │                               │  planner-within +        │
│  │  - CANNOT edit Liquid    │                               │  managed sub-agents +    │
│  │    directly (steered)    │                               │  todo/fs                 │
│  │  - owns the PR + plan    │                               │      │                   │
│  └──────────────────────────┘                               │      ▼                   │
│            ▲                                                 │  @marketing-os/          │
│            │ shared git workspace (same checkout)            │  design-loop  (Phase 0)  │
│            └─────────────────────────────────────────────── │  render→see→refine, N=4  │
│                                                              └──────────────────────────┘
│                                                                     │ consults             │
│                                                       Design MCP ◀──┤ NeuroGraph MCP ◀─────┘
│                                                       (knowledge)   skills lib  (persona)   │
└─────────────────────────────────────────────────────────────────────┘
```

**Roles**
- **Planner (Claude Code):** general-purpose. Interprets the ad-hoc store-improvement request, decomposes it into a plan, and **delegates each code-implementation unit** to the implementer. Owns the PR and the plan. **Does not write Liquid itself.**
- **Implementer (design-code deep agent, Mastra):** maniacal, narrow, on-brand conversion-driven Liquid implementation. A *deep agent* — it has its own planner-within, can fan out **managed sub-agents** (e.g. one per section/page), a todo/scratch filesystem, and the `design-loop` engine as its execution core. Reports back via the contract.
- **Engine (`packages/design-loop`, Phase 0):** the render→see→refine mechanic the implementer drives. The loop's "implement" callback is the deep agent's code-writing step; the loop's output (capture bundle + conformance + loop health) becomes the bulk of the WorkReport.

**Why this resolves OVERVIEW §2:** the dev-loop lives inside the implementer deep agent; the implementer runs in the same GH runner as the planner (shared git checkout, so the planner sees the diff). The planner stays a thin general-purpose orchestrator; design quality is concentrated in the specialist.

---

## 2. Delegation surface (how the planner calls the implementer)

**Primary: MCP** (parent-agnostic — *any* MCP-speaking orchestrator can drive it, not just Claude Code). The implementer is exposed as an MCP server (`design-code-agent`) whose tool schemas **are** the contract. Mirrors the async idiom already used across this stack (NeuroGraph MCP, Spec 12 Store MCP):

| Tool | Shape | Notes |
|------|-------|-------|
| `implement_design_change(TaskSpec, async_mode=true)` | → `{ task_id, status }` | returns fast; work runs async |
| `get_work_report(task_id)` | → `WorkReport` | poll; carries partial progress while `running` |
| `revise_design_change(task_id, RevisionSpec)` | → `{ task_id }` | planner sends corrections → re-enters loop |
| (progress notifications) | MCP progress stream | optional interim ProgressEvents |

**Fallback: CLI** — `design-code-agent run --task task.json --report report.json` for runners without MCP wiring. Same schemas. Keeps the contract transport-agnostic.

**Steering the planner to delegate (make it mechanical, not aspirational):**
1. CLAUDE.md / system prompt: *"You are the planner. For any storefront code change you MUST call `implement_design_change`; never edit theme files directly."*
2. In the GH runner, restrict Claude Code's `allowedTools` so Edit/Write on `**/*.liquid`, `sections/`, `templates/`, theme assets are **not available** — only Read/plan tools + the delegation tool. The planner *can't* hand-edit Liquid even if it tries.

---

## 3. The Design Work Contract (the protocol)

Versioned zod schemas in `packages/design-loop` (or a shared `@marketing-os/agent-contract` package). `contract_version` on every message. Three message types: **TaskSpec** (down), **ProgressEvent** (interim, up), **WorkReport** (final, up), plus **RevisionSpec** (down, for rework).

### 3.1 TaskSpec — planner → implementer (the work order)
```ts
TaskSpec {
  contract_version: string
  task_id: string
  parent: { id: string, kind: "claude-code" | "mastra" | string }  // parent-agnostic
  intent: string                       // what to achieve, in plain language
  scope: { pages?: string[], sections?: string[], files?: string[] }
  brand_design_ref: { path: string, version: string }              // pinned brand-design.md
  acceptance_criteria: string[]        // how the planner will judge "done"
  constraints: { max_iterations?: number /*=4*/, token_budget?: number, deadline?: string }
  references: {
    design_mcp_snapshot?: string
    skillset_version?: string
    neurograph_persona_ref?: string    // ref@version when connected
  }
  guardrails: { wcag: "AA", no_dark_patterns: true }               // non-negotiable, echoed for audit
}
```

### 3.2 WorkReport — implementer → planner (the contract the planner replans from)
```ts
WorkReport {
  contract_version: string
  task_id: string
  status: "completed" | "escalated" | "blocked" | "rejected"      // rejected = guardrail/asset-boundary refusal
  summary: string                       // planner- and human-readable
  changes: {
    branch?: string; commits: string[]; touched_files: string[]
    diff_stat: { files: number, insertions: number, deletions: number }
    pr_ref?: string                     // usually empty — planner owns the PR
  }
  conformance: ConformanceResult        // design-loop §3 / Design MCP §4.1 — identical shape
  capture_bundle_ref: CaptureBundleRef  // PRD §4.2
  loop_health: {
    iterations: number; max_iterations: number; escalated: boolean
    first_pass_conformance: boolean; best_candidate_critique?: string
  }
  gates: {
    dark_pattern: { passed: boolean, hits: string[] }
    a11y:         { passed: boolean, violations: object[] }
    token_fidelity:{ passed: boolean, drift: object[] }
  }
  unresolved: { sub_task: string, reason: string, suggested_next: string }[]  // → planner replans
  recommendations: string[]             // advice to the planner (e.g. "needs new PDP hero copy from owner")
  provenance: { skills_invoked: string[], patterns_invoked: string[] }        // §6 trace seed
  version_vector: { agent: string, skillset: string, mcp_snapshot: string, brand_doc: string }
}
```

### 3.3 ProgressEvent — implementer → planner (interim, optional)
```ts
ProgressEvent { task_id, ts, phase: "planning"|"implementing"|"rendering"|"critiquing"|"refining",
                iteration?: number, note: string, partial_conformance?: number }
```
Lets a long implementation stream upward so the planner can replan mid-flight (e.g. cancel, re-scope) rather than only at the end.

### 3.4 RevisionSpec — planner → implementer (rework)
```ts
RevisionSpec { task_id, failed_criteria: string[], feedback: string, adjust?: Partial<TaskSpec["constraints"]> }
```

**Contract invariants**
- `status: "rejected"` is a **first-class success of the guardrail system** — asset-boundary ("recreate brand X") and dark-pattern requests return rejected, not a hacked-together attempt (PRD §3/§4.4).
- `escalated` ⇒ the loop hit `max_iterations`; `best_candidate_critique` + `capture_bundle_ref` are populated so the planner can decide (accept best, re-scope, or surface to owner) — PRD §1 Phase B.
- Every WorkReport carries the full `version_vector` and `provenance` → these **are** the §6 measure-better trace; the trace emitter (Phase 6) consumes WorkReports directly.
- The planner, not the implementer, opens the PR (so it can bundle multiple delegated units into one coherent change + plan narrative).

---

## 4. "Deep agent" internals (the implementer)

The implementer is a *deep agent*, not a single prompt:
- **Planner-within:** decomposes a TaskSpec into section/page sub-tasks with its own todo list.
- **Managed sub-agents (plural):** may fan out a sub-agent per section/page, each running the `design-loop` for its slice; results merged into one WorkReport. (The outer planner may *also* spawn multiple implementers in parallel for independent pages — both levels of fan-out are supported because the contract is per-`task_id`.)
- **Scratch filesystem:** working notes, candidate diffs, capture bundles per iteration.
- **Execution core:** `design-loop` (render→see→refine, bounded N=4, escalate-with-best) + Design MCP (knowledge) + skill library (procedures) + NeuroGraph MCP (persona, when connected).

---

## 5. Continual improvement & fine-tuning (reconciling with PRD §0)

PRD §0 is explicit: **v1 does not RL-train taste into weights** — knowledge is externalized to the graph + skill library, improved by the §5 network loop. The "continual fine tuning" of the design-code agent is **staged**, and the topology here is what makes the later stages safe:

1. **Now (v1):** continual improvement = **skill refinement + prompt/loop optimization + graph enrichment** (PRD §5), driven by WorkReport traces (§6). No weight changes.
2. **Later (earned):** because the implementer is **narrow, contract-bounded, and fully instrumented** (deterministic gates + conformance + conversion anchor as reward signals), it is — unlike "taste" — a *tractable* fine-tuning target. A distilled/fine-tuned implementer model can be trained on the accumulated WorkReport + outcome corpus and swapped behind the same MCP contract. The contract is the seam that lets the model improve without the planner or harness changing.

This honors the PRD reframe (don't try to RL taste up front) while giving "continual fine tuning" a real, sequenced path: **skills/prompts → distilled implementer → fine-tuned implementer**, each gated by the bench (§7) and reversible behind the contract.

---

## 6. What this changes in the phase plan

- **Phase 0 (unchanged scope):** still builds `design-loop`. Now explicitly framed as the implementer's execution core; its outputs map 1:1 onto WorkReport fields. Add the contract zod schemas here (or a sibling `@marketing-os/agent-contract`) since the loop already computes most fields.
- **Phase 1 (re-scoped):** was "git-native coding agent." Now = **(a)** build the Mastra design-code deep agent wrapping `design-loop`; **(b)** expose it via the `design-code-agent` MCP server + CLI; **(c)** update the GH runner so Claude Code is the steered planner (delegation tool wired, Liquid-edit tools removed); **(d)** implement the Design Work Contract end-to-end (TaskSpec → WorkReport, async + progress).
- **Phase 6 (simplified):** the trace emitter consumes WorkReports directly — provenance + version_vector + loop_health + conformance are already in the contract.
- **Fine-tuning track:** added to the roadmap as a post-MVP escalation, not a v1 deliverable.
