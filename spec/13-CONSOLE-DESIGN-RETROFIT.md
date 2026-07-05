# 13 — Console Design Retrofit

> **Status:** Draft for review · July 2026
> **Owner:** Design/front-end (hosted admin UI workstream)
> **Applies to:** `packages/marketing-os/templates/agents/` — the single console template tree that serves **both** the client-owned deploy and the hosted console (11-HOSTED-PATH §6, Invariant #1: one tree, config-driven, never a fork). Retrofit it once, both paths get it.
> **Reference surfaces:** [avant-garde.ai](https://avant-garde.ai) (the framing + design language source of truth, live), `brand/` (tokens, typography, voice — the codified system).
> *(Spec 12 = Store MCP + Semantic Layer, tracked in the phase commits.)*

---

## 0. Why

The current console is **over-engineered against the wrong axis**. We ported the brand's high-end editorial system faithfully — and then ran it at full intensity on every pixel of a working tool. The result is hard to use:

| Problem | Evidence |
|---|---|
| **Runs the brand's *exception* surface as its *default*** | `app/layout.tsx.hbs:15` hardcodes `<html className="dark">` → whole console renders on navy. The brand system (`brand/colors.md`) is explicit: **cream is the default page background**; navy is an accent context. avant-garde.ai itself is cream-primary. |
| **Editorial chrome outweighs function** | Every screen repeats eyebrow-rule + gold label + Playfair 5xl + Pinyon sign-off around panels that are `--`/"Loading…"/"coming soon". Decoration-to-substance ratio is inverted. |
| **Display type at UI scale kills scannability** | Playfair for data numerals; `tracking-label` (0.2em uppercase) on nav items, tabs, and buttons; `font-light` Lora at 12–14px on navy. Beautiful at 64px on a landing page, illegible as an instrument. |
| **Brand violations inside our own console** | `header.tsx.hbs` uses `rounded-lg` and `font-bold`/`font-semibold` — both explicitly banned (`--radius: 0`, "never bold body text"). |
| **Two token systems fighting** | shadcn semantic vars remapped per mode (`--primary` = navy in light, gold in dark) on top of brand tokens — a restyling foot-gun. |
| **Twitchy motion** | Hover-expand 16→64px sidebar (layout shift on mouse travel), 500ms hovers, per-card accent-bar scale animations, `float`/`marquee` available in an app context. |

**The retrofit thesis: editorial at the edges, instrument at the core.** The avant-garde.ai language — eyebrow rules, mixed roman/italic Playfair, navy quote bands, gold hairlines, the script sign-off — is reserved for *moments* (login, page headers, empty states, the approve ritual). The working surface between those moments becomes a calm, light, quiet instrument: cream canvas, white cards, navy ink, 1px hairlines, gold only where the user can act.

---

## 1. What we reuse from avant-garde.ai (the framing)

Verified against the live site (cream `#FAFAF9` body, Lora/Playfair/Pinyon, `marquee` + `bounce` as the only ambient animations):

| Site pattern | Console reuse |
|---|---|
| Eyebrow: gold rule + tracked uppercase label (`VENTURE STUDIO`) | Page-header eyebrow, **once per page**, nowhere else |
| Mixed roman/*italic* Playfair headline with gold underline ("Agentic *Commerce*, In Practice.") | Login hero + zero/empty states only. Page titles use roman Playfair at instrument scale (§3) |
| Numbered editorial items (ventures 01/02/03, playbooks "Vol. 01") | Skills → **Playbooks** cards carry `Vol.` numbering; activity groups numbered by day |
| Navy full-bleed band with italic serif + script sign-off ("Build in public. *Share everything.*") | The **approve/publish confirmation** moment and the login side panel — the only full-navy surfaces in the app |
| Offset gold-outlined frame behind a navy card (hero quote) | Login quote panel; H3 "proposal" card treatment |
| Stat tiles ("By the numbers": label / large numeral / rule) | Overview metrics — but numerals in Lora tabular, not Playfair (§3) |
| "READ GUIDE →" gold arrow-links | All tertiary actions: `text` + `→`, gold on hover, no button chrome |
| Marquee ticker, bounce scroll cue | **Marketing surfaces only.** Banned inside the console (§5 ban list) |
| Voice: declarative fragments, no exclamation, "In practice" | UI copy system (§7) |

**Navigation vocabulary borrowed from the site:** `Overview · Chat · Playbooks · Activity` (Skills → *Playbooks*: matches the site's framing and the skill-library concept; "Dashboard" → *Overview*).

---

## 2. Token system (R0 — the foundation flip)

One semantic layer, **light-primary**, replacing the dual shadcn/brand mapping. Values from `brand/tokens.css`:

```css
:root {
  /* surfaces */
  --surface-page:    #FAFAF9;              /* cream — the default, always */
  --surface-raised:  #FFFFFF;              /* cards/panels on cream */
  --surface-inverse: #1B263B;              /* navy — “moment” bands only */

  /* ink (navy + opacity does all secondary work; never #000) */
  --ink:        #1B263B;
  --ink-2:      hsl(218 37% 17% / 0.70);   /* secondary text */
  --ink-3:      hsl(218 37% 17% / 0.50);   /* placeholder/disabled */
  --hairline:   hsl(218 37% 17% / 0.12);   /* borders, rules, dividers */

  /* accent — gold is interactive, never a large fill */
  --accent:       #C4A47C;
  --accent-quiet: hsl(34 33% 63% / 0.12);  /* hover washes, selected bg */

  /* shape & elevation */
  --radius: 0px;                            /* non-negotiable */
  --shadow-card: 0 4px 20px -4px rgb(0 0 0 / 0.05);

  /* motion (§5) */
  --dur-micro: 160ms;  --dur-move: 240ms;  --dur-moment: 400ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in:  cubic-bezier(0.7, 0, 0.84, 0);
}
```

Rules:
- **Delete the `dark` class from `layout.tsx.hbs`.** There is no app-level dark mode in v1; navy is a *component* surface (`data-surface="inverse"`), not a theme.
- Status without traffic lights (brand: no red/green/blue UI hues): state is carried by **wording + weight + fill** — e.g. `In practice` (navy chip, filled), `Draft` (outline), `Needs review` (gold hairline underline), `Failed` (navy chip + explicit word; the one permitted `#c9252d` is destructive-action text only).
- Gold usage test: *if the user can't click it, act on it, or isn't being pointed at it — it isn't gold.*

## 3. Typography (the usability retailoring)

Serif stays (brand: no sans anywhere), but split into **two registers**:

**Editorial register** — moments only:
- Playfair Display 40–72px, roman + *italic* mixes, gold underline rule. Login, empty states, approve confirmation.
- Pinyon Script 24px+, one per surface max, always reduced opacity.

**Instrument register** — everything else:
- **Page title:** Playfair roman, 28–30px, normal tracking. One per page.
- **Section/card heads:** Lora 500, 15–16px. *(Lora medium replaces the banned bold — and replaces tracked-uppercase in all functional positions.)*
- **Body/UI:** Lora 400, 14–15px, `line-height: 1.55`, normal tracking. `font-light` is banned below 18px.
- **Data numerals:** Lora 400, 24–28px, **`font-feature-settings: "tnum"`** (tabular figures) — metrics, counts, tables. Playfair never sets data.
- **Eyebrow (only surviving tracked-uppercase):** Lora 500, 11px, `tracking: 0.2em`, gold + rule. Page headers and moment bands only. Buttons, tabs, and nav items use sentence-case Lora 500 — no tracking, no uppercase.

## 4. Shell & screens (IA + the per-screen retrofit)

**Shell:** fixed left rail, **240px, always labeled** (replaces hover-expand — no layout shift, no discovery tax). Cream rail on cream page separated by a hairline; navy ink items; active item = gold 2px left bar + `--accent-quiet` wash. Collapse to 64px is a *click*, persisted, never hover. Top: wordmark (sharp-cornered tile — fixes `rounded-lg`). Bottom: store identity + settings. Content column: `max-w-[1200px]`, 32px gutters, page header pattern (eyebrow → Playfair 28px title → one-line Lora sub) with `mb-8`.

| Screen | Retrofit |
|---|---|
| **Overview** (was Dashboard) | 4 stat tiles in site "By the numbers" form: eyebrow label / Lora-tabular 28px numeral / hairline / delta as `+12% vs last week` in ink-2. Cards `p-5`, no accent bar at rest (bar = hover/active only, 2px). Below, the two panels that earn the page: **Needs your review** (proposals/PRs — H3 hook) and **Recent activity**. Every tile has designed loading (hairline shimmer, no "Loading…" text), empty, and error states. |
| **Chat** | The primary work surface. 720px measure, composer pinned bottom (Lora 15px), streaming = plain token fade-in. Agent tool-calls render as quiet hairline cards; a storefront-change proposal renders as the **proposal card** (gold-outlined offset frame, site hero-quote treatment) with `Approve → / Request changes` — the seam where H3's draft-theme review loop lands. |
| **Playbooks** (was Skills) | Site playbook-card form: `Vol. 01` numeral, Lora 500 title, one-line description, `Run →` arrow-link. Run state inline on the card (In practice / Draft chips). No "coming soon" cards — unavailable playbooks appear as a single quiet footer line. |
| **Activity** | Hairline timeline grouped by day, each entry: time (tabular) · actor · action · object → arrow-link to artifact. Empty state is an editorial moment: *"Nothing yet. Every action your agents take lands here — in practice."* |
| **Login** | The one full-editorial screen. Split panel: cream form side (email magic-link, gold focus ring) · navy quote side reusing the site hero-quote card + a manifesto line, Pinyon "Avant-Garde." sign-off. |
| **Review & Approve** *(forward-spec for H2/H3)* | Draft-theme preview (iframe) + change summary + the design-loop **WorkReport** readout (conformance score, gates as filled/outline chips, iterations) + `Approve & publish`. Approval triggers the signature motion (§5). This screen is why the retrofit lands before H3 builds. |

**Embedded tier (D3: Shopify admin is the front door).** Inside the iframe, full editorial clashes with Polaris chrome. Define `data-surface="embedded"`: page bg inherits host (no cream), radius stays 0 *within our components*, navy ink + gold accents retained, **no** Playfair above 22px, no script, no moment bands, motion micro-tier only. The standalone deploy runs the full system; embedded runs the quiet tier. Same components, one attribute.

## 5. Motion system

**Principles:** motion communicates state-change, never decorates idle screens. Entry `--ease-out`, exit `--ease-in`. Three tiers — micro `160ms` (hover, focus, press, chip fills), move `240ms` (panels, route content, list insertions), moment `400ms` (the ritual beats). `prefers-reduced-motion` collapses everything to opacity-only ≤80ms, globally, no exceptions.

**Signature motions (the ones with a name):**
1. **Page enter** — content rises 12px + fades, 280ms, staggered 40ms across at most 3 groups (header → primary panel → rest). Never on tab-switches within a page.
2. **Rule draw** — the eyebrow's gold hairline draws in (`scaleX 0→1`, left-origin, 400ms) on page enter. The site's rule motif, made kinetic. Once per page load.
3. **The approval** — the single theatrical beat, reserved for publish: button press → gold hairline progresses across the proposal card → card resolves into a navy band sliding up 400ms: *"Published. In practice."* + Pinyon "Avant-Garde." This is the brand's payoff moment; nothing else in the app is allowed this much drama.
4. **Streaming** — chat tokens fade in at 80ms; tool-call cards expand 240ms height-auto. No pulsing, no bouncing dots — a thin gold underline shimmer on the streaming message is the busy indicator.
5. **Rail** — active-item gold bar slides between items 160ms. Collapse/expand 240ms on click.

**Ban list (app context):** `marquee`, `float`, `bounce`, hover-triggered layout shifts (incl. the old sidebar), hover transforms >2px, any transition ≥500ms, skeleton pulse (use hairline shimmer), parallax.

## 6. Component retrofit checklist (concrete)

- `app/layout.tsx.hbs` — remove `className="dark"`; add motion + reduced-motion tokens.
- `app/globals.css` + `tailwind.config.ts` — replace dual semantic mapping with §2 token layer; add `tracking` sanity (kill `tracking-label` outside eyebrow); add `tnum` utility.
- `components/header.tsx.hbs` — drop `rounded-lg`, `font-bold`/`font-semibold`; sharp tile + Lora 500.
- `components/nav.tsx` — hover-expand → fixed labeled rail (§4).
- `components/ui/*` (shadcn) — audit to radius-0, hairline borders, Lora 500 labels, gold focus ring; delete unused variants; keep `brand`/`brand-outline` as the *only* button variants + `arrow-link`.
- `metric-card` / `skill-card` / `pr-card` — rebuild to §4 forms (accent bar on hover/active only, 2px).
- New: `PageHeader`, `Eyebrow`, `StatTile`, `ProposalCard`, `MomentBand`, `Chip`, `Timeline`, `EmptyState` — the 8 primitives every screen composes from.
- All screens: designed loading/empty/error states; **no literal "Loading…" or "coming soon" text anywhere.**

## 7. Voice in the UI

Per `brand/voice-and-tone.md` + site copy: declarative fragments with periods. No exclamation marks, no emojis, no "leverage/synergy/cutting-edge". Buttons are verbs (`Approve & publish`, `Run`, `Connect`). Empty states are editorial one-liners, not apologies. Errors are quiet and factual: *"That didn't publish. The theme preview is unchanged."* The phrase **"In practice"** is the system's status vocabulary for *live/working* — reuse it wherever we'd otherwise say "active/enabled".

## 8. Build plan

| Phase | Scope | Size | Acceptance |
|---|---|---|---|
| **R0 — Foundation flip** | §2 tokens, kill `dark`, §3 type scale, motion tokens | S | Console renders cream-primary; zero rounded corners; zero `font-bold`; AA contrast on all text (navy/70 on cream passes; verify gold-on-cream is never body text) |
| **R1 — Shell** | Rail + `PageHeader`/`Eyebrow` + nav relabel (Overview/Chat/Playbooks/Activity) | S | No hover layout shift; labeled nav; one eyebrow per page |
| **R2 — Screens** | §4 rebuilds of all five screens + the 8 primitives + real loading/empty/error states; wire Overview metrics to existing Shopify tools | M | No placeholder text; every data view has 3 designed states; screenshot set at 390/768/1440 |
| **R3 — Motion pass** | §5 signatures 1/2/4/5 (approval lands with H3, behind a flag) | S | Reduced-motion audit passes; no banned animations reachable |
| **R4 — Embedded tier** | `data-surface="embedded"` adaptation (for H2 console-in-admin) | S | Console renders acceptably inside Polaris host chrome without editorial clash |
| **R5 — Verification** | **Dogfood design-loop:** run `@avant-garde/design-loop` capture + a11y/dark-pattern gates against the console itself; screenshot baselines become the visual-regression suite | S | Bench-style pass: a11y gate green at AA, baselines committed |

Sequence: R0→R1 in one PR (the flip is atomic), R2 per-screen PRs, R3–R5 independent. R0–R2 is the "much, much better" bar; H3's Review & Approve screen then lands *into* this system instead of inheriting the old one.

**Dependencies / notes:** template-only work (`templates/agents/`), no CLI changes; `upgrade` path ships it to existing scaffolds (Arthaus = first canary, consistent with RELEASING.md). The hosted (H2) console inherits automatically via the one-tree invariant. R5 uses our own published gates — the console should pass the same accessibility floor we impose on merchant storefronts.
