# 19 — Scheduled Reports & Dashboards to Slack

> **Status:** BUILDING — authorized 2026-07-08. Spec captures the full vision; this PR builds the MVP slice (marked ▶).
> **Depends on:** 15-SLACK-INTEGRATION (surface + delivery), 16-MODEL-TOPOLOGY (Gemini chat), 17-RICH-SURFACES (branded cards, chart types, mos-chart/mos-kpi directives).
> **First target:** Arthaus → #arthaus.

---

## 0. Thesis

The agent already answers analytics questions with brand-styled cards. The next leap: **turn a good answer into a standing report.** A merchant asks "how did we do last week?", likes it, and says "save that as my Monday report" — Marketing OS then runs it every Monday and drops the branded cards into a Slack channel. Reports compose into **dashboards** (a set of cards in one Slack post). Configuration happens two ways: **conversationally** (pin an insight mid-chat) or in the **web console**.

This is the recurring, ambient value engine — the reason a team keeps the bot in their channel.

## 1. Model

A **Report** is a tenant-scoped, named definition:
- `prompt` — the analysis to run (natural language; e.g. the flagship "Weekly Store Review" or a saved user question).
- `channel` — the Slack destination.
- `cadence` — `daily | weekly | monthly | manual` (+ `nextRunAt`); later a raw cron.
- `enabled`, `createdBy`, `lastRunAt`.

A **dashboard** is just a Report whose prompt asks for several cards — one Slack post, N branded cards + a narrative. No separate model needed at MVP.

```prisma
model ScheduledReport {   // ▶ this PR
  id         String   @id @default(cuid())
  tenantId   String
  teamId     String            // Slack workspace
  channelId  String            // destination
  name       String
  prompt     String            // the analysis to run
  cadence    String   @default("weekly") // daily | weekly | monthly | manual
  enabled    Boolean  @default(true)
  createdBy  String            // Slack user id
  nextRunAt  DateTime?
  lastRunAt  DateTime?
  createdAt  DateTime @default(now())
  @@index([enabled, nextRunAt])
}
```

## 2. Configuration paths

**A. Conversational (▶ this PR).** `/mos report save "<name>" [weekly|daily|monthly]` saves the **last question in the thread** (or an explicit prompt) as a recurring report to the current channel. `/mos report run "<name>"` runs it now; `/mos report list` shows them. Later: the agent recognizes "save this as a weekly report" inline and offers a confirm button.

**B. Console (later).** An embedded-admin "Reports" tab: list / create / edit schedule + channel / enable-disable / run-now / preview. Same `ScheduledReport` rows. Deferred; the conversational path proves the model first.

## 3. Generation (▶ this PR)

A report runs through the **same agent + card pipeline** as chat: the `prompt` drives the pro agent (Gemini), which emits `mos-kpi` / `mos-chart` directives (spec 17 S-B, extended in §5), and the delivery renders them as branded cards into the target channel — text narrative + KPI card + charts, as one threaded post.

Shared helper `runReportToSlack(tenantShop, channelId, prompt, botToken)` — used by both the slash command and the cron.

## 4. Recurring delivery (▶ this PR)

`GET /api/cron/reports` (Vercel cron, alongside `drain-jobs`/`reconcile`): finds `ScheduledReport`s with `enabled && nextRunAt <= now`, runs each via `runReportToSlack`, posts to its channel, advances `nextRunAt` by cadence, sets `lastRunAt`. Idempotent, `CRON_SECRET`-gated. Cadence math: daily +1d, weekly +7d, monthly +1mo, anchored to a sensible hour.

## 5. Richer analysis + chart types (Option A — ▶ this PR)

To make reports worth reading, spec 17's renderer + agent gain:
- **`compare` chart** — two-series line (this period vs prior), navy + warm-gray, legend. For period-over-period.
- **`funnel` chart** — steps with drop-off %, for conversion reports.
- **Rich KPI card** — tiles gain a **delta** (▲/▼ vs prior, brand success/danger) and an optional **sparkline**; new `mos-kpi` directive so the agent designs the KPI card explicitly.
- **Agent analysis** — instructions to compare to the prior period, compute deltas, call out top movers / anomalies, and pick the right chart kind. This is what turns "here are numbers" into "here's what changed and why."

## 6. Guardrails

- Reports post only to channels in the workspace the tenant is bound to; `channelId` captured from where the save happened.
- Report creation/edit gated to the installer/allowlist (spec 15 §6), same as approvals.
- A report is just a saved prompt — no new data access; it runs through the same governed tools.
- Cron self-limits (max reports/run, per-tenant cap) and logs what it skipped.

## 7. Phases

- **▶ R0 (this PR):** `ScheduledReport` model, `runReportToSlack`, `/mos report save|run|list`, `/api/cron/reports`, Option A chart types + rich KPI + agent analysis. Flagship built-in prompt: **Weekly Store Review**.
- **R1 — DONE + LIVE 2026-07-09:** console Reports tab (app.reports.tsx) — list, run-now, pause/resume, delete, schedule a built-in report to a linked Slack channel; nav link added.
- **R2:** inline conversational save (agent offers a "save as recurring report" button mid-chat).
- **R3:** dashboards as multi-report bundles; per-card scheduling; digest roll-ups.

---

## 8. Store Analytics Context (C-series) — DONE + LIVE 2026-07-09

The "tune the query" capability: a per-store **default footprint** applied to base
metrics everywhere (chat + all reports), so numbers reflect the markets a store
actually services. Structure = a saved fragment of the semantic layer's OWN
filter DSL (`{field, op, value}`), not a new abstraction.

- **C0 (governed merge + disclosure):** `validateQuery` merges the saved default
  filters into any view that exposes the field (per-view), unless the user
  filtered it explicitly (query overrides). Disclosed in `applied_defaults`.
- **C0b (cross-provider):** `country_code` (ISO) added to `traffic` (GA4
  `countryId`) and `commerce` (Shopify `shipping_address.country_code`); the
  Shopify resolver now applies filters (previously dropped). One saved context
  governs sessions AND orders/revenue → conversion is computed on one footprint.
- **C1 (conversational):** `set_store_metrics_context` / `get_store_metrics_context`
  tools; region tokens expand (EU→27, EEA, NA, UK→GB, ANZ). Say "count only
  US/Canada/UK/EU/Australia" → parsed → 31 ISO codes saved. Storage:
  `mos_store_context` table (runtime-owned, keyed by shop); read at model compile.
- Validated for Arthaus: context saved from chat; metrics + reports inherit it.

**C2 — DONE + LIVE 2026-07-09:** console "Markets & metric context" panel (app.markets.tsx + nav) — view/edit the serviced-markets footprint (ISO + region expansion), same mos_store_context row as the chat tool. **Next (C3):** per-report/per-query
overrides ("EU-only report", "show all countries"); a change log.
