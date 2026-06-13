# Phases 1–8 — Roadmap (lower fidelity; detail each at start)

Each phase gets its own detailed doc when it's next up. This captures repo mapping, the key decision, and the carry-over requirements so sequencing stays honest.

---

## Phase 1 — Design-code deep agent + planner delegation + work contract

> Full design: `agent-topology-and-contract.md`. This re-scopes the old "git-native coding agent" into the orchestrator/sub-agent topology.

**Deliverable (four parts):**
- **(a) Design-code deep agent (Mastra):** wraps `@marketing-os/design-loop` as its execution core; has a planner-within, managed sub-agents (per section/page), and todo/scratch fs. Injects the real code-writing implementer into `refine-loop.ts` (replacing Phase 0's stub).
- **(b) Delegation surface:** expose the deep agent as the `design-code-agent` **MCP server** (`implement_design_change` / `get_work_report` / `revise_design_change`, async + progress) with a **CLI fallback**. Schemas = the contract.
- **(c) Steered planner:** update the GH runner (`templates/.github/workflows/marketing-os-agent.yml`, already runs `anthropics/claude-code-action@v1`) so Claude Code is the **planner** — delegation tool wired in, and Liquid/section/template/asset **edit tools removed from `allowedTools`** so it *cannot* hand-edit theme code. CLAUDE.md instructs delegate-don't-implement. Planner owns the PR + plan. Console `dispatch-to-github` stays the trigger.
- **(d) Design Work Contract:** implement TaskSpec → WorkReport end-to-end (+ ProgressEvent, RevisionSpec), so the planner updates its plan from the report.

**Key decision:** MCP-primary vs CLI-primary delegation transport. Recommend MCP (parent-agnostic; consistent with Design/NeuroGraph/Store MCPs) with CLI as the no-MCP fallback.

**Carry-over:** bounded N=4 + escalate-with-best surfaces via `WorkReport.status="escalated"`; capture bundle on every report; visual-regression vs main; `status="rejected"` is the guardrail/asset-boundary success path.

---

## Phase 2 — Design MCP client + capture-bundle contract  ✅ SHIPPED (mock tier, 2026-06-13)

**Built:** `DesignKnowledge` interface for all 5 §4.1 tools with `MockDesignKnowledge` (deterministic) + `RemoteDesignMcp` (@ts-nocheck MCP client); client-side `assertAbstracted` asset-boundary guard. `BundleUploader` (PRD §4.2) with `localUploader`/`mockSignedUrlUploader`/remote signed-URL uploader. Conformance now routes through `validate_design_conformance` when a `DesignKnowledge` is present (`source=design-mcp`) while **local deterministic gates stay authoritative (veto)**; the bundle is uploaded and passed **by reference**. `DesignKnowledge` also threaded into `ImplementInput` so the implementer can consult conventions/patterns mid-implementation. 18/18 tests, bench 6/6, build/typecheck clean. `buildProviders` auto-wires the remote MCP + uploader when `DESIGN_MCP_ENDPOINT` / `CAPTURE_BUNDLE_UPLOAD_URL` are set (already passed through in `design-code-agent.mcp.json`). **Open:** validate against the real hosted Design MCP once the knowledge-plane contract is final.

---

**Original deliverable:** consume PRD §4.1 (5 tools) and §4.2 (capture bundle, signed-URL upload).

**Lands in:** an MCP client in `templates/agents/src/mastra/` (Mastra MCP client) for the conversational/decision-point calls, and a capture-bundle **uploader** in `design-loop` (local path → signed GCS URL). Swap `design-loop`'s local `conformance.ts` for `validate_design_conformance` (same return shape — see Phase 0 §3).

**Key decision:** Mastra MCP client vs a thin direct client. Use Mastra's so the console agent and loop share one MCP config.

**Dependency:** Design MCP server + signed-URL issuance from the knowledge plane. Mock until then.

---

## Phase 3 — Guided Brand Definition flow + `brand-design.md`  ✅ SHIPPED (2026-06-13)

**Built:** `src/brand/` in design-loop — `BrandDesignDoc` schema (§2 front-matter + 9 sections); lossless `serialize`/`parse`; `draftBrandDesign` (MCP-grounded first pass via `DesignKnowledge`); `PersonaSource` fork (`elicitedPersona` + `neurographPersonaStub`, the §4.5 seam); `toBrandContext` bridge so `brand-design.md` becomes the loop's north star; `Committer` (`memoryCommitter` + GitHub-contents commit in the template). Console wiring in `templates/agents`: `brand-definition-agent.ts` (conversational, generated-with-the-human, commits only on approval, offers immediate-proof improvements) + `tools/brand-design.ts` (`draft-brand-design` / `commit-brand-design` via GitHub Contents API) + registered in the Mastra instance + `@marketing-os/design-loop` added to `package.json.hbs` (pending publish). 24/24 tests incl. round-trip + persona fork + bridge + commit. **MVP (Phases 0–3) complete.**

---

**Original deliverable:** the onboarding hook (PRD §1 Phase A, §2 schema, §8). Conversational, co-creative; converges to `brand-design.md` with the §2 front-matter and 9 sections; **commits it to the client repo**.

**Lands in:** the console — a new brand-definition agent/flow in `templates/agents/` (`src/mastra/agents/` + an onboarding UI route under `app/`). Uses Design MCP (Phase 2) for category-grounded proposals ("brands in your category lead with X"). Commits via the existing GitHub lib.

**Key decision:** dedicated agent vs extending `marketingAgent`. Dedicated — different system prompt, interview behavior, and it owns `brand-design.md`.

**Carry-over:** generated-*with*-the-human (approval is the point); material updates = reviewed commits, never silent mutation; NeuroGraph-not-connected is the lead-gen moment (graceful, never a gate).

**MVP boundary:** Phases 0–3 complete = shippable onboarding MVP. Add "immediate proof" (PRD §8): right after commit, run the loop for 1–2 visible on-brand wins.

---

## Phase 4 — Skill-library integration (pinned pull + invoke)  ✅ SHIPPED (2026-06-13)

**Built:** `src/skills/` in design-loop — `DesignSkill`/`SkillSet`/`SkillManifest`/`SkillSetPin` model; bundled **v0 skill-set** (establish-type-scale, build-pdp-above-fold, implement-hero-section, apply-spacing-system, responsive-breakpoint-pass, collection-grid-system); `SkillSetSource` with `LocalSkillSetSource` (honors pin, rejects mismatch) + `RemoteSkillSetSource` (@ts-nocheck tarball/OCI pull); `selectSkills(intent, sections)` ranked, with "all" as a compatibility bonus not a trigger. Wired through: `buildProviders` pins+pulls the set at session start (local default, remote when `DESIGN_SKILLSET_REGISTRY` set); the refine loop selects per sub-task and passes skills to `ImplementInput`; the deep agent aggregates `WorkReport.provenance.skillsInvoked` and stamps `versionVector.skillset` from the pinned set. 29/29 tests (selection, pull/pin, provenance, version stamp) + bench 6/6. **Open:** real remote skill-set registry + the §5 skill-optimization loop (Phase 6+ traces feed it).

---

**Original deliverable:** pull a versioned skill-set artifact (tarball/OCI + manifest), pin in config, load at session start, invoke (PRD §4.3).

**Lands in:** extend `templates/agents/lib/skills.ts` + `_registry.ts.hbs` with a **remote, versioned** source on top of today's local-dir loader. Add skill-set version to config + the version vector.

**Key decision:** artifact format (tarball vs OCI) + where pulled skills cache. Joint with knowledge-plane team (PRD §10 open Q2 — `SKILL.md` schema).

**Dependency:** Skill Library v0 + release mechanism.

---

## Phase 5 — NeuroGraph MCP persona fork

**Deliverable:** when connected, pull the PDO persona via the **existing NeuroGraph MCP** into `brand-design.md §2` pinned `ref@version`; score conformance against the real concept graph; **reconciliation PR** on persona updates (PRD §4.5).

**Lands in:** a second MCP client (NeuroGraph) in the console; persona-sync watcher → opens a PR flagging affected sections (§2/§6/baselines). The NeuroGraph MCP already exists (this session has it connected) — **no bespoke API**, consume its persona/concept-graph tools.

**Key decision:** none architectural — reuse the Phase 2 MCP-client plumbing. Confirm which NeuroGraph tools map to "persona retrieval / concept-graph / scenario context."

**Carry-over:** never silent mutation — owner ratifies reconciliation PRs.

---

## Phase 6 — Measure-better instrumentation

**Deliverable:** emit the PRD §6 trace per design action (skill/pattern provenance, loop health, conformance pre/post, visual outcome, owner signal, conversion anchor, version vector) to the knowledge-plane ingestion endpoint.

**Lands in:** a trace emitter that **consumes `WorkReport`s directly** — `provenance`, `version_vector`, `loop_health`, and `conformance` are already contract fields (see `agent-topology-and-contract.md` §3.2), so most of §6 is "serialize the WorkReport + de-id." Plus console hooks (owner accept/reject). **Client-side scrub** brand tokens/copy before egress; de-id at ingestion (PRD §5 boundary).

**Key decision:** scrub list + consent/config surface (per-client, configurable). Traces to local JSONL until the endpoint exists.

**Dependency:** trace ingestion endpoint + de-id boundary.

---

## Phase 7 — Release pipeline + canary cohort

**Deliverable:** central, bench-gated weekly releases; staged canary → recommended; clients pin + pull on their schedule (PRD §7).

**Lands in:** `packages/marketing-os` release flow (changesets already present) + a bench gate in CI (full tier from knowledge plane) + a recommended-version signal + changelog with bench deltas. Skill-set and MCP-snapshot releases ride the same discipline; compatibility in manifests.

**Key decision:** canary cohort composition + promotion criteria (PRD §10 open Q3). Arthaus is the natural first canary (per architecture memory).

**Carry-over:** a11y zero-tolerance; previously-fixed bench cases re-failing block unconditionally; nothing auto-mutates a client env.

---

## Phase 8 — Conformance gate + pixel polish + dark-pattern processor

**Deliverable:** the quality bar — conformance gate before present, pixel-perfect iteration polish, deterministic dark-pattern output-processor (PRD §3/§8).

**Lands in:** mostly hardening `design-loop` (`deterministic/dark-pattern.ts`, `conformance.ts`) + the rubric item in the Design MCP call. Much of this is *seeded* in Phase 0 and *tightened* here once real outcome data (Phase 6) shows where the loop produces rework.

**Key decision:** none new — this is where the network learning loop (PRD §5) starts feeding skill refinement; depends on Phase 6 traces flowing.

---

## Track F (post-MVP) — Continual fine-tuning of the implementer

> Not a v1 deliverable. PRD §0 forbids RL-ing taste into weights up front; this is the *earned* later stage. Full rationale in `agent-topology-and-contract.md` §5.

**Staged:** (1) v1 — skill refinement + prompt/loop optimization + graph enrichment from WorkReport traces (PRD §5, no weight changes). (2) Later — distill, then fine-tune, a narrow **implementer** model on the accumulated WorkReport + outcome corpus (conformance + conversion anchor = reward signals), swapped **behind the same MCP contract** so the planner/harness don't change. (3) Gate every model swap through the bench (§7); the contract is the reversible seam.

**Why tractable here (unlike "taste"):** the implementer is narrow, contract-bounded, and fully instrumented (deterministic gates + conformance + conversion anchor), so it has a real reward signal — the whole point of concentrating design work in a specialist sub-agent.

---

## Cross-phase invariants (never drop)

- Bounded loop (N=4 default) + escalate-with-best.
- Dark patterns + a11y = **mechanical** gates, not doc notes.
- Asset boundary: abstain-and-redirect on "reproduce brand X"; regression-tested.
- Capture bundle = single evidence artifact (conformance + traces).
- Version vector on every trace.
- Model endpoints configurable; hosted points at central GCP.
- Nothing auto-mutates a client environment; brand-doc changes are reviewed commits.
