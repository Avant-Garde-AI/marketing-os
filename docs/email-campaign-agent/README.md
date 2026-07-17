# Email Campaign Agent (Klaviyo-first) — Module Documentation

> **Status:** requirements complete (authored 2026-07-16/17), awaiting Garrett's five decisions (01-PRD §8) + build go. Nothing in this module is built yet except its foundations (design surfaces, brand soul, semantic layer — all live).

The Email Campaign Agent is Marketing OS's second creative-channel skill pack (the social agent, spec 24, is the first — and the deliberate template for this one's shape). It plans email campaigns from the Brand Soul, drafts them on the shared design canvas + a store-derived HTML skeleton, and creates/schedules them in the store's own Klaviyo account through the spec 20 Action gate. Anti-generic-ESP-AI: derived plans with provenance, token-mechanical brand fidelity, no send without a human approval.

## Documents

| Doc | What it holds |
|---|---|
| [01-PRD.md](./01-PRD.md) | Thesis, personas, jobs-to-be-done, MVP scope + explicit non-goals, success criteria, **hard-dependency honest inventory (§7)**, the five open decisions (§8) |
| [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) | Where every piece lives across the four repos; the pack shape (reads vs Actions); Klaviyo credential topology (unlisted OAuth via the Vault/broker); the `email/` artifact model + DB index; **the cross-channel calendar abstraction (§6)** |
| [03-KLAVIYO-PLATFORM.md](./03-KLAVIYO-PLATFORM.md) | Researched Klaviyo platform facts with sources (2026-07-16, revision 2026-07-15): OAuth, Templates/Campaigns/Images/Lists/Flows/Reporting APIs, rate limits, marketplace, MCP/AI surfaces, **§12 uncertainties to re-verify** |
| [04-DESIGN-SURFACE-PIPELINE.md](./04-DESIGN-SURFACE-PIPELINE.md) | **The central design problem**: email is HTML, Penpot exports raster. The position (skeleton + slots; `email.campaign` multi-board surfaces; pure-HTML copy sections), alternatives, fidelity/dark-mode/alt-text analysis, assembly invariants, switching criteria |
| [05-AGENT-LIBRARY-HARDENING.md](./05-AGENT-LIBRARY-HARDENING.md) | What the email+social pair forces the platform to generalize (H1–H8): pack enable/config, Action framework, surface-kind registry, shared calendar, instructions merge, one repo seam, cron frame, template distribution |
| [requirements/README.md](./requirements/README.md) | Workstream orchestration: order, dependency graph, what parallelizes |
| [requirements/ws1-klaviyo-foundation.md](./requirements/ws1-klaviyo-foundation.md) | WS1: auth/broker, client adapter, template fetch + audience reads, readback |
| [requirements/ws2-email-design-pipeline.md](./requirements/ws2-email-design-pipeline.md) | WS2: multi-board compose, email templates, skeleton extraction, HTML assembly, QA matrix |
| [requirements/ws3-agent-skill-pack.md](./requirements/ws3-agent-skill-pack.md) | WS3: **the spec 20 A0/A1 Action framework (R1 — critical path)**, the pack, the four Actions, cron |
| [requirements/ws4-console-and-library.md](./requirements/ws4-console-and-library.md) | WS4: shared calendar view, campaign detail/preview, skills page, migrations, template→upgrade PR |

## How to pick this up in a fresh session

**Reading order (do not skip; ~40 minutes):**
1. This README, then **01-PRD.md** end to end — especially §7 (what does NOT exist yet).
2. `spec/20-CAPABILITY-SUITE-AND-ACTIONS.md` — the Action contract every write here uses. **A0/A1 are unbuilt**; WS3-R1 builds them.
3. `spec/24-SOCIAL-MEDIA-AGENT.md` + `packages/skills/social-media/` (README, `src/types.ts`, `src/tools.ts`, `instructions.md`) — the sibling this module mirrors; its conventions are binding precedent.
4. `spec/23-DESIGN-SURFACES-PENPOT.md` **and then** `docs/plans/design-surfaces/REVISIT.md` — the spec, then the as-built truth (they differ; REVISIT wins). Skim `packages/design-surfaces/` (README, `src/types.ts`, `src/surface.ts`, `src/compose.ts`).
5. `spec/22-BRAND-SOUL.md` §2/§4/§6 (brand.md, copy formulas, context engine — all live) + `packages/brand-md/src/dtcg.ts` (token compiler, shipped).
6. **02 → 04 → 05 → requirements/** in this folder.
7. Reference as needed: `spec/11-HOSTED-PATH.md` (tenancy/broker/store-repo model), `spec/19` (cron/report shapes), `spec/17` (approval cards), `spec/12` (semantic layer + glossary discipline).

**The four repos (02 §0 has the full map):**
- `marketing-os` (this repo) — OSS packages, specs, the console **template** (`packages/marketing-os/templates/agents/`, v0.14.0 shipped). Pack + assembly + compose work lands here.
- `marketing-os-hosted-agents` — pooled Mastra runtime. **CLI-deployed** (`vercel deploy --prod` from a verified checkout — it does NOT auto-deploy from git; see the deploy-source-verification practice). Runtime wiring, crons, preview routes land here.
- `marketing-os-app` — Shopify app / platform / Supabase / **Vault + credential broker** / migrations. Klaviyo connection + all DB work lands here. As-built reference: `marketing-os-app/docs/PLATFORM.md`.
- Store repos (Arthaus = `Arthaus-Inc/marketplace`) — the `email/` artifacts + the store's console (`agents/`, deployed via `vercel deploy --prod --cwd agents`). Console changes arrive **only** as template→upgrade PRs (spec 22 rule). Note: `marketing-os upgrade --yes` currently isn't non-interactive (REVISIT.md).

**Live infra you build against (verified 2026-07-16/17):**
- Production Penpot: **https://design.avant-garde.ai** (pooled, tenant=team, platform service account; export lane requires session auth via `login-with-password` — the client handles it; canary suite gates every touch).
- Design-surface agent tools (`compose_design_surface` / `export_design_surface` / `list_design_surfaces`) live in the Arthaus console (www.arthaus.cloud), validated end-to-end 2026-07-17.
- brand.md context injection, semantic layer, Slack surface, report cron: all live (specs 22/12/15/19).
- Klaviyo: **nothing exists yet** — WS1 builds it. Arthaus has a real Klaviyo account (the validation tenant).

**Env vars you'll meet** (each repo's env reference is authoritative): `PENPOT_URL` / `PENPOT_ACCESS_TOKEN` / `PENPOT_SERVICE_EMAIL` / `PENPOT_SERVICE_PASSWORD` (hosted-agents + Arthaus console; set on their Vercel projects), `MOS_AGENTS_PUBLIC_URL`, `CRON_SECRET`; WS1 adds `KLAVIYO_CLIENT_ID` / `KLAVIYO_CLIENT_SECRET` (marketing-os-app). Tenant Klaviyo credentials live in Vault, never in env.

**Who owns what:** Garrett owns the five PRD §8 decisions, the Klaviyo OAuth app creation, npm publish OTPs, and Vercel/Supabase production access. Build sessions own everything else. A sibling effort may be concurrently editing `packages/marketing-os/templates/agents/` and hosted-agents — coordinate template bumps (WS4-R6 batches this module's).

**House rules that bite:** files are truth / DB is the index (spec 22 D1); reads compose freely / writes are Actions (spec 20); never touch Penpot outside the design-surfaces adapter + canary; never add an adapter call without a canary test; console edits only via template→upgrade PRs; deploy hosted-agents only from a verified checkout; commit messages and PR bodies follow repo conventions.
