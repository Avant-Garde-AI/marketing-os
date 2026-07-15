# 23 — Design Surfaces: the Penpot Core

> **Status:** DRAFT v2 — direction decided 2026-07-15 (Garrett): **deep, integrated Penpot** — embedded editor canvas + seamlessly managed MCP. **D1–D3 + OQ4 resolved 2026-07-15 (§11); ready for build go.** Supersedes the 2026-07-11 Canva Bridge draft (never committed; its Canva/Figma survey conclusions are distilled in §0's "why Penpot" and the platform-survey memory notes). Grounded in a Penpot platform deep-dive 2026-07-15 (sources at end).
> **Depends on:** 22-BRAND-SOUL (DESIGN.md is what gets compiled into the canvas's brand system), 20-CAPABILITY-SUITE (domain writes gate as Actions; canvas composition does not), 18-EXTERNAL-MCP (the tool-merge mechanics the managed MCP reuses), 13-CONSOLE-DESIGN-RETROFIT (the canvas is a console surface), 11-HOSTED-PATH (per-tenant infra provisioning pattern).
> **Consumed by:** 24-SOCIAL-MEDIA-AGENT (first consumer), then ad creative (NeuroGraph packs), offer surfaces (spec 14), landing-page/editorial work (spec 21 orbit).

---

## 0. Thesis & the separation rule

Marketing OS needs one platform-level answer to "the agent made something visual — where does a human see it, touch it, and bless it?" That answer is the **Design Surface layer**: Penpot, deployed and managed by the platform, wrapped in a first-class primitive, exposed two ways — an **embedded canvas** for humans and a **managed MCP + file-first compose path** for agents.

**The separation rule, stated hard:** this layer knows nothing about social posts, ads, or landing pages. It provides *surfaces* — brand-templated design documents with lifecycle, provenance, and an export contract. Creative capability packs (spec 24 social is the first) own strategy, generation, and domain semantics, and consume surfaces through this layer's seams. The test of the spec: **nothing below this line may mention "social."** The same discipline that keeps spec 20's Action gate domain-agnostic keeps this layer creative-domain-agnostic.

Why Penpot over the surveyed field (Canva: can't write the brand system, Content Planner closed; Figma: `use_figma` beta + seat/allowlist gates, Buzz closed; SDK-class: rent vs own): **open source (MPL-2.0, no SaaS copyleft), self-hostable inside our trust boundary, W3C-DTCG design tokens natively writable, an open file format we can generate, and an official MCP** — the whole surface is ours to integrate as deeply as we want, with zero third-party OAuth, review queues, or per-merchant seats.

## 1. Platform reality (deep-dive findings that shape everything)

| Fact (verified 2026-07-15) | Consequence |
|---|---|
| **The official MCP is not headless.** It drives a plugin inside a *live, focused* editor tab (core team: "not running in a fully headless way yet"); connection drops on tab focus loss. 5 tools, with `execute_code` (arbitrary Plugin-API JS) doing all real work. | Agent composition cannot depend on MCP. Two lanes (§4): **file-first** for headless compose, **MCP** for live co-creative sessions while a human has the canvas open — where a live tab exists by definition. |
| **File-first generation is officially supported:** `@penpot/library` (npm) builds pages/boards/shapes → `.penpot` stream → `import-binfile` RPC. `.penpot` = ZIP of readable JSON + assets. Limits: 1.2.0-RC, "limited feature set." Penpot's AI whitepaper promises a full file-based API (no date). | The headless compose lane exists and is *artifact-shaped* — a generated surface is a file before it's anything else, which matches our files-are-truth doctrine exactly. |
| **Iframe embedding is unsupported and default-blocked** (X-Frame-Options SAMEORIGIN baked into the shipped nginx since 2.14; no config knob). Achievable self-hosted via a bind-mounted nginx header patch (`frame-ancestors` allowlist) + **same-site cookies** (Penpot host must share eTLD+1 with the console; `SameSite=Lax` then flows). One known precedent (Confluence embed, 2025). | Embedding is ours to own, including the patch across upgrades (§3). Same-site is a hard constraint → per-tenant proxy aliasing (D2). Fallback that needs no patch: full-window canvas + view-only share-link embeds. |
| **RPC API is officially "internal"** — live OpenAPI (145 commands) but no stability guarantee. Safe set: file CRUD-lite, `import/export-binfile`, `clone-template`, `duplicate-file`, teams/projects/invitations, webhooks. `update-file` (granular collaborative edits) is hostile — failed external attempts, no support. **Undocumented `POST /api/export`** works (exporter = Puppeteer service; PNG/JPEG/WEBP/SVG/PDF). | Build on the narrow safe set behind our own adapter; never touch `update-file` (that's what the compose lane and MCP are for). Pin versions + canary suite (§8). |
| **Design tokens are native and first-class** (W3C DTCG, sets/themes, JSON import/export; Plugin-API token access since 2.14). Shared libraries are **team-scoped only** (no cross-team sharing). | DESIGN.md → DTCG JSON → per-tenant token import: the brand-system push Canva structurally couldn't do (§5). Team-scoped libraries are fine — brands are per-tenant by construction. |
| **Multi-tenancy:** team → project → file with 4 roles; programmatic provisioning via RPC (`create-team-with-invitations` etc.) and prepl; OIDC SSO (no claim→team mapping; membership = invitations); session minting via `login-with-password` RPC (source-verified, undocumented). Isolation is app-layer; hardening is on the self-hoster; no instance-admin UI yet. | One pooled instance, teams as tenant boundary, a platform **service account** owning all teams, lockdown flags (§7). |
| **No video export** (static + prototypes only). **MPL-2.0 clean for hosted commercial use**; no trademark grant (white-label naming needs care). **No production multi-tenant/embed references found** — we are first-mover, self-supported. Kaleidos: ~$20M raised, employee-owned, Enterprise/$50k-yr private-server tiers exist. | MP4 = external render over exports, deferred (§6). Ship as "Design Studio," not "Penpot," in UI chrome. Budget for the first-mover tax; a paid Kaleidos relationship is an available de-risk (OQ4). |

## 2. The `DesignSurface` primitive

The layer's one exported concept:

```ts
interface DesignSurface {
  id: string;
  tenantId: string;
  kind: string;              // domain-owned: "social.post" | "ad.creative" | "offer.surface" | "landing.section" — opaque to this layer
  boundTo: { type: string; id: string };   // the domain object (post id, offer id, …)
  penpot: { fileId: string; pageId: string; teamId: string };
  brandLineage: { designMdVersion: number; templateId?: string; tokensVersion: number };
  status: "composing" | "ready" | "in_review" | "edited" | "exported";
  exports: ExportArtifact[]; // format, dimensions, sha, repo path
  createdBy: "agent" | "user";
}
```

- **DB:** `mos_design_surfaces` — the index the console, agents, and domain packs query. **Repo:** exports land in the store repo next to their domain artifact (the domain pack chooses where); the `.penpot` source file itself lives in Penpot (its native, versioned home) with `export-binfile` snapshots taken at approval points for eject-portability.
- **Lifecycle contract:** domain packs create (`createSurface(kind, boundTo, template, payload)`), read state, and request exports. The `edited` flag (design modified after last export — via team webhooks) is what lets spec 20 approval nonces detect "what was approved is no longer what's on the canvas."
- **The gate stays at the domain.** Drawing on a canvas is never an Action — it's a draft by construction. The Action is whatever the domain does with the export (publish the post, activate the offer, ship the theme change). This keeps the canvas *free* — humans and agents iterate without ceremony — while nothing leaves the building ungated.

## 3. Penpot as managed infrastructure

- **Topology (D1): one pooled instance** — the 7-service compose stack (frontend, backend, exporter, mcp, postgres, valkey) on platform infra, sized per official guidance (4 CPU/16 GB reaches thousands of users). Per-tenant instances are the eject-tier answer, not the hosted default.
- **Tenant = team**, owned by the platform **service account**; merchant users invited via `create-team-with-invitations` at onboarding, roles mapped from console roles (admin→admin, member→editor).
- **Lockdown:** `disable-registration`, `disable-login-with-password` for humans (OIDC only), email verification on, secure session cookies on, `enable-access-tokens` for the service layer only. The default compose flags are dev-grade and must be inverted. App-layer isolation is a known, accepted limit of v1 (§10 risks); cross-team access-request surfaces are disabled/monitored.
- **Auth into the canvas:** console and Penpot share the platform IdP (OIDC, auto-provision on first login). The console session mints/refreshes the Penpot session server-side (`login-with-password` RPC for the service path; OIDC popup for the first human dance) so opening a canvas never shows a Penpot login.
- **Embedding (D2 — resolved: iframe from the start):** Penpot served on a sibling host of each console domain via **per-tenant reverse-proxy alias** (`design.{tenant-console-domain}` → pooled instance), which satisfies same-site cookies per tenant and lets the proxy inject the per-origin `frame-ancestors` header — the nginx patch lives at *our* proxy, minimizing the fork. The embedded iframe IS the v1 canvas; DS4 proves the proxy-alias + same-site cookie flow end to end before the surface ships. The full-window route and view-only share-link previews exist only as the degradation path (and for clients where framing fails), not as a staging phase.
- **UI naming:** the console says **"Design Studio"** / "Open canvas" — Penpot-powered, not Penpot-branded (MPL grants no trademark rights; attribution in settings/about).

## 4. Agent integration: two lanes + the managed MCP

**Lane 1 — COMPOSE (headless, the default).** All autonomous composition is **file-first**: a platform `@avant-garde/design-surfaces` package wraps `@penpot/library` — `composeSurface(template, tokens, payload)` builds the document (brand template + DTCG tokens + the pack's content payload: text, generated imagery, product shots) → `.penpot` stream → `import-binfile` into the tenant team → surface `ready`. Deterministic, testable, no browser, no MCP, and the generated document is an artifact before it's a canvas. Where `@penpot/library`'s "limited feature set" bites, templates absorb the complexity: rich structure is *designed once* in the editor, and composition fills slots (`clone-template`/`duplicate-file` + payload injection) rather than building from primitives.

**Lane 2 — LIVE (co-creative, human present).** When a human has a canvas open, the tab constraint is satisfied by definition — so the **managed MCP** connects the agent to *that* session: "tighten the headline," "try the gold variant," "align to the grid" happen on the live canvas, chat-driven, while the human watches. This is the BS2b co-creative session upgraded from gallery-selection to shared-canvas. Constraints honored honestly: focus-loss drops (auto-reconnect), one plugin at a time, session-scoped.

**The managed MCP itself:** the platform runs the `penpot-mcp` container (2.16+ ships Redis-routed multi-instance support), exposes it to the agent runtime per tenant through the spec 18 merge mechanics — but as **first-party managed** capability, not a tenant-registered external server: no review-before-enable ceremony, tools present whenever a live session exists. `execute_code` is arbitrary Plugin-API JS — powerful and first-party-authored per invocation, so it is (a) scoped to surface files only, (b) size/complexity-bounded, (c) logged with the session. Composition never gates (§2); the *domain* Action does.

**Roadmap watch:** Penpot's AI whitepaper promises a true file-based server API. When it lands, Lane 1 sheds the `@penpot/library` RC dependency; the seam (`composeSurface`) doesn't change.

## 5. The brand system push (Stage 6 — DISTRIBUTE, re-pointed)

What the Canva draft could only fake, Penpot does natively:

1. **Tokens:** DESIGN.md front matter compiles to a **W3C DTCG JSON** token set (colors, typography, spacing, radii — the two registers as token *themes*) → imported into the tenant team on every DESIGN.md version bump. Token provenance mirrors manifest versions (`brandLineage.tokensVersion`).
2. **Brand template library:** a per-tenant Penpot library file — channel-dimension boards (post/story/pin/banner/email-header), component slots wired to tokens, ✔/✘ usage notes from the guide — stamped into each tenant team (`import-binfile`), regenerated on manifest bumps. Templates are *designed artifacts* themselves: authored once in the editor by us (or evolved by the BS2b exploration loop), versioned in the platform repo as `.penpot` files.
3. **Assets:** logos/wordmarks/reference captures uploaded into the library.

The manifest stays truth; the Penpot brand system is a derived projection with recorded lineage — same discipline as the portal and the (now-superseded) pack.

## 6. Export pipeline

`exportSurface(surfaceId, spec)` → backend `POST /api/export` (undocumented; wrapped in our adapter, exercised by the canary suite) → PNG/JPEG/WEBP/SVG/PDF at declared dimensions/scales → sha'd artifacts into the store repo path the domain pack designates → surface `exported`. **Video:** Penpot is static-only; MP4 (stories/reels) is a later external-render stage (e.g. Remotion/ffmpeg over exported frames) — declared out of this layer's v1 and tracked in spec 24's format question.

## 7. Provisioning & onboarding flow

Tenant onboarding (spec 11 H-series) gains one step: service account creates team → invites merchant users (role-mapped) → imports current brand tokens + template library → records team/library ids on the tenant. Fully scripted via the safe RPC set; re-runnable (idempotent on team existence). Proxy alias + IdP client configured with the tenant's console domain.

## 8. Fork & upgrade discipline (owning first-mover risk)

- **Pin Penpot minor versions**; upgrade deliberately (their own advice: small increments; 2.12/2.8 renamed config out from under operators; 2.14 tightened frame headers).
- **Canary conformance suite** runs against every candidate upgrade before rollout: provisioning RPCs, import/export-binfile round-trip, `/api/export`, token import, session mint, MCP handshake, iframe load under the patched headers. Anything internal we depend on is *named* in the suite — the suite is the honest inventory of our exposure.
- **Patch inventory:** the frame-ancestors header (at our proxy where possible), any compose-stack config. Zero source forks unless forced; if forced, MPL obliges nothing for hosted use but we upstream anyway (community standing is a strategic asset here — see OQ4).

## 9. Consumers & what stays out

- **Spec 24 (social)** — first consumer: post surfaces composed by Lane 1, human pass on the embedded canvas, exports feed the publish Action. Its Canva round-trip section is superseded by this layer's contract.
- **Next in line:** NeuroGraph ad creative (surface kind `ad.creative` — review/edit NeuroGraph renders on-canvas before trafficking), offer surfaces (spec 14 creative), editorial/landing sections, and BS2b visual exploration (candidates as surfaces instead of static gallery images — the co-creative session gets an actual canvas).
- **Out of scope for this layer:** strategy/planning, content generation (packs bring their own payloads), publishing/delivery, and any UI beyond the canvas embed + surface chrome (calendars, galleries, approval cards are domain/console concerns).

## 10. Build phases

- **DS0 — Instance + tenancy spike.** Pooled stack deployed (compose → Helm), locked down, service account, scripted team provisioning, OIDC against the platform IdP. Exit: a scripted "new tenant" lands a team with an invited real user. *Proves the ops story before anything is built on it.*
- **DS1 — Surface primitive + export.** `mos_design_surfaces`, the adapter over the safe RPC set, `exportSurface` via `/api/export`, webhook-driven `edited` detection, canary suite v1. Exit: a hand-made file flows create → export → repo artifact.
- **DS2 — Compose lane.** `@avant-garde/design-surfaces` on `@penpot/library`: template + tokens + payload → imported surface. Exit: agent-composed document opens correctly in the editor. **Unblocks spec 24 SM1.**
- **DS3 — Brand system push.** DESIGN.md → DTCG compile, token import, template library stamping, manifest-bump regeneration (Stage 6 DISTRIBUTE). Arthaus's real tokens as the fixture.
- **DS4 — Embedded canvas (iframe-first, per D2).** Per-tenant proxy alias + frame-ancestors injection, session minting, the iframe embed in console chrome ("Design Studio"), full-window/share-link degradation path. The proxy + cookie flow is the phase's exit criterion — validated on the Arthaus console domain before the surface is called done.
- **DS5 — Managed MCP live lane.** `penpot-mcp` container wired to the agent runtime (spec 18 merge, first-party trust), session binding, `execute_code` guardrails, the co-creative loop in console chat + Slack.
- **DS6 — Video render stage** (external, deferred until a consumer demands MP4).

## 11. Decisions (resolved 2026-07-15, Garrett) & open questions

- **D1 — Instance topology: POOLED.** One platform-managed instance, team = tenant, service-account-owned, lockdown flags; app-layer isolation accepted for v1. Per-tenant Penpot is the eject-tier answer.
- **D2 — Embed strategy: IFRAME FROM THE START.** No full-window staging phase — DS4 goes straight to the embedded iframe via per-tenant proxy alias + frame-ancestors injection; full-window/share-link is degradation only. Consequence accepted: the canvas surface ships only after the patch + same-site cookie flow is proven across tenant domains — DS4's exit criterion.
- **D3 — Self-host** (not Penpot SaaS) — their cloud ToS don't contemplate resale/white-label and automation is restricted.
- **OQ4 → D4 — Kaleidos: STAY SELF-SUPPORTED.** No commercial relationship; rely on MPL rights, version pinning, and the canary suite. This raises the weight on §8 discipline — the canary suite is now the *only* early-warning system for upstream changes, so it gates every upgrade without exception.
- **OQ1 — `@penpot/library` coverage.** RC with "limited features" — DS2's first task is a coverage test against our template needs (component instances? token refs? image fills?); gaps push complexity into templates or delay Lane 1 features.
- **OQ2 — `.penpot` snapshot cadence** for eject-portability: every approval point vs nightly per team.
- **OQ3 — Live-lane surface in Slack** — the co-creative session is console-natural (canvas + chat side by side); what's the Slack degradation (share-link previews + commands)?

---
*Deep-dive sources (2026-07-15): help.penpot.app (technical-guide: docker, configuration, integration; user-guide: design-tokens, view-mode; /mcp), github.com/penpot/penpot (nginx-security-headers.conf, releases, auth/oidc.clj, rpc/commands/auth.clj), design.penpot.app/api/openapi (v2.17, 145 commands), @penpot/library (npm, 1.2.0-RC1), community.penpot.app threads 10040 (core team on headless), 10601 (focus bug), 8835 (embed SDK request), 3534 (cross-team libraries), penpot.app/security-whitepaper, /pricing, /blog/penpot-ai-whitepaper, MPL-2.0 FAQ.*
