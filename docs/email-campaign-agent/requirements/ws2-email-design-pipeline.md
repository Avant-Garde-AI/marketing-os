# WS2 — Email Design Pipeline

> **Objective:** from a campaign spec, produce inbox-ready `email.html`: visual blocks composed as multi-board design surfaces from brand tokens, copy sections rendered as email-safe HTML from the same tokens, both assembled into a store-derived skeleton — deterministic, invariant-checked, canvas-editable.
>
> **Grounding docs:** 04-DESIGN-SURFACE-PIPELINE.md (the position + pipeline — read in full), spec/23 §2/§4/§6, `packages/design-surfaces` (shipped compose/export seams), `packages/brand-md/src/dtcg.ts` (token compiler). All work in **marketing-os**; no Klaviyo calls here except via WS1 fixtures.

## In scope
Multi-board ComposeSpec extension; email compose templates (section vocabulary); skeleton extraction/sanitization from fetched reference templates; `packages/email-assembly` (slots, token-CSS emitter, invariants); alt-text/dark-mode/weight discipline; the client-rendering QA matrix.

## Out of scope
Fetching templates from Klaviyo (WS1-R4), image upload to Klaviyo (WS3's draft Action uses WS1's client), Actions/lifecycle, console preview route (WS4), video/AMP.

---

## WS2-R1 — Multi-board ComposeSpec *(packages/design-surfaces)*

Extend `ComposeSpec` to `boards: BoardSpec[]` on one page (04 §2): named boards laid out in a column with a fixed gutter; `board` (singular) remains as sugar. `createSurface` unchanged; `exportSurface` already takes `objectId` — add `exportSurfaceBoards(adapter, {fileId, pageId, names?})` returning per-board artifacts keyed by board name.

**Acceptance:**
- A 3-board file composes, imports, opens correctly in the Penpot editor, and each board exports independently (PNG @2x) with correct dimensions.
- Existing single-board callers (social, demo scripts) pass untouched; **canary suite extended** for multi-board import/export (spec 23 §8 — never add an adapter behavior without a canary; run green against design.avant-garde.ai).
- Board names round-trip (compose → getFileStructure → export selection by name).

**Dependencies:** none (shipped package). **Fallback** if `@penpot/library` fights multi-board: N single-board surfaces grouped by `boundTo` (04 §2) — decide within the first week, don't grind.

## WS2-R2 — Email compose templates *(packages/design-surfaces or a sibling `email-templates` module in the pack — implementer's call, keep spec 23's separation rule: design-surfaces stays domain-agnostic, so email-specific templates belong pack-side)*

The v1 section vocabulary as compose functions (04 §7): `hero` (600×750), `promo-banner` (600×200), `product-feature` (600×740, product shot on token background — name/price stay HTML), `editorial-moment`. Each takes `(tokens, payload) → BoardSpec`; backgrounds extend to board edges (the dark-mode rule, 04 §5); display type only.

**Acceptance:**
- Each template composes from real Arthaus DESIGN.md tokens + fixture imagery into an on-brand board (visual check vs the brand palette/type, the demo-arthaus precedent).
- Payload schema per template is typed + documented (WS3's drafting flow authors these payloads).
- No template renders body text ≥ the information-in-images line (04 §0 rule) — reviewed, not automated.

**Dependencies:** WS2-R1.

## WS2-R3 — Skeleton extraction + sanitization *(packages/email-assembly)*

`extractSkeleton(templateHtml) → {skeletonHtml, slots[], findings[]}` per 04 §3: preserve frame/head/MSO/footer, **preserve Klaviyo unsubscribe merge tags verbatim**, identify content regions → named slots with constraints (width, background context, padding), strip campaign-specific content, record findings (including brand-drift notes where the template's colors diverge from DESIGN.md). LLM-assisted region classification is allowed at the *tooling* layer, but the package's checkable invariants are mechanical: unsubscribe present, single ≤600px column, valid HTML, ≥1 slot.

**Acceptance:**
- Arthaus's real reference template(s) (fetched via WS1-R4) extract to a skeleton the owner approves; the assembled result (R4) side-by-sides credibly against the source email.
- Fixture suite: ≥3 real-world template styles (drag-drop-generated, hand-coded, hybrid) extract without invariant violations; hostile fixture (no unsubscribe) hard-fails.
- Output serializes to `email/templates/skeletons/{id}/` shape (02 §3) with provenance front matter.

**Dependencies:** WS1-R4 output shape (coordinate early; fixtures unblock before WS1 lands).
**Open question:** cold start / unusable templates → PRD §8 Q5 (platform default skeleton — build the one default in this WS if Garrett says yes).

## WS2-R4 — Assembly + token CSS emitter *(packages/email-assembly)*

`assembleEmail(skeleton, sections, copy, tokens) → {html, report}` (04 §4): fills slots in order; section type `surface` gets an `<img>` referencing a caller-supplied URL (Klaviyo image_url in prod — the assembler takes URLs, it never uploads) with mandatory alt; section type `html` renders via the fixed renderer vocabulary (paragraph, heading, button/bulletproof CTA, product-row with stacking, spacer) styled from DTCG tokens compiled to inline email-safe CSS + dark-mode meta/media-query emission (04 §5). Deterministic: same inputs → byte-identical output (nonce hashing depends on it).

**Acceptance:**
- All 04 §6 invariants implemented, each with a failing test (missing alt fails; >100KB fails; missing unsubscribe fails; non-Klaviyo image host fails in strict mode).
- Determinism test: double-run byte equality.
- Renderer vocabulary output validated against the QA matrix (R5).
- Golden-file test: full Arthaus campaign fixture (skeleton + 2 boards + 3 copy sections) → committed golden HTML.

**Dependencies:** WS2-R3 (skeleton shape), brand-md tokens (shipped).

## WS2-R5 — Client-rendering QA matrix *(process + fixtures, not code)*

One documented render pass of the golden email across: Gmail (web + iOS app), Apple Mail (light + dark), Outlook Windows (classic), Outlook.com. Record screenshots + verdicts in `docs/email-campaign-agent/qa/` (or Litmus/Email-on-Acid if Garrett approves a tool spend — open question). Fix renderer bugs found; re-run.

**Acceptance:** the matrix exists with pass/annotated-known-issue per client; no blank-render or broken-layout failures; dark-mode behavior documented honestly (04 §5's damage-control framing).

---

## Open questions (human)
1. PRD §8 Q5 — platform default skeleton: build here or hard-require ingestion?
2. R5 — approve a rendering-test tool subscription, or manual-clients-only for v1?
3. Custom brand fonts (REVISIT #8: per-team Penpot font upload untested) — Arthaus's boards currently use Google-font ids; is that acceptable for v1 email boards, or does font upload join this WS?
4. JPEG fallback threshold for photographic heroes (04 §2) — fixed 5MB guard only, or quality-targeted recompress?
