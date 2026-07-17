# The Store-Repo Email Design System (as-built precedent: Arthaus `emails/`)

> Added 2026-07-17 (Garrett, during the build): Arthaus already runs a complete
> email design system in its store repo — `Arthaus-Inc/marketplace/emails/` —
> authored largely by coding-agent sessions. **Its pattern and abstraction are
> binding for this module.** This document records the precedent, what the
> module inherits from it, and the new requirements it adds (WS2-R6, WS3-R8).

---

## 0. What Arthaus proved (read `marketplace/emails/README.md`)

| As-built piece | What it is | Module consequence |
|---|---|---|
| `partials/` (head, header, footer, button, divider, product-card) | Shared components included in every template — the brand frame, decomposed | The "skeleton" is better expressed as **partials + a composer** than as one monolithic frame; `head.html` carries reset CSS, dark-mode media queries, MSO conditionals, and the brand token table |
| `templates/*.html` + `<!--PARTIAL:name-->` markers | 17 lifecycle templates (welcome series, cart-abandon, editorial, winback, …) authored as full HTML with partial markers; **Klaviyo Django tags preserved verbatim** | Archetype/lifecycle templates are repo artifacts a coding agent can read, extend, and author against |
| `scripts/compose.js` | Deterministic marker→partial substitution → `dist/` | `composePartials()` now lives in `@avant-garde/email-assembly` — same regex, same semantics, platform-grade tests |
| `klaviyo-registry.json` (slug → template id) | First push creates, later pushes **PATCH the same id** — idempotent, committed, team-shared | `email/registry.json` in the artifact model; the `klaviyo.create_campaign_draft` Action uses the same PATCH-not-duplicate discipline |
| `scripts/klaviyo-push.js` / `render-drafts.js` / `preview-server.js` | Push, server-side render check (catches Django syntax errors), local hot-reload preview | The hosted preview route + WS1 client's `renderTemplate` are the platform versions; the scaffold keeps a store-local preview affordance documented |
| `flows-registry.json` + `scripts/klaviyo-flows.js` | Flow message → library-template re-pointing (defeats the drag-drop wall: PATCH library template, then Update Flow Action re-points the message at it) | Flows stay a v1 **non-goal** for the agent, but the artifact tree is **flow-ready** and the re-pointing model is the proven v2 path (03 §7 updated understanding) |
| README's Django-vs-Liquid table | Klaviyo is a Django subset, NOT Shopify Liquid; the exact break patterns are enumerated | This knowledge ships in the scaffold's agent-facing `email/README.md` — it is what makes the repo a "solid foundation" for future coding agents |

## 1. The requirement (from the owner, verbatim intent)

1. **Scaffold** — the email agent must be able to scaffold an Arthaus-shaped
   `email/` design system into any Shopify-theme-backed store repo (deployed
   agents write all data into the store's git repo).
2. **Seed from the Brand Soul and/or the store's existing Klaviyo templates**
   (post-authorization): brand-tokenized partials from DESIGN.md's DTCG tokens;
   ingested header/footer/frame from the store's real templates when usable
   (04 §3 ingestion feeds partials, not only a monolithic skeleton).
3. **Foundation for future coding agents** — templates AND campaign strategy
   are versionable, readable, and usable by any later session (e.g. a Claude
   Code session assigned "design a welcome + cart-recovery series targeted at
   persona X" finds strategy.md, the partials, the archetype templates, the
   registry, and an authoring README, and can build on them directly).

## 2. The unified `email/` tree (supersedes 02 §3's tree — additive)

```
email/
  README.md                      # agent-facing authoring guide (scaffolded; §3)
  strategy.md                    # standing strategy (02 §3 — unchanged)
  registry.json                  # slug → Klaviyo template id (idempotent push)
  partials/                      # brand frame components (scaffolded/ingested)
    head.html                    #   reset CSS + tokens + dark mode + MSO
    header.html                  #   wordmark bar
    footer.html                  #   links/legal/unsubscribe (merge tags verbatim)
    button.html  divider.html  product-card.html
  templates/
    *.html                       # archetype/lifecycle templates (PARTIAL markers)
    skeletons/{id}/              # 04 §3 ingested skeletons (unchanged)
      skeleton.md  skeleton.html
  fixtures/
    sample-context.json          # render-check context
  calendar/{YYYY-MM}.md          # unchanged
  campaigns/{id}/                # unchanged
    campaign.md  assets/  email.html
```

The campaign pipeline (04 §4) and the design system converge: a skeleton MAY be
a composed product of partials (`composePartials` → slot extraction), and
campaign `email.html` assembly consumes the same frame the lifecycle templates
share. One brand frame, two consumers.

## 3. `email/README.md` — the scaffolded authoring guide

Generated per store from a template in the pack, carrying:
- the tree explanation + the PARTIAL marker convention;
- the DESIGN.md-derived token table (names, hexes, usage) and font stacks;
- the **Klaviyo Django vs Shopify Liquid rules** (inherited verbatim from the
  Arthaus README's table — the single highest-value piece of agent knowledge);
- email HTML constraints (tables, inline styles, 600px, VML buttons, alt text,
  unsubscribe merge tags are load-bearing);
- how the registry works (never duplicate — reuse the slug's id);
- pointers: strategy.md for the standing plan, brand.md/DESIGN.md for the soul,
  campaigns/ for the agent-run campaign artifacts.

## 4. New requirements

**WS2-R6 — Scaffold generator (pack-side).** `scaffoldEmailSystem(tokens, opts)
→ Record<path, content>`: pure function producing the §2 tree's seed files —
partials tokenized from DTCG tokens (palette → head.html CSS variables + inline
values, type stacks from typography tokens), starter archetype templates
(editorial, product-feature/cart-reminder, winback minimum), README.md from the
guide template, empty registry. Options carry store name/wordmark, from-address
placeholders. Repo writes happen at the caller's seam (hosted runtime tool or a
coding-agent session) — the generator never touches git. Acceptance: scaffold
with Arthaus DESIGN.md fixture tokens produces partials that render credibly
against the real Arthaus `emails/partials/` as visual reference; deterministic
double-run; every scaffolded template composes + passes assembly invariants.
When the store authorizes Klaviyo and ingestion (04 §3) yields usable frame
pieces, ingested partials REPLACE the scaffolded defaults (provenance recorded).
This is also the PRD §8 Q5 cold-start answer: the scaffold IS the platform
default skeleton, brand-tokenized.

**WS3-R8 — Registry discipline in the draft Action.** `email/registry.json`
maps slug → Klaviyo template id. `klaviyo.create_campaign_draft` consults it:
existing slug → PATCH the template (client gains `updateTemplate`); new slug →
create + record. Campaign templates use slug `campaign-{id}`; lifecycle
templates keep their human slugs. The registry is committed store state — the
same rebuildable-index doctrine as everything else.

## 5. What stays out (v1)

- No flow automation from the agent (unchanged non-goal); the tree is
  flow-ready (`flows-registry.json`, `defs/`) and the Arthaus re-pointing model
  is the documented v2 path.
- No store-local node tooling in the scaffold (`package.json`, preview server):
  the platform provides compose/preview/push through the pack + hosted routes;
  a coding-agent session uses the same package. Revisit if owners ask for
  standalone `npm run dev` parity with Arthaus.
- Shopify-notification templates (Arthaus `shopify-notifications/`) — different
  delivery system, out of scope.
