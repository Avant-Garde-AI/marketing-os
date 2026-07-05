> **STATUS (2026-06-13): SHIPPED (stub tier).** `packages/design-loop` built; contract, gates, conformance merge, bounded loop, deep agent, delegation surface, and the bench all green (14/14 vitest, bench 6/6). Live I/O adapters (theme-dev, Playwright capture) authored but not yet exercised against a real store. Phase 1 (delegation + steered planner) shipped on top — see `agent-topology-and-contract.md`. Commits `e3fcdf0`, `1fe21fe`.

# Phase 0 — Shopify Dev-Loop Subsystem (detailed, executable)

**Goal:** the core mechanic. An agent that **renders a Shopify theme change, sees its own output via a VLM, and iterates toward a target within a bounded loop.** De-risk this before anything else (PRD §9).

**Exit criterion (PRD §4.6):** a **bench pass** — the loop runs end-to-end against a stub bench case and the bounded refine + conformance gate behave correctly. Stub knowledge is fine.

**Architectural decision (from OVERVIEW §2): build as a standalone subsystem** (`packages/design-loop/`) with a clean programmatic + CLI entry, model-endpoint-configurable. In the resolved topology (`agent-topology-and-contract.md`) this package is the **execution core of the Phase 1 design-code deep agent** — its outputs (capture bundle, conformance, loop health) map 1:1 onto the `WorkReport` the agent returns to the Claude-Code planner. So Phase 0 also defines the **Design Work Contract schemas** here, since the loop already computes most of their fields.

---

## 1. Subsystem shape

New workspace package: **`packages/design-loop/`** (`@avant-garde/design-loop`).

```
packages/design-loop/
  package.json            # @avant-garde/design-loop; deps: playwright, sharp, pixelmatch, zod
  src/
    index.ts              # programmatic entry: runDesignLoop(opts)
    cli.ts                # `design-loop run --target … --page … --max-iters 4`
    config.ts             # model endpoints (designer + critic), loop bounds, ports — all env/flag-driven
    preview/
      theme-dev.ts        # start/stop `shopify theme dev`, wait-for-ready, port mgmt
      render.ts           # navigate + wait for a page to be stable
    capture/
      browser.ts          # Playwright launch, viewport matrix 390/768/1440
      capture-bundle.ts   # PRODUCE the §4.2 capture bundle (screenshots/tokens/dom-segments/manifest)
      computed-styles.ts  # extract tokens.json (colors/type/spacing in use)
      dom-segments.ts     # classify page regions → section vocabulary
    critic/
      vlm-critic.ts       # call VLM endpoint with screenshots → structured conformance read
      visual-diff.ts      # pixelmatch vs baseline/target → diff score + regions
      conformance.ts      # merge VLM + deterministic checks → ConformanceResult
    deterministic/
      a11y.ts             # WCAG floor checks (contrast, alt, focus order) from DOM/tokens
      token-fidelity.ts   # tokens.json vs brand tokens
      dark-pattern.ts     # OUTPUT-PROCESSOR blocklist (PRD §3/§8) — deterministic, hard-fail
    loop/
      refine-loop.ts      # propose→implement→render→inspect→refine; bounded N=4; escalate-with-best
      escalation.ts       # package best candidate + critique when bound hit
    types.ts              # shared zod schemas (CaptureBundle, ConformanceResult, LoopResult)
  bench/
    runner.ts             # minimal local bench runner (smoke tier)
    cases/                # stub cases incl. red-team "recreate brand X" (must abstain)
    fixtures/             # demo-store theme snapshot (reuse examples/demo-store)
  test/
  README.md
```

Reuse `examples/demo-store/` (existing Liquid theme) as the bench fixture so the loop has a real theme to render.

---

## 2. Components & responsibilities

### 2.1 Preview render path (`preview/`)
- Wrap `shopify theme dev` (the same invocation `scripts/dev/start.sh` already uses on `:9292`). Add programmatic start, **wait-for-ready** poll, and clean teardown.
- `render.ts`: given a page path, navigate and wait for network-idle + fonts-loaded + layout-stable before capture (pixel-perfect work needs stable frames).

### 2.2 Capture bundle (`capture/`) — **conform to PRD §4.2 from day one**
Produce exactly this layout (so Phase 2/6 ingestion needs no rework):
```
capture_bundle/
  screenshots/   # 390/768/1440 full-page + above-fold + interaction states
  tokens.json    # computed-style extract (colors, type, spacing in use)
  dom-segments.json  # regions classified to section vocabulary
  manifest.json  # page, theme ref, commit, agent version vector
```
- `manifest.json` carries the **version vector** (PRD §6): agent × skill-set × MCP snapshot × brand-doc — stub the fields now, populate as phases land.
- Bundle is **passed by reference** (local path now; signed GCS URL in Phase 2) — never inlined.

### 2.3 Critic (`critic/`)
- `vlm-critic.ts`: model-endpoint-configurable (PRD §3). Default to a Claude vision model via `config.ts` endpoint; OSS users can point elsewhere. Input = screenshots (by reference/base64), target/spec, brand context. Output = structured `ConformanceResult`.
- `visual-diff.ts`: deterministic pixel diff vs a target/baseline image using `pixelmatch` — feeds "visual outcome" (PRD §6) and visual-regression (don't silently break existing pixel-perfect work).
- `conformance.ts`: combine VLM read + deterministic checks into one `ConformanceResult { score, passed, flags[], darkPatternHits[], a11yViolations[] }`.

### 2.4 Deterministic gates (`deterministic/`) — **mechanical, not aspirational**
- `dark-pattern.ts`: blocklist scan over rendered DOM/copy — countdown timers, fabricated stock counters, confirmshame copy, pre-checked upsells. **Hard-fail** regardless of any "lift" (PRD §3/§8). This is an output-processor, runs every iteration.
- `a11y.ts`: WCAG floor (contrast ratios from tokens, alt text, focus order). Zero-tolerance feeds the release gate later.
- `token-fidelity.ts`: compare `tokens.json` against declared brand tokens.

### 2.5 Bounded refine loop (`loop/`)
- `refine-loop.ts`: `propose → implement → render → capture → conform → refine`, **capped at N=4** (default, configurable). On each iteration keep the best-scoring candidate.
- On bound hit: `escalation.ts` packages **best candidate + critique** and returns rather than spinning (PRD §1 Phase B hard requirement).
- The "implement" step is an injected callback (the code-editor) — Phase 0 uses a **stub implementer** (applies a scripted edit) so the loop is testable without a full coding agent. Phase 1 injects the real GHA Claude Code editor.

### 2.6 Bench (`bench/`) — the exit gate
Minimal local runner (full version comes from knowledge plane later, PRD §4.6):
- **smoke cases:** loop converges on a simple target; loop respects N=4 + escalates; visual-diff detects a regression; dark-pattern case hard-fails; a11y violation caught.
- **red-team case:** "recreate brand X's hero" → only passing behavior is **abstain-and-redirect** (PRD §4.4).
- `runner.ts` prints pass/fail per case; this is what Phase 0 "exits on a bench pass" means.

---

## 3. Key interfaces (zod, in `types.ts`)

```ts
// Conform to PRD §4.2 / §4.1 so the Design MCP can consume these unchanged later.
CaptureBundleRef     // { path | url, manifest }
ConformanceResult    // { score:number, passed:boolean, flags[], darkPatternHits[], a11yViolations[], visualDiff }
LoopResult           // { accepted:boolean, iterations:number, best:CaptureBundleRef, critique, escalated:boolean }
DesignLoopOptions     // { page, target, brandContext, maxIters=4, implement: (ctx)=>Promise<void>, endpoints }
```
`validate_design_conformance` (Design MCP, Phase 2) will eventually replace the local `conformance.ts` — keep the **return shape identical** so the swap is a config change.

---

## 4. Task breakdown (execution order)

1. **Scaffold** `packages/design-loop/` package + add to `pnpm-workspace.yaml` + `turbo.json`; wire tsconfig/tsup/vitest to match repo conventions.
2. **types.ts** — lock the zod schemas (CaptureBundle, ConformanceResult, LoopResult) against PRD §4.1/§4.2.
3. **preview/** — programmatic `shopify theme dev` wrapper + stable-page render, against `examples/demo-store`.
4. **capture/** — Playwright capture at 3 viewports + computed-styles + dom-segments + manifest → write a §4.2-shaped bundle.
5. **deterministic/** — dark-pattern blocklist (first, it's the hard gate), a11y floor, token fidelity.
6. **critic/** — visual-diff (pixelmatch) then VLM critic (endpoint-configurable) → conformance merge.
7. **loop/** — bounded refine loop with stub implementer + escalation.
8. **bench/** — runner + stub cases incl. red-team; **make it green** (= Phase 0 exit).
9. **README** — how to run locally + how Phase 1 injects the real implementer.

---

## 5. Risks specific to Phase 0

- **`shopify theme dev` in CI/headless** can be slow/flaky to boot and needs store auth. Mitigate: cache theme, generous wait-for-ready, and a "static render" fallback for bench fixtures that don't need live store data.
- **VLM latency** (1–3s/critic call, PRD §3) × N iterations × 3 viewports adds up — batch viewports into one critic call where possible; the loop tolerates it because calls interleave with render+capture.
- **Capture-bundle schema drift** vs the knowledge plane's eventual §4.2 — lock the shape with that team *before* step 4, or accept a later migration.
- **Determinism of dark-pattern/a11y checks** — keep them rule-based and unit-tested; never route these through the VLM (they must be reproducible for the release gate).

---

## 6. Ready-to-start checklist

- [ ] Confirm decision C (standalone `packages/design-loop/`) — or override to A/B.
- [ ] Confirm Playwright + `pixelmatch` + `sharp` as the capture/diff stack (vs the harness-level `agent-browser` skill).
- [ ] Confirm the VLM critic default endpoint for local dev (Claude vision via existing Anthropic config in `lib`/`services`).
- [ ] Lock the §4.2 capture-bundle shape with the knowledge-plane team (async; don't block scaffold).

First execution step when greenlit: **task 1 — scaffold `packages/design-loop/`**.
