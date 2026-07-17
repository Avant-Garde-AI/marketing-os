# Email × Design Surfaces — the HTML Pipeline

> The central design problem of this module, confronted head-on: **email is an HTML artifact; Penpot exports raster/SVG.** A social post *is* its exported image; an email is not. This document takes a position, defends it, analyzes its failure modes honestly, and records the alternatives and the criteria for switching.

---

## 0. The position

**Skeleton + slots.** Three layers, three owners:

1. **The skeleton (structural HTML)** — ingested from the store's own reference Klaviyo templates (§3): the email-safe frame (600px table layout, MSO conditionals, header/nav, footer, legal/unsubscribe, background scaffolding) with named **slots** where campaign content goes. Owned by the assembly package; changes rarely; owner-approved at ingestion.
2. **Visual blocks (design-surface boards)** — the campaign's *brand-expression* sections: hero imagery, featured-product compositions, promo banners, editorial imagery. Composed on the spec 23 compose lane as email-width boards from DESIGN.md tokens + generated/product imagery, human-editable on the canvas, **exported as images** slotted into the skeleton.
3. **Copy sections (pure HTML)** — everything that is *text*: body paragraphs, product names/prices, CTAs/buttons, section headings, footer text. Generated under brand.md copy formulas, rendered as HTML styled by brand tokens compiled to inline CSS. **Never rasterized.**

The dividing rule, stated once and enforced by the section-type schema:

> **If it must reflow, be read by screen readers or Gmail's clipper, adapt to dark mode, or be edited without a re-export — it is HTML. If it is visual brand expression that must be pixel-exact — it is a board export. Text inside imagery is display type only (a hero wordmark, a lockup), never information.**

Assembly (`packages/email-assembly`, 02 §4) is a pure function: `skeleton.html + sections[] + tokens → email.html`, which `klaviyo.create_campaign_draft` uploads as a `CODE`-editor template (03 §3).

## 1. Why this position (and what loses)

| Approach | Verdict | Why |
|---|---|---|
| **Full-image email** (export the whole email as one/few images) | **Rejected** | Deliverability: spam filters weight text/image ratio; images-off clients (still a default in some Outlook configs) render a blank email; zero accessibility; no reflow on mobile beyond dumb scaling; every copy tweak is a re-export; unsubscribe/legal inside an image can be a compliance failure. |
| **Full-HTML generation** (LLM/MJML generates the whole email; no canvas) | **Rejected as v1 primary; the documented fallback** | Loses the platform's differentiator: the human-editable shared canvas (spec 23) and token-mechanical brand fidelity. LLM-generated email HTML is brittle across Outlook/Gmail quirks; MJML tames that but then the artifact is MJML, uneditable-on-canvas, and brand fidelity is back to prompt-vibes. If the skeleton+slots hybrid proves too fiddly, MJML-with-token-injection is the retreat — the artifact doctrine and Actions survive the swap; only WS2 changes. |
| **Drive Klaviyo's drag-drop editor** (`SYSTEM_DRAGGABLE` `definition` JSON) | **Rejected for v1; re-evaluate** | API-creatable since rev 2026-04-15 (03 §3), and it would make drafts natively editable *in Klaviyo*. But the `definition` schema is Klaviyo-proprietary (vendor lock at the artifact layer, against the eject doctrine), unversioned by us, and the human-edit surface would be Klaviyo's editor — outside our canvas, our nonce detection, and our brand-token mechanics. Worth a spike after MVP: emitting `USER_DRAGGABLE` hybrid instead of `CODE` may give merchants light in-Klaviyo editing without ceding the pipeline. |
| **Skeleton + slots (chosen)** | **Position** | The skeleton inherits the store's deliverability-proven, client-tested frame (their emails already render in their subscribers' clients); boards carry brand expression with canvas editability and token lineage; HTML carries everything textual. Each layer is owned by the tool best at it. |

## 2. Surface kinds — position: one surface, multi-board

**`email.campaign` — one DesignSurface per campaign, one board per visual block** (board names = slot names). Not `email.hero`/`email.section` as separate surfaces.

Why: the human review unit is *the campaign* — "Open canvas" must show all visual blocks side by side in one file, edited in one session, with one `edited` flag feeding one approval nonce. Per-section surfaces would mean N files, N canvas links, N webhook subscriptions per campaign for zero benefit. Export is already per-board (`exportSurface` takes `objectId` — shipped, see `packages/design-surfaces/src/surface.ts`), so per-section re-export works within one surface.

**Required extension (WS2-R1):** the shipped `ComposeSpec` takes a single `board`; extend to `boards: BoardSpec[]` (one page, boards laid out in a column with a gutter). `@penpot/library` supports multiple boards per page; `composeSurfaceFile` loops what it does today. Backward-compatible (`board` remains as sugar for one-element `boards`). Fallback if the extension slips: N single-board surfaces grouped by `boundTo` — works, ships uglier, migrate later.

Board geometry: **600px logical width** (the email-safe standard the skeletons will assume), section-appropriate heights (hero 600×750, banner 600×200, product feature 600×740 — set per compose template). **Export at scale=2 → 1200px-wide PNG** for retina; rendered in HTML at `width="600"`. Klaviyo Images accepts PNG ≤5MB (03 §5) — 1200px-wide PNGs sit comfortably under; add a JPEG-fallback compression step for photographic heroes that exceed it.

## 3. Reference-template ingestion (the skeleton's origin)

The store's existing Klaviyo marketing emails are the structural seed — day-one output looks like *their* program, and their frame is already proven across their subscribers' mail clients.

Pipeline (WS1-R4 + WS2-R3):

1. **Fetch** — `klaviyo_templates_read` lists the account's templates with `editor_type` + HTML (03 §3: single-GET includes content). The agent (or the owner in the connect flow) picks 1–3 representative *marketing campaign* templates — recency- and usage-weighted suggestions.
2. **Inline** — resolve any universal content blocks by fetching and inlining them (03 §3: block references can't survive in API payloads anyway).
3. **Extract the skeleton** — the assembly package's analyzer separates *frame* from *content*: preserve doctype/head/meta/MSO conditionals, outer table scaffolding, header/logo block, footer/legal/unsubscribe (**preserve Klaviyo's unsubscribe merge tags verbatim** — `{% unsubscribe %}` etc.; breaking them is a compliance incident), spacing system. Content regions become **named slots** (`{{slot:hero}}`, `{{slot:body-1}}`, `{{slot:products}}`, `{{slot:cta}}`) with recorded constraints (max width, background color at that point, padding context — what the board composer and copy renderer must match).
4. **Sanitize** — strip tracking pixels/scripts foreign to Klaviyo, dead links, campaign-specific copy; normalize to the skeleton's own tokens where the store's colors match DESIGN.md (record mismatches — a brand-drift finding worth surfacing to the owner, spec 21's coherence-check discipline).
5. **Approve** — the skeleton is proposed to the owner (rendered preview, side-by-side with the source email), approved into `email/templates/skeletons/{id}/` with provenance front matter (source template id, ingested-at, transforms applied, owner approval). Skeletons are versioned artifacts like everything else.

**Honesty about step 3:** frame/content separation over arbitrary email HTML is heuristic. It will be LLM-assisted (classify regions) + rule-verified (the invariants — unsubscribe present, single 600px column, valid HTML — are mechanical checks), and the owner-approval gate is what makes heuristic acceptable. Budget for hand-tuning Arthaus's first skeleton; the *product* is the pipeline plus the gate, not magic extraction. **Cold start** (no usable templates): PRD §8 Q5 — a platform default skeleton, brand-tokenized, is the likely answer; decide before WS2 exits.

## 4. The assembly pipeline, end to end

```
campaign.md (sections[], copy, skeletonRef)
  ├─ visual sections → compose lane (spec 23 Lane 1, shipped):
  │     email compose template (per archetype/section type)
  │     + DTCG tokens (DESIGN.md via brand-md, auto-loaded per tenant — as-built in hosted runtime)
  │     + payload (imagery: BS2b harness / product shots; display copy)
  │     → DesignSurface kind "email.campaign" (multi-board)
  │     → [optional human pass: Open canvas — full-window until DS4]
  │     → exportSurface per board (PNG @2x) → email/campaigns/{id}/assets/  [spec 23 export contract]
  ├─ copy sections → brand.md copy formulas (spec 22 D5 injection) → HTML fragments
  │     styled from the SAME DTCG tokens compiled to inline CSS (email-safe subset)
  └─ assembleEmail(skeleton, sections, tokens):
        slots filled in order; images uploaded to Klaviyo Images → image_url substituted (03 §5);
        alt text mandatory per image (from the section's content payload, §5);
        invariant checks (§6) → email/campaigns/{id}/email.html
  → email_render_preview (ungated read) → human sees the real email
  → klaviyo.create_campaign_draft (Action): template(CODE) + campaign + assign (03 §4)
```

**Brand tokens flow — one source, two renderers:** DESIGN.md front matter → `compileDesignTokens` (shipped, `packages/brand-md/src/dtcg.ts`) → (a) into the composed Penpot file for boards (as-built), and (b) into the assembler's CSS emitter for HTML sections (new, WS2): color/typography/spacing tokens → inline styles + `<font>`-safe fallbacks. The email register's tokens (brand.md tone table / DESIGN.md editorial register) drive both, so a board and the paragraph below it agree by construction, with `brandLineage.tokensVersion` recorded on the surface and the token version stamped in campaign.md.

## 5. Fidelity, responsiveness, dark mode, alt text — the honest analysis

- **Fidelity.** Boards are pixel-exact everywhere images render — that's the win. HTML sections are only as consistent as email CSS allows: the assembler emits table-based, inline-styled, Outlook-conditional HTML from a *small fixed vocabulary of section renderers* (paragraph, heading, button, product-row, spacer) — hand-hardened once, reused everywhere, never free-form LLM HTML. Web fonts: emit `@font-face`/Google-font links with system-stack fallbacks (Outlook ignores web fonts); the *brand-critical* type moments live in boards where the font is rasterized and guaranteed.
- **Responsiveness.** Skeleton is fluid-hybrid (single 600px column, `max-width:100%`). Boards scale as whole images — acceptable for 600px-wide art at @2x on phones (~face 320–430px, effectively >2.7x density). What must NOT be in boards: multi-column layouts that should stack (product grids are an HTML section renderer that stacks via media query with table fallback), and body text that would scale below ~13px effective (the display-type-only rule, §0).
- **Dark mode.** Clients invert HTML backgrounds/text unpredictably; images are untouched — which makes a white-background board float as a glaring slab on a dark client. Mitigations, in order: (a) boards carry their own background to their edges (no board-edge whitespace — the compose templates enforce it); (b) HTML sections use the token palette's dark-safe pairs and `color-scheme`/`supported-color-schemes` meta + `@media (prefers-color-scheme: dark)` overrides emitted from tokens where the DESIGN.md palette defines them; (c) accept imperfection honestly — dark mode in email is damage control, not control; the recap of v1 QA (WS2 acceptance) is a screenshot matrix (Gmail web/iOS, Apple Mail light/dark, Outlook Windows) for the Arthaus skeleton + section renderers, not a promise of universal perfection.
- **Alt text.** Mandatory, mechanically: `assembleEmail` **fails** on any image lacking alt text. Board alt text is generated from the section's content payload (the campaign.md section spec carries `alt` authored by the agent at compose time, editable by the human) — it describes the *message* ("Autumn arrivals: three framed botanical prints over a walnut console"), not the pixels. Decorative spacers get `alt=""` + `role="presentation"`.
- **Weight & clipping.** Gmail clips HTML over ~102KB (images don't count — they're referenced). The skeleton+renderer vocabulary keeps HTML small by construction; assembler warns >80KB, fails >100KB.
- **Where pure HTML beats image slices, enumerated** (the §0 rule's rationale, kept visible): unsubscribe/legal (compliance), body copy (screen readers, dark mode, copy edits without re-export, text-to-image ratio for spam scoring), product names/prices (data-accurate at send time, re-render without canvas), CTAs/buttons (tap targets, VML-safe bulletproof buttons, link tracking), preheader text (invisible-but-parsed), anything localized later.

## 6. Assembly invariants (the mechanical gate before any Klaviyo write)

`assembleEmail` validates, hard-failing the draft Action's preview on violation:

1. Unsubscribe merge tag present and untouched.
2. Every `<img>` has alt (or explicit decorative marking); every image URL is a Klaviyo-hosted `image_url`.
3. Single-column ≤600px frame intact; HTML ≤100KB; total image weight warning >1.5MB.
4. All links resolve; UTM decoration is delegated to Klaviyo's `is_add_utm` (03 §4) — the assembler does NOT rewrite links, it verifies they're decoration-compatible (no fragments-only, no mailto in CTAs).
5. Text-to-image sanity: at least one non-trivial HTML text section; subject/preview text present and within length budgets (subject ≤ ~60 chars warn, preview 40–130).
6. Token lineage recorded: tokensVersion + designMdVersion + skeleton version stamped into an HTML comment + campaign.md.

## 7. Compose templates (the per-archetype visual vocabulary)

Spec 23 §4's rule — templates absorb complexity, composition fills slots. WS2 authors an initial email template set as code-level compose functions (the shipped `ComposeSpec` path), one per section type: `hero` (image + display line), `product-feature` (product shot on token background + name/price *rendered in the HTML below it*, not in the board), `promo-banner`, `editorial-moment`. Later these graduate to designed `.penpot` template files stamped per tenant (spec 23 §5's library flow — `clone-template` + payload injection) when the template-library stamping lands (REVISIT deferral: DS3's remaining item). v1 does not wait for that.

## 8. Switching criteria (when to abandon the position)

Revisit the pipeline if any of these trip during WS2/Arthaus validation:
- Skeleton extraction needs >2 days of hand-tuning per store → invest in the platform default skeleton + treat ingestion as enhancement.
- Board-image dark-mode complaints dominate Arthaus feedback → shift more section types to HTML renderers; boards retreat to pure photography.
- Klaviyo's Brand APIs + drag-drop `definition` mature into a tokenizable, versionable target (03 §11) → spike the `USER_DRAGGABLE` emit.
- Penpot ships the file-based server API + SVG-to-email-HTML proves viable → boards could emit HTML for simple sections; the slot contract already permits per-section `type: "html"`.
