# Email Campaign Agent — Product Requirements (Klaviyo-first)

> **Status:** REQUIREMENTS — authored 2026-07-16, awaiting build go.
> **Module lineage:** the second creative-channel agent, deliberately mirroring spec/24-SOCIAL-MEDIA-AGENT.md's shape (artifacts → reads → design surfaces → gated Actions → cron → readback). Where this document is silent, spec 24's answer applies.
> **Depends on:** spec/22-BRAND-SOUL (the plan derives from brand.md — §5 tone table's *email* register, §11 Channel Guidelines' email specifics, copy formulas), spec/20-CAPABILITY-SUITE (every Klaviyo write is an Action — **A0/A1 not yet built; hard dependency**, see §7), spec/23-DESIGN-SURFACES-PENPOT (visual blocks composed on the shipped compose lane), spec/19-SCHEDULED-REPORTS (cron shape + recaps), spec/24 (sibling precedent + the shared calendar).
> **First target:** Arthaus (Klaviyo account exists; brand.md v2+ live; DESIGN.md tokens compiling).

---

## 0. Thesis

Every ESP now ships an "AI subject line" button. Klaviyo's own AI writes generic emails from a product feed. That is exactly the anti-thesis. **The Email Campaign Agent derives campaigns from the Brand Soul and the store's own data, drafts them on the shared design canvas, and sends nothing that a human hasn't approved through the Action gate.**

The differentiation is upstream of the ESP, same as spec 24's is upstream of the scheduler:

- **The plan is derived, not improvised.** Campaign slots come from `email/strategy.md` cadence + brand.md's messaging framework and seasonal arcs + what the semantic layer says is selling, restocking, and being browsed + the persona's decision architecture. Every campaign carries its *why*, with provenance.
- **The email looks like the brand, mechanically.** Visual blocks are composed on the spec 23 Design Surface from DESIGN.md tokens; copy is instantiated from brand.md's copy-formula templates under the tone table's email register. Not "on-brand-ish because the model saw the logo" — token-derived and formula-enforced (spec 22 D5 injection).
- **The store's existing email identity is the skeleton.** We ingest the store's own Klaviyo templates as the structural HTML frame (see 04-DESIGN-SURFACE-PIPELINE), so day-one output lands in the inbox looking like *their* email program, upgraded — not like our platform's default.
- **Sends narrow through one gate.** `klaviyo.create_campaign_draft` and `klaviyo.schedule_campaign` are spec 20 Actions: previewed, role-gated, nonce-protected, audited. A whole-list send is the highest-blast-radius write this platform has shipped; the governance is the product.
- **Performance closes the loop.** Sent campaigns read back through Klaviyo's reporting APIs + the semantic layer (UTM-tagged links → sessions/revenue), and the next plan cites the numbers.

The anti-Privy discipline from spec 14 applies verbatim: never a generic blast disconnected from identity — every campaign serves the brand *and* a commercial intent.

## 1. Personas

| Persona | Relationship to the module | What they need |
|---|---|---|
| **Store owner/operator** (Arthaus's Garrett-equivalent) | Approves plans and sends in Slack/console; occasionally opens the canvas | A monthly email plan they can trust, campaign drafts that look like their brand, one-click approve, absolute confidence nothing sends unapproved |
| **Marketing lead** (larger stores) | Runs the calendar, edits copy/visuals, owns segments | The cross-channel calendar (email next to social), per-campaign detail with provenance, canvas editing, audience/segment selection with size estimates |
| **Agency operator** (multi-store, spec 15 multi-workspace) | Same flows across many tenants | Per-store strategy files, per-store Klaviyo connections, no cross-tenant leakage, the same rituals per store |
| **The agent itself** (Slack coworker / console chat) | Executes the loop | brand.md context injection, email strategy artifacts, semantic-layer reads, compose/export tools, `propose_action` |

Per spec 24 D4 (mirrored): **this is a skill pack in the main agent**, not a separate persona. The Slack coworker gains email capability.

## 2. Jobs to be done

1. **"Plan next month's email calendar"** → a provenance-carrying calendar proposal (`email/calendar/{YYYY-MM}.md`): campaign slots derived from strategy cadence × brand pillars × semantic-layer signals × seasonal arcs, each slot with audience intent and its why. Human approves the plan (Action).
2. **"Draft the mid-month new-arrivals campaign"** → a full campaign spec (`email/campaigns/{id}/campaign.md`): subject-line candidates + preview text (copy formulas), section-by-section content plan, audience (list/segment refs with estimated size), visual blocks composed on the design surface, assembled HTML preview, all before anything touches Klaviyo.
3. **"Make it feel more like the print-shop story"** → canvas edit (spec 23 embedded Design Studio when DS4 ships; export re-slots into the HTML) or copy revision in chat; nonce invalidates if already approved.
4. **"Send it Thursday at 10am to engaged-30d"** → `klaviyo.schedule_campaign` Action: preview card shows final subject/preview/audience-size/send-time + rendered preview; approval = consent to send at T (spec 24 D2 semantics); cron/Klaviyo executes; card rewrites with the result.
5. **"How did last week's campaign do?"** → readback: opens/clicks/conversions/revenue from Klaviyo reporting + attributed sessions/revenue from the semantic layer, compared to the store's own baseline, feeding the next plan.
6. **"What's going out this week — everywhere?"** → the shared calendar: email campaigns and social posts on one surface (02-ARCHITECTURE §6).

## 3. MVP scope

**In (v1):**

- `email/` artifact model in the store repo (strategy, calendar, campaigns) + DB index — spec 22 D1 doctrine, mirroring spec 24 §1.
- Planning reads: `email_plan_propose`, `email_calendar_read`, `email_campaign_read` (the spec 24 SM0 pattern), plus `klaviyo_audiences_read` (lists/segments + sizes) and `klaviyo_performance_read`.
- Reference-template ingestion: read the store's existing Klaviyo templates, extract 1–3 approved **skeletons** (04 §3).
- Campaign drafting: copy under brand.md formulas; visual blocks on the design surface (`email.campaign` kind, multi-board); skeleton + slots → assembled email HTML.
- Actions: `email.approve_plan`, `klaviyo.create_campaign_draft`, `klaviyo.schedule_campaign`, `klaviyo.cancel_send` — on the spec 20 framework.
- Klaviyo connection per tenant via the marketing-os-app Vault/broker pattern (WS1 decides key vs OAuth; see 03-KLAVIYO-PLATFORM §1).
- Readback: campaign performance via Klaviyo reporting API + UTM-disciplined semantic-layer join; "Email Recap" as a spec 19 saved report.
- Console: campaigns on the shared calendar (read), campaign detail view, approval cards in Slack (primary surface, as ever).

**Success criteria (Arthaus, the exit demo):** "plan two email campaigns for August" → provenance-carrying plan on the calendar → "draft the first one" → on-brand HTML draft visible as a preview, visual blocks editable in Design Studio → approval card in #arthaus → Approve → campaign exists in Klaviyo scheduled for its slot → sends → recap card cites open/click/revenue vs. baseline. Every step audited; zero sends without an approval nonce.

## 4. Non-goals (v1) — explicit

- **No Flows automation.** Klaviyo Flows (welcome series, abandoned cart) are a different risk/consent surface and the Flows API is materially more restricted (03 §7). The agent may *read* flow performance for context. Flows are the obvious v2.
- **No list hygiene / sunset policies / suppression management.** We read lists and segments; we do not mutate membership, clean lists, or manage suppressions. Creating segments via API is out of MVP (read + select only).
- **No deliverability consulting.** No dedicated-IP advice, no DMARC/SPF setup, no inbox-placement testing. The pipeline follows deliverability *hygiene* (text/image balance, alt text, working unsubscribe inherited from the skeleton) but the module does not sell deliverability.
- **No SMS.** Klaviyo does SMS; this module is email. The Action layer is channel-agnostic by construction (spec 20), so SMS is additive later.
- **No A/B testing orchestration** in v1 — subject-line *candidates* are proposed and a human picks; API-driven A/B tests are a fast-follow (03 §4 notes API support).
- **No template marketplace / no editing arbitrary Klaviyo templates.** We ingest skeletons and create our own campaign templates; we do not become a general Klaviyo template editor.
- **No autonomous sending.** Every send traces to a human approval (spec 20 §9 invariant). Auto-approve thresholds remain spec 20 OQ1's problem.

## 5. Product principles (inherited, restated)

1. **Files are truth, DB is the index** (spec 22 D1). Every campaign is a diffable markdown artifact in the store repo before it is a row anywhere.
2. **Reads compose freely; writes narrow through the gate** (spec 20). Planning, drafting, composing, assembling HTML — all ungated. Anything that touches Klaviyo state is an Action.
3. **What was approved is exactly what sends, or it re-asks** (spec 24 D2). Nonce invalidation on any post-approval edit: copy, canvas (spec 23 `edited` flag), audience, time.
4. **Never a blank form** (spec 22). Strategy co-created from brand.md; skeletons ingested from the store's real emails; plans proposed, not demanded.
5. **The layer boundaries hold.** Design Surfaces stay domain-agnostic (spec 23 §0 separation rule — this pack owns `email.*` kinds and their semantics); the Action gate stays channel-agnostic; this pack owns everything email.

## 6. Measures of success (module-level)

- Time-to-first-sent-campaign for a new store: < 1 week from Klaviyo connect (including skeleton ingestion + strategy session).
- Every sent campaign has: provenance-complete campaign.md, audit record, brand-lineage on its visual blocks, UTM discipline on links.
- Draft acceptance rate (campaigns approved without human copy/visual edits) — the honest brand-fidelity metric; track from day one.
- Readback joins: ≥ 90% of sent campaigns produce a semantic-layer revenue attribution row (UTM discipline working).
- Zero ungated writes to Klaviyo — auditable by construction.

## 7. Hard dependencies (honest inventory — do not assume these exist)

| Dependency | State (2026-07-16) | Impact |
|---|---|---|
| **Spec 20 A0/A1 Action framework** | **NOT BUILT.** Two hardcoded approve paths exist (offer, proposal); the generic contract/gate/audit does not. | Blocks all four Actions. This module is now the *third* consumer demanding it (after spec 21 B2, spec 24 SM2) — build it first (requirements/ws3). |
| Design surfaces compose/export | **BUILT + LIVE** (spec 23 DS0–DS3; production Penpot at https://design.avant-garde.ai; console tools validated end-to-end 2026-07-17) | Ready. WS2 extends ComposeSpec to multi-board. |
| DS4 embedded canvas (iframe) | NOT STARTED | "Open canvas" degrades to full-window/share-link (spec 23 D2 degradation path) until DS4. Not a blocker. |
| `mos_design_surfaces` / `mos_social_posts` migrations | Drafted in marketing-os-app, **UNAPPLIED** | The shared-calendar index (02 §6) lands alongside; apply together. |
| Skill install/enable per tenant (spec 20 A3) | NOT BUILT — packs are merged manually in the hosted runtime today | 05-AGENT-LIBRARY-HARDENING makes this a forced requirement of the two-agent pair. |
| brand.md context engine | **BUILT + LIVE** (spec 22 BS4) | Ready. |
| Semantic layer reads | **BUILT + LIVE** (spec 12) | Ready. |
| Klaviyo connection/broker | NOT BUILT (this module's WS1) | The GA4/Shopify Vault pattern in marketing-os-app is the template. |
| `marketing-os upgrade --yes` non-interactive | **BROKEN** (REVISIT.md finding) | Affects template distribution of console surfaces (WS4); manual upgrade PRs until fixed. |

## 8. Open decisions for Garrett

Collected across the docs; the full list lives in each workstream file. The five that gate the build:

1. **Klaviyo auth for v1: unlisted OAuth app vs private-key paste** (03 §1, ws1). Recommendation: unlisted OAuth (no review gate exists — verified; per-install rate quota; the compliant path Klaviyo is pushing platforms toward), with private-key paste as the Arthaus/dev bootstrap lane behind the same broker seam. Confirm because it front-loads ~a week of OAuth plumbing in marketing-os-app.
2. **Build spec 20 A0/A1 inside this module's WS3 or as its own prerequisite mini-project?** Three consumers now queue behind it; recommendation: extract to its own short build, WS3 consumes it.
3. **Shared calendar shape:** generalize to one `mos_calendar_items` index consumed by both packs, or per-channel tables + a console union view? (02 §6 takes a position: generalize; needs sign-off because it touches spec 24's unapplied migration.)
4. **Send-approval semantics + risk tier:** mirror spec 24 D2 (approve-at-schedule = consent to send, cron executes) with risk=**high** for full-list sends (second-approver optional per spec 20 §4)? Or require a final "confirm send" for audiences above a size threshold?
5. **Cold start without usable reference templates:** if a store's existing Klaviyo templates are unusable (or absent), ship a platform default skeleton library (brand-tokenized) — build it in WS2 or defer and hard-require ingestion?
