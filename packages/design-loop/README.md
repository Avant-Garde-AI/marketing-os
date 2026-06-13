# @marketing-os/design-loop

The **design-code deep agent** for Marketing OS: the render → see → refine engine
for on-brand, conversion-driven Shopify theme implementation, plus the **Design
Work Contract** that lets a general-purpose planner (Claude Code in the GH
runner) delegate implementation to it.

Plan & rationale: `docs/plans/brand-conversion-design-agent/`.

## What's here

- **The contract** (`./contract`) — `TaskSpec` / `ProgressEvent` / `WorkReport` /
  `RevisionSpec` zod schemas. Parent-agnostic; the same shapes back the MCP
  server and the CLI.
- **The deep agent** (`runDesignAgent`) — decomposes a `TaskSpec` into
  per-page/section sub-tasks, runs the bounded refine loop for each, and merges
  the results into one `WorkReport`.
- **The refine loop** (`runRefineLoop`) — propose → implement → render → capture →
  conform → refine, capped at N iterations (default 4), escalate-with-best on the
  cap, `rejected` on a guardrail/asset-boundary refusal.
- **Deterministic gates** — dark-pattern blocklist (output-processor), WCAG
  accessibility floor, token fidelity. Rule-based, never routed through a model.
- **Delegation surface** — `DelegationService` (in-process registry, async +
  progress), an MCP server (`pnpm mcp`), and a CLI (`design-code-agent run`).

## Architecture: logic vs. I/O

All **logic** (contract, loop, deep agent, gates, conformance merge, delegation)
is fully typed and tested with **injectable providers** — no browser, no model,
no Shopify needed. The **I/O adapters** (Playwright capture, `shopify theme
dev`, a VLM critic endpoint, pixelmatch diff, the MCP transport) are thin,
lazy-loaded glue in `src/adapters/` (marked `@ts-nocheck`) and declared as
**optional dependencies**, so the package builds and tests run with zero heavy
deps installed.

```
TaskSpec ─▶ DelegationService ─▶ runDesignAgent ─▶ runRefineLoop ─▶ WorkReport
                                       │                 │
                                       └─ decompose      ├─ Implementer  (stub | LLM)
                                                         ├─ CaptureProvider (stub | Playwright)
                                                         ├─ CriticProvider  (stub | VLM)  ┐
                                                         └─ gates (deterministic) ────────┴─▶ ConformanceResult
```

`ConformanceResult` matches the Design MCP `validate_design_conformance` return
shape, so the local merge can be swapped for the hosted MCP call (set
`DESIGN_MCP_ENDPOINT`) without changing callers.

## Run

```bash
pnpm --filter @marketing-os/design-loop build
pnpm --filter @marketing-os/design-loop test

# CLI (stub providers — no external deps):
node dist/delegation/cli.js run --task task.json --report report.json --stub

# MCP server (needs @modelcontextprotocol/sdk; what the GH-runner planner connects to):
pnpm --filter @marketing-os/design-loop mcp
```

A live run (`DESIGN_LOOP_REAL=1` + a configured critic endpoint + `shopify theme
dev`) uses the real adapters; otherwise the stub providers run deterministically.
