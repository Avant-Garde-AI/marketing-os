# Agent Library Hardening — What the Email + Social Pair Forces

> One creative-channel pack is an implementation; two are a **library**. The email agent's real strategic payload is that it forces every "we'll generalize it when there's a second consumer" deferral to come due. This document turns those into concrete platform requirements (H1–H8), each mapped to the spec 20 phase that owns it. WS4 builds the subset the MVP needs; the rest are stated so the third pack (ads creative? SMS? flows?) inherits a real library, not a second copy-paste.
>
> **Honest baseline (2026-07-16):** today, "installing a pack" means a developer hand-merges its tools/instructions into the hosted runtime and manually wires bindings. There is no enable registry, no per-tenant config surface, no Action framework (spec 20 A0/A1 unbuilt), and the one console pack surface (social calendar) is itself not built yet. The generalizations below are not refactors of working machinery — they are the machinery.

---

## H1 — Skill install/enable/config per store *(spec 20 A3, promoted from "later" to MVP-critical)*

Two packs with per-tenant provider requirements make manual merge untenable: Arthaus may enable both; the next store maybe only email; a store without Klaviyo must never see email tools.

**Requirements:**
- **H1.1** `mos_skill_enablements` (marketing-os-app): `{tenant, pack_id, version, enabled, config jsonb, enabled_by, at}`. The hosted runtime's dynamic tool merge (the spec 18 mechanism, already built for external MCP) reads it per request: `tools: async () => ({...base, ...enabledPackTools})`.
- **H1.2** Enablement is gated by `requires`: a pack declaring `providers: ["klaviyo"]` cannot be enabled until a live `provider_connections` row exists for the tenant. The console connect flow offers enablement on connect success.
- **H1.3** Per-tenant pack **config** has two homes by kind: *strategy-shaped* config is a repo artifact (`social/strategy.md`, `email/strategy.md` — owner-visible, versioned, agent-co-created); *wiring-shaped* config is `config jsonb` on the enablement row (e.g. Klaviyo `conversion_metric_id`, default from-address) — with the store repo's `agents/config/**` (upgrade-protected since the offer-surfaces fix) reserved for console-surface config only. State this split in each pack README; it is the answer to "where does per-store tuning live."
- **H1.4** Console: a Skills page (spec 20 §6's admin surface) listing packs with enable/disable, requires-status, version, and config form — template-first, distributed as an upgrade PR.

## H2 — The Action framework *(spec 20 A0/A1 — the critical path, third consumer now queued)*

Spec 21 B2 needed it, spec 24 SM2 needs it, this module's WS3 needs it. **Requirement: build A0/A1 once, as its own workstream-zero, before or parallel-early with WS3** — the contract (`Action<P>` interface), the gate (`propose_action` tool → scope check → `preview()` → spec 17 card → approver check → `execute()` → audit), the `mos_action_audit` table, the nonce store, and the refactor of the two hardcoded approve paths (offer, proposal) onto it. Email adds one requirement social didn't: **risk=high semantics** (spec 20 §4's confirmation dialog + optional second approver) must actually be implemented, because `klaviyo.schedule_campaign` is the platform's first high-risk Action.

## H3 — Surface-kind registry *(new; spec 23 kept kinds opaque — two minters need a directory)*

Spec 23's separation rule makes `kind` an opaque string, correctly. But the *console* now renders surfaces minted by two packs (thumbnails on the calendar, "Open canvas" links, detail routes), and the export route needs per-kind defaults.

**Requirements:**
- **H3.1** A `SurfaceKindRegistration` contributed by each pack at enable time: `{kind, ownerPackId, defaultExport: {format, scale}, boardGeometry?, detailRoute(boundTo), displayName}`. Lives beside the tool merge in the hosted runtime; the design-surface layer itself stays ignorant of it (the registry is a *consumer-side* directory, preserving spec 23 §0).
- **H3.2** `mos_design_surfaces` (drafted, unapplied) gets applied as part of this pair's build — both packs' console surfaces need the index. Include `kind` filtering.

## H4 — The shared calendar model *(new; defined in 02 §6)*

- **H4.1** `mos_calendar_items` projection table + the `CalendarItem` contract (02 §6); packs write through one helper (`upsertCalendarItem`), the console calendar reads only the projection.
- **H4.2** The console calendar component (built once, in the template) renders channels it has never heard of: channel chips, status chips, and detail click-through come from the item, not from a channel switch-statement. Acceptance: a third channel appears on the calendar with zero calendar-component changes.
- **H4.3** Apply the unapplied `mos_social_posts` migration in the same change (PRD §7); social backfills the projection from its files (the rebuildable-from-files doctrine's first real exercise).

## H5 — Instructions merge discipline *(spec 20 §5's "appended when enabled," now ×N)*

Two packs' `instructions.md` + brand context (spec 22 D5, ~2–3KB) + store identity + analytics context all compete for the system prompt.

**Requirements:**
- **H5.1** Deterministic merge order (base → brand → packs by id), each pack under a stable `## {pack name}` heading, with a per-pack token budget (soft 1.5KB — both existing packs fit) and a lint in CI that fails a pack whose instructions exceed it.
- **H5.2** Cross-pack routing guidance is the *platform's* job, not any pack's: a short merged preamble ("you have social and email capability; calendar questions may span both") generated from enabled-pack metadata. Packs must not reference each other by name in their own instructions (they can't know what's enabled).
- **H5.3** Tool-choice bias is real (REVISIT finding: the agent reached for `generate_design_candidates` instead of `compose_design_surface`). Each pack's instructions must include intent-routing lines for its own tools; H5.2's preamble handles *between*-pack routing.

## H6 — One store-repo seam *(generalize `SocialRepo`/`EmailRepo`)*

Both packs define the identical 3-method accessor. **Requirement:** promote it to a shared `StoreRepo` type in a tiny `packages/skill-kit/` (or export from a shared existing package — implementer's call), along with `SkillToolDefinition`, the front-matter parse/serialize helpers both `artifacts.ts` files duplicate, and the provenance types. The hosted runtime then maintains exactly one binding implementation (GitHub contents API against the tenant repo) handed to every pack. Do this *during* WS3, not after — the email pack should import it, not copy it.

## H7 — Cron scaffolding *(spec 19 shape, third instance incoming)*

`/api/cron/reports` exists; `/api/cron/social` and `/api/cron/email` are specified. **Requirement:** extract the common frame (CRON_SECRET gate, idempotency ledger, self-limiting batch, failure→Slack alert) into a shared helper in hosted-agents; each channel cron becomes its scan-and-act body. The weekly/monthly *rituals* (spec 24 §5, mirrored by email) share card-composition plumbing too — one "upcoming queue" card builder parameterized by channel, fed from `mos_calendar_items` (H4).

## H8 — Pack distribution & template discipline *(spec 20 A3 / spec 08 lite)*

- **H8.1** Console surfaces a pack contributes (calendar, campaign detail, skills page) are built in `packages/marketing-os/templates/agents/` and reach stores **only** as template→upgrade PRs (the spec 22 rule; template v0.14.0 precedent). A pack version bump that includes console surfaces implies a template minor bump — write this into the release checklist.
- **H8.2** **Fix `marketing-os upgrade --yes`** (REVISIT finding: it still prompts and dies without a TTY). Two packs shipping console surfaces means upgrade PRs become routine; a real `--ci` path is a hard requirement before that routine exists. Until fixed, upgrades are hand-driven (the Arthaus PR #26 pattern: surgical apply, tsc + next build clean, lockfile fixup).
- **H8.3** Packs publish to npm under `@avant-garde/skill-*` (npm publishing now works — 2FA'd, trusted-publishing follow-up open); hosted-agents consumes published versions, replacing the vendored-copy pattern on next touch.

## What is deliberately NOT generalized yet

- **No plugin architecture / dynamic loading.** Packs are workspace packages compiled into the runtime; enablement is data, code is static. Community-pack loading is spec 08's problem, after the Action-review gate (spec 20 §5) exists.
- **No cross-channel planning brain.** The two packs plan independently from the same brand.md + semantic layer; a coordinated "campaign spans email+social" object is real product work (and probably the *fourth* pack's forcing function), not a schema to guess now. The shared calendar makes the overlap *visible*, which is enough for v1.
- **No per-store instruction *overrides*** (owner-authored tuning text per pack). The strategy artifacts are the sanctioned tuning surface; free-text instruction overlays invite drift from the Brand Soul. Revisit if strategy files prove insufficient.
