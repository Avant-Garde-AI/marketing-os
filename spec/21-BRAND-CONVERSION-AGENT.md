# 21 — Brand Conversion Design Agent & Skill Pack

> **Status:** DRAFT — the first concrete skill pack for the Capability Suite (spec 20). Reconciles the BCD agent+7-skills design with the as-built execution substrate.
> **Depends on:** 20-CAPABILITY-SUITE (Action framework — the read/write split), design-loop (`@avant-garde/design-loop` — the render→see→refine implementer, SHIPPED), 11-HOSTED-PATH D1 (draft-theme review loop), 17-RICH-SURFACES S-E (approval card), 15-SLACK (surface), 19-SCHEDULED-REPORTS (the score as a north-star report).
> **Numbering note:** authored externally as "11"; spec 11 is Hosted Path, so this is **spec 21**.
> **First target:** Arthaus, Vaan Group brands.

---

## 0. The framework (Vaan Group's thesis, encoded)

> A website must serve two functions — **anchor your brand world** and **transact customers relentlessly.**

**Brand Conversion Design (BCD)** is the discipline in the overlap. Most agencies pick a side: brand shops make beautiful sites that underperform; CRO shops make optimized sites that are off-brand. BCD treats them as inseparable — validated by Vaan's results (Stadium Goods +80% CVR / +46% ATC; HexClad +13% RPU / +25% CVR; Makeup By Mario +20% CVR / +22% RPU).

Three interlocking layers, each with evaluation dimensions:
1. **Brand Identity & Expression** — voice, visual system, positioning, story, trust architecture.
2. **Conversion & Performance** — heuristics, friction, funnel, page structure, add-to-cart path.
3. **Brand Conversion Synthesis** — the overlap: does the brand expression *itself* drive conversion, and does the optimization *reinforce* the brand? Problem-centric, hypothesis-driven — never solving problems that don't matter.

**The agent's governing rule:** every recommendation must serve *both* brand expression AND conversion. It never proposes generic CRO disconnected from identity, and never proposes brand polish that ignores conversion.

## 1. The `brand-conversion-agent`

A specialist sub-agent (a skill wrapping an agent, per spec 20 §1). Conversational, Slack-facing. It **analyzes** (reads) and **proposes changes** (Actions) — it never mutates the storefront itself. It sits above the design-loop implementer and delegates code work to it through the Design Work Contract.

## 2. The 7 skills, mapped onto the Action framework

The BCD design splits naturally along spec 20's line — **the sync skills are reads (compose freely, no gate); the async skills are Actions (gated writes through the approval card).**

### Reads — analysis (sync, no gate, render as branded cards)
| Skill | Produces |
|---|---|
| **brand-conversion-profile** | Foundational assessment: brand identity, positioning, trust architecture, conversion readiness → a **composite Brand Conversion Score (0–100)**. |
| **storefront-heuristic-audit** | Page-by-page UX audit vs Baymard/NNG heuristics; pass / warning / fail findings, each tagged brand-side, conversion-side, or synthesis. |
| **brand-conversion-scorecard** | Executive scorecard: 9 category scores, letter grade (A+…F), top-5 prioritized action plan. |
| **copy-coherence-check** | Voice consistency across page types; flags tone drift; proposes `brand-voice.md` updates. |

These render as **branded cards** in Slack (the renderer from spec 17 — the scorecard is a natural KPI/grade card) and in the console. They compose freely because they change nothing.

### Actions — implementation (async, gated writes → draft-theme proposal)
| Skill (Action `kind`) | What it changes | Gate |
|---|---|---|
| **quick-win-generator** (`bcd.quick_wins`) | Batches audit quick-wins into a theme change. | medium |
| **homepage-optimizer** (`bcd.optimize_homepage`) | Rewrites hero copy + section structure per BCD. | medium |
| **pdp-enhancer** (`bcd.enhance_pdp`) | Restructures PDP to educate AND convert (trust signals, add-to-cart area). | medium |

Each is an `Action<P>` (spec 20 §2): `scopes: ["storefront:write"]`, `preview()` returns the **draft-theme preview URL**, `execute()` dispatches to the design-loop, audited on completion.

## 3. The reconciliation — no new execution infra

The BCD design says the async skills "dispatch to Claude Code for implementation as theme PRs." The as-built reality is better and already shipped:

```
brand-conversion-agent  (proposes)
  → Action.execute()  emits a TaskSpec (Design Work Contract)
  → @avant-garde/design-loop deep agent   [render → see → refine → conform, SHIPPED]
  → WorkReport → draft-theme proposal (spec 11 D1, createProposal)
  → approval card in Slack (spec 17 S-E, BUILT)  → Approve → publishTheme → audit
```

So a BCD Action's `execute()` is **not** a generic Claude Code dispatch — it's a `TaskSpec` handed to the design-loop, whose `WorkReport` becomes a **draft-theme proposal**, whose review is the **approval card we already shipped**. `preview()` = the draft-theme preview URL the merchant clicks to see the change live before approving.

**This is the whole point of spec 20 proving out:** BCD adds skills and intelligence, not plumbing. The implementer (design-loop), the change ledger (draft themes), the gate (approval card), and the surface (Slack) all exist. BCD is the first pack that composes them end to end.

## 4. The Brand Conversion Score as a north star

The composite score (0–100) from `brand-conversion-profile` is the metric a brand tracks over time. Wire it into spec 19: a saved **"Brand Conversion Score"** report that runs the profile monthly and posts the score + delta + the top movers as a branded card into Slack — the score becoming the recurring, ambient signal, and each shipped Action's effect visible as a score change.

## 5. Skill package (spec 20 §5 / spec 05 §3)

```ts
export const metadata = { id: "brand-conversion", name: "Brand Conversion Design", category: "optimization", version, author: "Vaan Group / Marketing OS" };
export const requires = { providers: ["shopify"], scopes: ["storefront:write"] };
export const tools    = { brandConversionProfile, storefrontHeuristicAudit, brandConversionScorecard, copyCoherenceCheck }; // reads
export const actions  = [ bcdQuickWins, bcdOptimizeHomepage, bcdEnhancePdp ];                                              // gated writes → design-loop
export const instructions = "…the BCD discipline: every rec serves brand AND conversion…";
export const reports  = [ brandConversionScoreMonthly ];  // spec 19
```

Ships in `packages/skills/brand-conversion/` (OSS, this repo); per-tenant enable merges tools+instructions at request time (the dynamic-merge pattern from spec 18). It's the reference implementation of a spec-20 skill pack.

## 6. Build phases

- **B0 — Reads first — DONE + LIVE 2026-07-09.** `brand-conversion-profile` + `brand-conversion-scorecard` as tools, rendered as branded scorecard/grade cards in Slack. Immediate value, zero write-risk, and it exercises the score. (`storefront-heuristic-audit`, `copy-coherence-check` follow.)
- **B1 — The score report — DONE + LIVE 2026-07-09** (built-in `scorecard` report; runnable + schedulable). Wire `brand-conversion-profile` into a spec-19 monthly report.
- **B2 — First Action.** `bcd.quick_wins` on the spec-20 Action framework → design-loop `TaskSpec` → draft-theme proposal → the existing approval card. Proves the read→propose→approve→implement loop for BCD.
- **B3 — homepage-optimizer + pdp-enhancer** as Actions on the same rails.
- **B4 — Skill-pack packaging** in `packages/skills/` + registry enable.

**B0/B1 depend on nothing new** (reads + report + card). **B2+ depend on spec 20 A0/A1** (the Action framework) — which is the reason to build A0 first.

## 7. Non-goals (v1)

- No autonomous storefront edits — every BCD Action goes through the approval card (a store's live theme is sacred; spec 11 D1).
- BCD does not replace the design-loop's internal guardrails (dark-pattern blocklist, conformance gates) — it feeds them work; they still gate.
- The heuristic knowledge (Baymard/NNG) is encoded as evaluation dimensions, not scraped live.

## 8. Open questions

1. **Score methodology** — the 0–100 composite weighting across the 9 categories needs to be defined and defensible (brands will anchor on it).
2. **Sequencing vs the design-loop plan** — `docs/plans/brand-conversion-design-agent/` (the implementer roadmap, Phases 1–8, mostly shipped) is the substrate; this spec is the *conversational + Action* layer above it. Phase 5 (NeuroGraph persona fork) would let the profile ground brand assessment in persona data.
3. **Read caching** — the profile/audit are expensive (multi-page); cache per store with a freshness window, like the semantic model.
