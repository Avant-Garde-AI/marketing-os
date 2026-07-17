# Email Campaign Agent — Workstream Orchestration

> Four workstreams cover the MVP (PRD §3). Each file carries numbered requirements (`WSn-Rm`) with acceptance criteria, file-level targets per repo, dependencies, and open questions. Requirements are the unit of review — build agents should reference them by id in commits/PRs.

## The cut

| WS | Name | One line | Primary repos |
|---|---|---|---|
| **WS1** | Klaviyo foundation | Connection/auth via the Vault/broker, the revision-pinned client, reference-template ingestion (fetch side), metrics readback | marketing-os-app, marketing-os (pack read tools), hosted-agents |
| **WS2** | Email design pipeline | `email.campaign` surface kind + multi-board compose, email compose templates, skeleton extraction + HTML assembly (`packages/email-assembly`), brand-tokens-to-CSS, QA matrix | marketing-os |
| **WS3** | Agent + skill pack + Actions | `packages/skills/email-campaign` (artifacts, planning reads, instructions), **the spec 20 A0/A1 Action framework** (first block — shared platform work), the four Actions, cron, runtime enable | marketing-os, hosted-agents, marketing-os-app |
| **WS4** | Console surfaces + library hardening | Shared calendar (05 H4), campaign detail + approval UX, skills enable page (05 H1), migrations applied, template distribution | marketing-os (template), marketing-os-app, store repos (upgrade PRs) |

## Dependency graph & order

```
WS1 ──────────────┐
  (R1 auth first) │
WS2 ──────────────┼──→ WS3 (pack assembles WS1's client + WS2's pipeline behind Actions)
                  │        │
WS3-R1 (spec 20 A0/A1) ────┘   ← the critical path; can start day 1, independent of WS1/WS2
                           │
                           └──→ WS4 (renders what WS1–WS3 produce)
```

- **Start in parallel, day 1:** WS1-R1..R3 (auth/broker/client), WS2 entirely, and **WS3-R1 (the Action framework)** — the three have no mutual dependencies. WS3-R1 is the schedule's critical path (three specs queue behind it); staff it first.
- **WS3 pack work** (R2+) starts immediately too (artifacts + planning reads need only the repo seam), but its Actions (R5–R7) integrate WS1-R3 (client) + WS2-R4 (assembler) + WS3-R1 (gate) — the convergence point.
- **WS4** is read-side and can begin once schemas stabilize (WS3-R2 artifact shapes, 05 H4 calendar contract); its store-repo delivery (upgrade PRs) lands last.
- **External/day-1 human actions (Garrett):** create the Klaviyo OAuth app (or mint the Arthaus private key for the bootstrap lane); confirm the five open decisions in PRD §8.

## Parallelization notes

- WS1 and WS2 never touch the same files. WS2 is entirely in marketing-os (design-surfaces extension + new email-assembly package) — safe alongside concurrent template/hosted-agents work by other teams **except** WS2's compose-template mirroring into `templates/agents/`, which should batch with WS4's template changes into one template version bump.
- WS3-R1 (Action framework) touches hosted-agents' chat/tools spine and marketing-os-app (audit table) — coordinate with anything else editing the runtime; it is the highest-contention change.
- Arthaus is the validation tenant throughout; each WS's exit criterion names its Arthaus proof.

## Exit (module MVP = PRD §3 success criteria)

Plan → draft (on-brand HTML, canvas-editable blocks) → approval card → Klaviyo draft → schedule (high-risk gate) → send → recap with revenue. All artifacts in `email/`, all writes audited, zero ungated Klaviyo mutations.
