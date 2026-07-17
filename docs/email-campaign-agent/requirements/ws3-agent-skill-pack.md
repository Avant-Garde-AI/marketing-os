# WS3 — The Agent, the Skill Pack & the Actions

> **Objective:** the `email-campaign` skill pack — artifacts, planning reads, drafting orchestration, instructions — live in the hosted agent for Arthaus, with all four writes gated through the spec 20 Action framework, **which this workstream also builds (R1) because it does not exist**.
>
> **Grounding docs:** 02-ARCHITECTURE.md §1/§3/§5, spec/20 (the contract), spec/24 + `packages/skills/social-media/` (the precedent — mirror its conventions exactly: plain SkillToolDefinitions, factories over bindings, instructions.md sync-tested, vitest), 05-AGENT-LIBRARY-HARDENING.md H2/H5/H6.

## In scope
Spec 20 A0/A1 (contract, gate, audit, nonces, refactor of the two hardcoded approve paths); the pack package; artifact formats + parse/serialize; planning reads; drafting orchestration; the four Actions; `/api/cron/email`; runtime enablement; `skill-kit` extraction (05 H6).

## Out of scope
Console UI (WS4), Klaviyo client internals (WS1-R3), assembly internals (WS2), auto-approve policies (spec 20 OQ1), flows/SMS.

---

## WS3-R1 — Action framework: spec 20 A0 + A1 *(hosted-agents + marketing-os-app; the critical path — start day 1)*

Build spec 20 §2–§4 as specified: the `Action<P>` contract; an action registry; the `propose_action` tool; the gate (scope check → risk tier → `preview()` → spec 17 branded approval card with Approve/Decline → approver/role check → `execute()` → audit + card rewrite + undo offer where declared); `mos_action_audit` table `{action, params, previewHash, approver, at, result}`; **nonce store** binding approval to the previewed instance, invalidated on param/content change. Refactor the two hardcoded approve paths (offer.activate, storefront proposal) onto it — spec 20 A0's own exit test. Implement risk tiers including **high** (admin + confirmation dialog, optional second approver — first exercised by this module, 05 H2).

**Acceptance:**
- Both legacy approve paths run on the framework with zero user-visible change (spec 20 A0's bar).
- A test Action proposed from chat renders a card from its real `preview()` output; approval executes exactly once (nonce replay rejected); audit row complete; decline and nonce-invalidation paths covered.
- Risk=high demands the confirmation step; non-admin approval attempts refused + audited.
- Executes are impossible from tool calls (invariant 2) — enforced structurally, with a test proving the agent cannot reach `execute()`.

**Dependencies:** none upstream; everything downstream. **Recommendation to Garrett (PRD §8 Q2):** treat as an extractable mini-project — social SM2 and spec 21 B2 consume it the day it lands.

## WS3-R2 — Artifact formats *(packages/skills/email-campaign)*

`email/strategy.md`, `email/calendar/{YYYY-MM}.md`, `email/campaigns/{id}/campaign.md` per 02 §3 — YAML-front-matter markdown, parse/serialize round-trip, prose preserved verbatim (mirror `social-media/src/artifacts.ts`). Lifecycle enum `proposed → approved → drafted → scheduled → sent → measured` (+ declined/cancelled/failed).

**Acceptance:** round-trip tests for all three (the social pack's test discipline, 44-test bar); campaign.md carries every field 02 §3 names (audiences with estimated sizes, subjectCandidates, skeletonRef, sections[], utm, klaviyo ids, provenance[]); invalid statuses rejected.

## WS3-R3 — Planning reads *(pack)*

`email_plan_propose` (pure scaffold: strategy cadence × archetype weight rotation across the month, audience rotation under cadenceCaps, seasonal arcs; semantic-layer/readback context woven in when supplied; returns structure + ready-to-propose calendar markdown; **does not write**), `email_calendar_read` (+ gap analysis: unfilled slots, archetype balance, audience over-contact vs caps), `email_campaign_read`. Mirror the social tools' purity discipline (no clocks; month from input).

**Acceptance:** deterministic fixture tests (same strategy+month → same scaffold); every proposed slot carries intent + why; gap analysis flags cap violations; tools registered via `createEmailTools(repo, klaviyo)` with both bindings fakeable.

## WS3-R4 — Drafting orchestration *(pack + hosted-agents wiring)*

The read-side flow that takes an `approved` calendar slot to a draft-ready campaign.md: subject/preview candidates + section copy under brand.md copy formulas (spec 22 D5 front-matter injection — the formulas arrive in context, the pack's instructions enforce their use); section payloads authored for WS2-R2 templates; compose via the surface tools (multi-board, kind `email.campaign`, boundTo campaign id); exports to `campaigns/{id}/assets/`; `email_render_preview` assembling current state behind a guarded hosted route (02 §7). All ungated — drafting is reads + repo writes via `EmailRepo` + surface composition (never an Action, spec 23 §2 — the gate stays at the domain).

**Acceptance:**
- Arthaus dev-run: "draft the new-arrivals campaign" → campaign.md complete with provenance, boards composed on production Penpot, exports in the repo tree, preview URL renders the assembled email.
- Copy demonstrably instantiates a named formula (`copyFormulaRef` set; banned-words list respected — test with a fixture brand.md).
- Instructions route "draft/plan email" intents to these tools (the REVISIT tool-choice-bias lesson, 05 H5.3).

**Dependencies:** WS2 (templates/assembly), WS1-R4 (audiences), spec 23 as-built tools (shipped), spec 22 context engine (shipped).

## WS3-R5 — The Actions *(pack declares; framework executes)*

Per 02 §1's table: `email.approve_plan` (medium — batch-create campaigns from a proposed calendar), `klaviyo.create_campaign_draft` (medium — template CODE upload with image uploads via WS1 client, campaign+message create, template assign; 3-step execute with per-step id recording for idempotent resume; `preview()` = assembled render + recipient estimation), `klaviyo.schedule_campaign` (**high** — approve-at-schedule = consent to send, spec 24 D2 mirrored; `preview()` = final render + subject/preview + audience size + send time; execute sets the send job/schedule in Klaviyo), `klaviyo.cancel_send` (low; undo lane — send-job cancel/revert, 03 §4).

**Acceptance:**
- Each Action: scopes declared, `preview()` provably read-only (test: no Klaviyo mutation calls recorded), execute idempotent under retry, audit rows complete.
- **Nonce invalidation matrix tested:** copy edit, canvas edit post-export (`edited` via polling fallback — REVISIT #5), audience change, time move, skeleton re-ingestion → each re-arms the card, status regresses per 02 §1.
- End-to-end on Arthaus (small internal test segment): draft Action → campaign visible in Klaviyo as draft; schedule Action → sends at T to the test segment; cancel path exercised once.
- No send without approval: attempt to execute schedule without a valid nonce fails + audits.

**Dependencies:** WS3-R1, R4, WS1-R3, WS2-R4.

## WS3-R6 — Cron + rituals *(hosted-agents)*

`/api/cron/email` (02 §5): reconcile scheduled campaigns against Klaviyo (out-of-band-change detection → Slack flag + nonce concern), mark `sent`, readback sweep past maturation window → rollup → `measured`. Weekly "this week in email" card; monthly plan proposal seeded with readback. Built on the shared cron frame (05 H7 — extract it here).

**Acceptance:** idempotent (double-fire safe), CRON_SECRET-gated, self-limiting; a Klaviyo-UI edit to a scheduled campaign is detected within one cron cycle and flagged; recap card renders in #arthaus with real numbers (attribution basis stated).

**Dependencies:** WS3-R5, WS1-R6.

## WS3-R7 — Runtime enablement + skill-kit extraction *(hosted-agents + marketing-os)*

Wire the pack into the hosted runtime via the enablement registry (05 H1.1 — build the minimal version here if WS4 hasn't: a DB-read gate is enough), Mastra-wrap at merge time (the social README wrap), bind `EmailRepo` to the tenant store repo and `KlaviyoClient` to WS1-R3. Extract `skill-kit` (05 H6: `StoreRepo`, `SkillToolDefinition`, front-matter helpers, provenance types) and make **both** packs import it.

**Acceptance:** email tools appear only for tenants with the pack enabled + Klaviyo connected; social pack still green after skill-kit migration; instructions merge follows 05 H5 ordering with both packs enabled; deployed to hosted-agents via the verified-checkout CLI deploy practice.

---

## Open questions (human)
1. PRD §8 Q2 — extract R1 as its own mini-project (recommended) or keep in-workstream?
2. PRD §8 Q4 — schedule semantics + high-risk ergonomics: is confirmation-dialog enough for full-list sends, or add an audience-size threshold requiring a second approver?
3. Send-time ownership: schedule in Klaviyo (position taken — Klaviyo executes; our cron reconciles) vs our cron triggering immediate send jobs at T (more control, more failure surface). Confirm the position.
4. `email.approve_plan` batch semantics: does plan approval authorize *drafting* only (position: yes — sends still gate individually) — worth stating to owners explicitly in the card copy?
