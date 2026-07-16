# Design Surfaces (spec 23) + Social Agent (spec 24) — build log & items to revisit

> Working doc, started 2026-07-15 during the end-to-end implementation run.
> Everything here either blocked a step, got parked deliberately, or is a
> finding that should feed back into the specs. Discuss + disposition each.

## Shipped in this run (context)

- **DS0** — `infra/penpot/`: pinned compose stack (2.16) with DS0/prod flag sets documented, prepl + access-tokens + MCP enabled; service-account bootstrap + tenant-team provisioning proven live (`tenant-arthaus` exists).
- **DS1+DS2** — `packages/design-surfaces`: RPC adapter (safe set), file-first compose lane (`@penpot/library`), import/export-binfile (SSE protocols handled), server-side PNG export (`/api/export` protocol reverse-engineered: transit body, session auth, asset-pointer download), `createSurface`/`exportSurface`, CLI (bootstrap / provision-tenant / demo), **canary conformance suite (spec 23 §8) — 8/8 green live**.
- **DS3** — `packages/brand-md`: `compileDesignTokens` (DESIGN.md → W3C DTCG), 16/16 tests, Arthaus fixture.
- **Proof** — `scripts/demo-arthaus.ts`: real Arthaus DESIGN.md → tokens → composed IG post → editable Penpot file in tenant-arthaus → on-brand PNG (Lora headline, bronze eyebrow, ink band). `arthaus-demo-post.png`.
- **SM0 scaffold** — `packages/skills/social-media` (artifact formats + planning read tools).

## Findings that must feed back into spec 23

1. **`/api/export` protocol is session-authed, not token-authed.** The exporter's
   render path requires a real `auth-token` session cookie (minted via
   `login-with-password` for the service account) + `profile-id`; access tokens
   are rejected. Spec 23 §3's session-minting seam turned out to be REQUIRED for
   the export pipeline, not just the embedded canvas. Encoded in
   `PenpotConfig.serviceAccount`; service-account password therefore needs Vault
   storage on the platform (same governance as other credentials).
2. **`@penpot/library` text does not render from flat params.** `addText` with
   `characters` imports but never renders — Penpot draws text from a content
   TREE (root → paragraph-set → paragraph → nodes), which the library does not
   synthesize (RC2). We synthesize it in `composeSurfaceFile`, plus two more
   quirks: text fills need explicit `fillOpacity` or they render default-black;
   fontIds follow the `gfont-<slug>` scheme. All three are canary-relevant
   library-upgrade risks — add a rendered-pixel assertion to the canary suite
   (today it asserts PNG bytes, not glyph presence). **OQ1 partially resolved:**
   boards/rects/text/tokens/library-colors/images all work; components/variants
   untested.
3. **Penpot rejects DTCG root metadata in `addTokensLib`** ($description,
   $extensions, $metadata, $themes fail its validator — sets only). We strip at
   the compose boundary; provenance survives in the artifact JSON but NOT inside
   Penpot. If Penpot later accepts $themes, wire the two-registers themes in.
4. **Exporter needs `PENPOT_PUBLIC_URI` pointing at the internal frontend** in
   containerized deployments (its Chromium navigates to `PUBLIC_URI/render.html`);
   asset URIs in export results then carry the internal host — the adapter
   rewrites them to the client's baseUrl. Both facts matter for production infra.
5. **`import-binfile`/`export-binfile` are SSE-streaming commands** (progress
   events, terminal payload; import returns transit `~u` uuids; export returns
   an asset URI to download; `includeLibraries` and `embedAssets` are mutually
   exclusive). All handled in the adapter; documenting because none of it is
   documented upstream.

## Parked / deferred (needs discussion)

1. **Production Penpot hosting — ✅ RESOLVED 2026-07-16 (Garrett: GCE).**
   LIVE at **https://design.avant-garde.ai** — GCE `penpot-design`
   (avant-garde-platform, us-central1-a, e2-standard-2, static IP
   34.133.193.251, 80GB pd-balanced, nightly snapshots ×14d), DNS A record in
   the axon-platform `avant-garde` Cloud DNS zone, Caddy auto-TLS, prod flag
   set LOCKED (registration disabled post-bootstrap), deployed via
   `infra/penpot/deploy.sh`. **Production canary 6/6 green**; the Arthaus demo
   ran against prod with a byte-identical export (deterministic compose).
   `tenant-arthaus` provisioned. Residual items:
   - Secrets: service-account token+password currently on the VM `.env` + the
     dev Mac (`~/.mos-penpot-prod-*`) + Vercel env — move to Vault as the
     canonical home; rotate when done.
   - **No SMTP provider** — team invitations don't actually email (mailcatcher
     only, tunnel to :1080 to read). Needed before inviting real merchant
     users. Also `svc@marketing-os.internal` is a non-routable address by
     design.
   - CI/CD: deploys are `deploy.sh` from a workstation; a GitHub Action doing
     the same on infra/penpot changes is the natural next step.
   - e2-standard-2 (2 vCPU/8GB) — resize to e2-standard-4 if exporter load
     shows; watch memory.
   - **npm publish still blocked** — `npm whoami` is 401 on this machine;
     hosted-agents consumes the design-surfaces core VENDORED into
     `lib/design-surfaces/` until Garrett runs `npm login` and we publish
     @avant-garde/design-surfaces + brand-md, then swap the vendor for the
     dependency.
2. **DS4 embedded canvas (iframe) not started this run.** D2 says iframe-first;
   the per-tenant proxy alias + frame-ancestors injection needs the production
   domain topology (item 1) and the console repo. The full-window fallback and
   view-only share links need nothing and could ship immediately.
3. **DS5 managed MCP lane not started.** The `penpot-mcp` container is up in
   the compose stack (2.16 ships it) but agent-runtime wiring (spec 18 merge,
   session binding, execute_code guardrails) is future work — it needs a live
   canvas session to mean anything (DS4 first).
4. **Platform DB persistence of surfaces**: `mos_design_surfaces` +
   `mos_social_posts` migrations are drafted in marketing-os-app but NOT applied
   to prod Supabase (no reason yet — nothing hosted consumes them). Apply when
   the hosted runtime grows the surface API.
5. **Webhook-driven `edited` detection** (approval-nonce staleness): Penpot
   webhooks are team-scoped and exist, but wiring them to the platform needs a
   public callback URL — production infra again. Until then, `getFileStructure`
   polling at approval time is the honest fallback.
6. **Eject-snapshot cadence (spec 23 OQ2)** — unresolved; `exportBinfile` works,
   nothing schedules it.
7. **`.penpot` source-of-truth tension.** Spec 22 doctrine says files-are-truth
   in the store repo; the Penpot file is live-editable, so the repo copy is a
   SNAPSHOT, not truth. Current line: Penpot file = working truth for design;
   repo gets export artifacts + approval-point .penpot snapshots. Worth blessing
   in the spec text.
8. **Fonts.** The demo uses Google-font ids (gfont-lora etc.) that Penpot's
   frontend resolves; brand CUSTOM fonts (Canela in the real Arthaus guide)
   need per-team font upload — API exists (team-scoped fonts) but is untested
   and unwired to the brand-template pipeline.
9. **DTCG dimension form.** brand-md emits Tokens-Studio-style string dimensions
   ("26px"), not the newer DTCG draft object form ({value, unit}) — matches
   what Penpot accepts today; revisit if Penpot moves.
10. **DESIGN.md fields that don't map to tokens** (from the DS3 build): the two
    registers exist only as sibling color tokens (a structured `themes:` block
    in DESIGN.md is the path); component *semantics* (button-primary as a style)
    don't exist in DTCG — the brand template library carries them; all prose
    (photography, motion, do's/don'ts) stays prose; `version: alpha` is not
    orderable — versions should go numeric for bump-driven re-derivation.
11. **SM1+ not started**: imagery fan-out into compose (BS2b/NeuroGraph wiring),
    the calendar console view, publish Actions (needs spec 20 A0/A1 — still the
    critical-path dependency), cron, channel connectors, Meta app review
    submission (D1 said kick off at SM0 — an EXTERNAL action for Garrett, not
    code).
12. **Penpot instance state is local-only.** The Docker volumes on this machine
    are the only copy of tenant-arthaus + the demo files; treat as disposable
    dev state. `/tmp/penpot-token.txt` + service-account password are dev-grade
    secrets pending Vault.

## Upstream watch

- Penpot AI whitepaper's promised **file-based server API** — replaces the
  @penpot/library RC dependency for Lane 1 when it lands.
- `@penpot/library` releases past 1.2.0-RC2 — may fix text-content synthesis
  (finding 2) and root-metadata tokens (finding 3); re-probe on every bump via
  the canary suite.
- Penpot MCP headless support (core team says "not yet") — would open Lane 2
  beyond human-present sessions.
