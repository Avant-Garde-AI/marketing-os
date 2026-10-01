# 35 — Design Studio and the Figma Bridge: retiring Penpot

> **Status:** PROPOSAL — direction set 2026-10-01 (Garrett: retire Penpot; agentic Studio first;
> deep Figma sync for teams that live there). D1 leaning-decided; D2–D7 open (§10). Build not started.
> **Supersedes:** 23-DESIGN-SURFACES-PENPOT §1, §3, §4, §6 and phases DS4–DS6 (the Penpot substrate,
> the embedded Penpot canvas, the Penpot MCP live lane). The `DesignSurface` *idea* in 23 §0/§2 — a
> domain-agnostic surface with lifecycle, provenance and an export contract — survives intact.
> **Amends:** 30-DESIGN-LIBRARY (the published target becomes the renderer and Figma, not Penpot;
> §4 read-back gets two concrete sources). 33-THE-STORYBOARD-HARNESS (the "renderer swap" it
> anticipated is this spec).
> **Reuses:** 22-BRAND-SOUL (DESIGN.md → DTCG), 20-CAPABILITY-SUITE (one gate), 27-AGENT-SESSIONS
> (a Studio session is a session; its output is a change set), 18-EXTERNAL-MCP + the Higgsfield
> OAuth-MCP adapter (the governed path for an OAuth MCP), `offer-render.server.ts` (Chromium in a
> Vercel Sandbox), `@avant-garde/design-loop` (render → see → refine).

---

## 0. Why, in one paragraph

Penpot was chosen to be the place a human sees, touches and blesses what the agent made. That
place was never built: DS4 (embedded canvas) and DS5 (live MCP lane) never started, and the
hosted console has no Penpot UI. What *was* built is Penpot as a **render engine**, which is
the job it fits worst. It has no image cropping, a paint-order rule the compose code must
respect, text-fill and typography schema quirks (PRs #53, #54), a release-candidate builder
library, an undocumented exporter that needs a minted session, and a GCE box we support alone
(23 D4). The read-back gap in spec 30 exists because a `.penpot` file is opaque. Meanwhile the
way people actually work with the agent is conversational. They ask for a change, look, and ask
again, and only occasionally reach in to fix one thing by hand. So we keep the surface
primitive, swap the substrate for one we own end to end, and meet designers in the tool they
already pay for.

## 1. Thesis: one source, three projections

```
                    ┌──────────────────────────────┐
                    │  Surface Document (SDoc)      │  store repo: truth
                    │  JSON · tokens · components   │  (DB holds the working draft)
                    └──────┬─────────┬─────────┬───┘
            render (pure)  │         │ edit    │ project / read back
                           ▼         ▼         ▼
                 HTML/CSS preview   STUDIO     FIGMA
                 + PNG/PDF export   chat +     frames, auto-layout,
                 (Chromium)         canvas +   variables, components
                                    inspector
         every change, whoever makes it (agent · person · Figma), is a PATCH on the SDoc
```

Three rules carry the design:

1. **The SDoc is the only master.** This is 30 D1 again with Penpot removed from the
   sentence. HTML is a projection, and so is Figma. A projection can *propose* changes but
   never owns the surface.
2. **Everyone edits through the same pipe.** An agent tool call, a click in the inspector,
   and a designer's change in Figma all become `SurfacePatch` ops against a base revision.
   Undo, history, attribution, review and conflict handling are written once.
3. **The agent never emits HTML.** It emits SDoc nodes and patches from a fixed vocabulary,
   the same rule as 25 (blocks compose primitives) and 34 §1 (declarative GenUI). That is what
   makes the output reviewable as a diff, constrainable to the brand, and translatable into Figma.

## 2. The Surface Document ⟨BUILD⟩

`@avant-garde/surface-doc`: types, validator, patch engine, migrations. It contains no renderer
and no I/O.

```ts
interface SurfaceDoc {
  version: 1;
  id: string;                         // = DesignSurface.id
  rev: number;                        // bumped by every applied patch
  tokens: { ref: string; sha: string };   // design/library/tokens.json at a commit
  library?: { ref: string; sha: string }; // design/library/ at a commit (30 §7.4 pinning)
  boards: Board[];                    // a carousel = N boards; an email = N section boards
}

interface Board { id: string; name: string; width: number; height: number; fill?: Paint; children: Node[] }

type Node =
  | Frame        // layout: "absolute" | "row" | "column"; gap, padding, align, justify, wrap
  | Text         // characters + style: { font: TokenRef, size: TokenRef|number, weight, tracking, leading, case, align, color: Paint }
  | Image        // src: AssetRef; fit: "cover"|"contain"|"fill"; focal: {x,y}; radius
  | Shape        // rect | ellipse | line; fill/stroke: Paint; radius
  | Instance;    // component: "caption-band@3"; overrides keyed by the component's slot names

interface NodeBase {
  id: string;          // stable, never reused: the anchor for patches, Figma mapping and read-back
  role?: string;       // archetype role (29/30): "headline", "eyebrow", "room-image"…
  name?: string;
  // placement inside an absolute parent; ignored inside row/column parents
  x?: number; y?: number; width: number | "hug" | "fill"; height: number | "hug" | "fill";
  hidden?: boolean; opacity?: number;
}

type Paint = { token: string } | { hex: string; offBrand: true };   // see §5 brand constraint
```

**The intersection rule.** A property enters the SDoc vocabulary only if it maps cleanly to
CSS *and* to Figma's node model. Examples:

- Row and column frames map to flexbox and to Figma auto-layout.
- Absolute frames map to `position:absolute` and to Figma's absolute positioning. This keeps the
  existing archetype slots expressible as they are.
- `hug`/`fill` sizing maps to fit-content/flex and to Figma's hug/fill sizing.
- Token refs map to CSS custom properties and to Figma variables.
- Image `fit` + `focal` maps to `object-fit`/`object-position` and to Figma's image scale mode
  plus crop transform.

Anything outside the intersection (blend modes, vector paths, filters, grid) stays out until
both sides can carry it. This rule is what lets the Figma round trip be honest instead of
approximate.

**Migration from `ComposeSpec`.** The current `ComposeSpec` (absolute boards, rect/text/image,
Penpot fills) is a strict subset. A `composeSpecToDoc()` adapter lets every consumer move over
without a rewrite (§8). Archetype slots become absolute frames with `role` set, and a component
slot becomes an `Instance`.

**Patches.** Ops address nodes by id rather than by array path, because array-index patches go
stale under concurrent edits:

```ts
type SurfacePatch = {
  base: number;                       // doc rev the author saw
  actor: { kind: "agent" | "user" | "figma"; id: string };
  ops: Array<
    | { op: "set"; node: string; path: string; value: unknown }   // path within the node, e.g. "style.size"
    | { op: "insert"; parent: string; index: number; node: Node }
    | { op: "remove"; node: string }
    | { op: "move"; node: string; parent: string; index: number }
    | { op: "swap-image"; node: string; src: AssetRef; focal?: {x:number;y:number} }
    | { op: "instance"; node: string; component: string }          // swap component / bump version
  >;
  note?: string;                      // human-readable "why", shown in history
};
```

Applying a patch validates against the schema and the brand constraint (§5). It then rebases
when `base` is behind: a patch that touches no node changed since `base` applies cleanly, and
one that touches a changed node is a **conflict**. Conflicts are surfaced for a decision and
never merged silently, following 30 §8's "silent overwrite" failure mode.

## 3. The renderer and export ⟨BUILD⟩

`@avant-garde/surface-render` is a pure function from `SurfaceDoc` + tokens + assets to an HTML
string. There is one output per board, with CSS custom properties generated from DTCG. It
reuses `email-assembly`'s token-to-CSS step and is deterministic, with no browser required.
The same function backs three places:

- **Live preview in the Studio.** The board is rendered client-side into a sandboxed iframe.
  The canvas shows exactly what will be exported, because it is the same HTML in the same kind
  of engine.
- **Export.** HTML → PNG/JPEG/WEBP/PDF at declared scales, via headless Chromium. Production
  already does this in `offer-render.server.ts`, which runs Playwright in a **Vercel Sandbox**
  because Chromium does not fit in a serverless function. We reuse that worker pattern rather
  than adding a second one (D3).
- **Critique.** `design-loop`'s capture + VLM critic run on the same render. The agent's "look
  at it and refine" step and the human's preview are the same pixels.

Exports land as sha'd artifacts in the store repo path the domain pack chooses, as 23 §6
already specified. Video stays out of scope, as in 23 §6. The SDoc is static, and MP4 is a
later stage over exported frames.

## 4. The Studio ⟨BUILD⟩

The product surface: **agentic chat on the left, the live surface on the right, a light inspector
when you select something.**

```
┌──────────────────────┬──────────────────────────────────────────────┐
│ Chat (session, 27)   │  [Feed 1:1] [Story 9:16] [Carousel 1/5 ▸]    │
│                      │  ┌────────────────────────────┐ ┌──────────┐ │
│ › tighten the        │  │                            │ │Inspector │ │
│   headline and use   │  │   live render (iframe)     │ │ headline │ │
│   the gold variant   │  │   click → select node      │ │ text  ✎  │ │
│                      │  │                            │ │ size ±   │ │
│ ⚙ surface_patch (3)  │  └────────────────────────────┘ │ color ◉◉◉│ │
│   headline.size 64→56│  History · rev 14 · ↶ ↷         └──────────┘ │
│ ✓ re-rendered        │  [Send for review] [Export] [Open in Figma]  │
└──────────────────────┴──────────────────────────────────────────────┘
```

**The agentic loop is primary.** The creative agent gains `surface_read` (the SDoc plus a
render URL), `surface_patch`, `surface_render` (returns the image to the model for
self-critique), and `surface_variants`. Variants fork N child drafts, shown as a strip, and the
person picks one.

**Selection makes chat precise.** Clicking a node puts `selected: headline (node h1)` into the
turn context. "Make this bigger" then has an unambiguous referent, and that covers most of the
cases where people currently feel they need a manual editor.

**Streaming is a prerequisite.** The hosted runtime's `/api/chat` currently returns the final
answer as `text/plain` (`app/api/chat/route.ts:121-218`). The Studio needs tool calls as they
happen, so the canvas can re-render mid-turn. The OSS template already does this with
`createUIMessageStreamResponse`. ST2 brings the hosted route up to that contract, which also
benefits the plain console.

**The light inspector is deliberately not a design tool.** It changes the selected node only:

| Can | Cannot |
|---|---|
| Edit text inline (claims guard runs on commit, as for agent copy) | Draw arbitrary shapes, paths, pen tool |
| Step size on the **type scale**, weight, tracking, case | Free-form font picking outside brand tokens (except via an explicit off-brand override, §5) |
| Pick color from **brand swatches** | Effects, blend modes, masks |
| Nudge position (absolute) / reorder (row/column), step padding & gap on the spacing scale | Restructure the layout tree beyond move/insert of library components |
| Swap image from the asset library / imagery service; drag the **focal point** | Pixel-level image editing |
| Hide/show, swap component variant, revert a node to the agent's version | — |

Each inspector action is a `SurfacePatch` with `actor.kind = "user"`, so it shows up in history
and the agent sees it next turn. "Revert to agent's version" is cheap because history is
per-node.

For anything the inspector cannot do, the answer is **Open in Figma** (§6), not a bigger
inspector.

**Where it lives (D7).** Today it is single-column chat in the embedded admin
(`app.console.tsx`) and a chat + Penpot-iframe "Design Studio" in the OSS template
(`templates/agents/app/studio/page.tsx`). The template page keeps its layout, with the Penpot
iframe replaced by the SDoc canvas. For hosted stores, the Studio needs more width than the
Shopify admin frame gives.

**Review and governance do not change shape.** Canvas edits are drafts by construction (23 §2).
"Send for review" produces a spec-27 change set pointing at the SDoc commit plus its exports.
Publishing anything is still the domain's Action (20). The `edited` state that used to need
Penpot webhooks becomes a comparison: `doc.rev` versus the rev the last export was rendered from.

## 5. Brand constraint

The SDoc makes the brand enforceable in a way Penpot never did. A `Paint` is a token reference
unless it carries an explicit `offBrand: true` hex. The same rule applies to font families and
to sizes off the type scale. Inspector controls offer only tokens by default, behind an "off
brand" toggle. The validator counts off-brand values per surface and shows them in review, so
"why is this teal?" has an answer. Agents may not set `offBrand` unless the human asked in the
turn. This is enforced in the tool rather than in the prompt.

## 6. The Figma bridge ⟨BUILD⟩

### 6.1 Platform reality (checked 2026-10-01; re-verify at FG0)

| Fact | Consequence |
|---|---|
| Figma's **remote MCP** (`mcp.figma.com/mcp`) can **write** to the canvas since Feb 2026, including `use_figma` and `generate_figma_design` (web page → layers). It is **OAuth only, restricted to an allowlist of catalog clients** (Claude Code, Cursor, VS Code, Codex…). Dynamic client registration from other clients gets a 403, and new client approvals are paused. It is beta and expected to become usage-priced. | The hosted runtime **cannot** use it today. Apply to the catalog now (cheap), but nothing on the critical path depends on approval. |
| The **REST API** can read files and nodes (including a plugin's shared data via `plugin_data`), render node images, handle comments, and run **webhooks v2** (`FILE_VERSION_UPDATE`, `FILE_UPDATE` after ~30 min idle, `LIBRARY_PUBLISH`, `FILE_COMMENT`). It **cannot create or modify nodes.** Writing **variables** over REST is **Enterprise-only** (`file_variables:write`). | REST is the **read-back** channel: server-side, with no Figma tab open. It cannot be the write channel. |
| The **Plugin API** has full read/write: frames, auto-layout, text styles, components, variables, image fills, and `setSharedPluginData` tags readable over REST. Plugins can call our API (`networkAccess.allowedDomains`). | A **Marketing OS Figma plugin** is the reliable, approval-free **write** channel. |
| Standard **Figma OAuth apps** issue REST tokens with granular scopes. | "Connect Figma" is an ordinary connector, using the same pattern as Klaviyo/Google (`provider_connections` + Vault + broker refresh). Confirm at FG0 whether Figma requires app review before users outside our team can authorize. |

### 6.2 Connect

**Integrations → Connect Figma** runs a standard OAuth code + PKCE flow, modeled on
`klaviyo-connect.server.ts`. A new `figma` value in the `provider_name` enum stores the token in
Vault, and the broker issues and refreshes it like Google. Requested read scopes are file
content, metadata, comments, library content, plus webhooks write. Variables read is added where
the plan allows. The connection records which Figma team(s) and project the store syncs to.

The **plugin pairs to the same tenant**. Plugins cannot receive an OAuth redirect, so the plugin
calls `figma.openExternal` to open `/figma/pair?code=…` in the browser. The person is already
signed in to the console and confirms, and the plugin polls for a scoped, revocable plugin token
stored in `connector_tokens`. One click, with no API keys pasted.

### 6.3 Push: Studio → Figma (plugin writes)

1. **Open in Figma** in the Studio chooses a target file from the connected account, or creates
   a "Marketing OS — {store}" file the first time. It enqueues a push job: the SDoc rev plus
   rendered assets.
2. When the plugin is opened in Figma, it shows the store's pending pushes. Applying one
   **materializes native Figma content**:
   - Boards become frames.
   - Row and column frames use auto-layout.
   - Token refs bind to **variables**. The plugin maintains a "{store} Brand" variable
     collection from `tokens.json`. Pushing through the plugin works below Enterprise.
   - Library instances become instances of a synced component in the store's Figma library
     file.
   - Images become image fills with the focal crop applied.
3. Every node gets shared plugin data `mos:{surfaceId, nodeId, rev}`. Re-pushing is an
   **idempotent upsert** by `nodeId`. It updates the nodes we own and leaves alone anything the
   designer added (§6.5).

The push target is the designer's world, so the push never renames, moves or deletes nodes it
does not own.

### 6.4 Pull: Figma → Studio (REST reads, server-side)

A webhook (`FILE_VERSION_UPDATE` when a designer saves a version; `FILE_UPDATE` as the idle
fallback) or the plugin's **Send changes to Marketing OS** button starts a read-back:

1. `GET /v1/files/:key/nodes?ids=…&plugin_data=shared` fetches the tagged nodes.
2. **Map back** each tagged node's supported properties (text, style, fills→tokens,
   size/position, auto-layout params, image crop, visibility, component swap) to SDoc paths, and
   diff against the SDoc at the tagged `rev`.
3. **Classify** each change using 30 §4's rules:
   - **Attributable** changes become a `SurfacePatch` with `actor.kind = "figma"`.
   - **Off-vocabulary** changes (an effect, a blend mode) are reported as "kept in Figma, not
     carried".
   - **Unattributable** changes (a node with no `mos` tag) are reported and never guessed at.
4. **Propose** the result as a change in the Studio, e.g. "Figma: 4 changes from Dana, 1 not
   carried", accepted or rejected per change. The SDoc changes only on acceptance. Conflicts with
   newer SDoc revs use the §2 rebase rule.

Colors that match a token value are mapped back to the token. A color that matches none comes
back as `offBrand`, and the person sees that.

### 6.5 The shipped pixels

**Pixels that ship are always rendered from the SDoc by our renderer.** Figma is where a person
*changes* the design. It is never where the shipped file comes from. Two consequences, both
intended:

- What Figma shows and what ships can differ only by the reported "not carried" list. That
  difference is visible, never silent.
- The pipeline never depends on a Figma tab or a Figma seat to publish a post.

The **escape hatch (D5)**: a surface can be marked *Figma-owned*. The designer then owns it
outright. Export comes from REST image render (`GET /v1/images`), and the agent may read it but
not patch it. This is for the designer-heavy team that wants a hero piece hand-made, at the
cost of agent editability for that surface.

### 6.6 The design library in Figma

- **Tokens** are one-way, repo → Figma variables, through the plugin. Enterprise teams can use
  REST `POST /variables` instead, with no plugin needed.
- **Components** are published from `design/library/components/*.json` into the store's Figma
  library file. Library publishing inside Figma stays a human click, since Figma exposes no API
  for it. Going the other way, a designer's edit to a library component (`LIBRARY_PUBLISH`
  webhook) becomes a **proposed** change to the component JSON in the store repo. That is 30 D1
  applied to Figma: the repo is master, and Figma proposes.

### 6.7 The MCP lanes

- **FG-M1, bring your own agent (works today).** Designers already running Claude Code or Cursor
  with Figma's MCP can add the store's MCP endpoint (spec 12, already serving
  `compose_design_surface` / `export_design_surface` / `list_design_surfaces`), extended with
  `surface_read` / `surface_propose_patch`. Their agent is the approved Figma client and bridges
  both servers. Their writes into our system still arrive as proposed patches.
- **FG-M2, hosted Figma MCP (if approved).** If Figma admits us to the catalog, the connection
  uses the Higgsfield OAuth-MCP pattern already shipped (DCR + PKCE + RFC 8707 `resource` +
  row-locked refresh), entering through a **governed adapter** rather than the generic merge
  (`external-mcp.server.ts:151-153`). The win is push **without opening the plugin**: the Studio
  agent writes straight to the file with `use_figma`. The plugin stays as the fallback and for
  plans or teams the MCP doesn't cover.

## 7. Data model

`004_design_surfaces_and_social.sql` is **not yet applied to production**, so it is amended in
place rather than migrated:

- Drop `penpot_team_id`, `penpot_project_id`, `penpot_file_id`, `penpot_page_id` and
  `idx_mos_design_surfaces_file`.
- Add `doc_path` (store-repo path of the committed SDoc), `doc_rev`, `doc_sha`,
  `draft_doc jsonb` (the working draft between commits), `exported_rev` (so `edited` =
  `doc_rev > exported_rev`) and `owner` (`'mos' | 'figma'`, D5).
- New `mos_surface_patches` (append-only: surface, base, applied rev, actor, ops, note,
  status `applied|proposed|rejected|conflict`) is the history, undo, and Figma proposal inbox.
- New `mos_figma_links` (surface ↔ file key, node map, last pushed rev, last pulled version) and
  `figma_push_jobs`.
- `mos_social_posts.design_surface_id` is unchanged.

Commit cadence: the draft lives in `draft_doc` while a session iterates, and is committed to the
store repo at **send for review**, **export** and **session end**. That gives a reviewable diff
per meaningful step, not per keystroke. (This resolves 23 OQ2 for the new substrate.)

## 8. Retiring Penpot

| Consumer (as found 2026-10-01) | Today | Move |
|---|---|---|
| Hosted social publish (`lib/social/register-actions.ts:19-32`, `projection.ts:90`; `socialAssetUrl` throws without a bound surface) | Penpot export | Export from the SDoc renderer. Same `designSurface` binding, new backend. |
| Social compose (`archetype-surface.ts`, `compose_post_from_archetype`, `compose_post_keyframes`) | `ComposeSpec` → Penpot | Emit SDoc via `composeSpecToDoc()`, then emit SDoc natively. The image-fit and paint-order workarounds are deleted, not ported. |
| Email surface sections (template `lib/email/assemble.ts:121-176`) | Penpot boards → PNG slots | SDoc boards → PNG slots, using the same tokens as the HTML body. |
| Storyboard realize (`lib/storyboard/realization.ts:164`, `exportSurfaceBoards`) | Penpot | SDoc. 33's renderer-agnostic seam means `packages/storyboard` does not change. |
| Design library publish/check (template `design-library.ts`) | → Penpot shared library | → renderer (components resolved at render) and → Figma library (§6.6). |
| Template Studio page (`app/studio/page.tsx`, `studio-session` route) | Penpot iframe + session minting | SDoc canvas; delete the session-minting route. |
| Offers | Playwright in Vercel Sandbox | No change. Offers are already HTML, and their render worker is the export pattern §3 reuses. |

The MCP tool names (`compose_design_surface`, `export_design_surface`, `list_design_surfaces`)
**keep their names and contracts**. Only the backend changes, so agents, prompts and external
MCP users don't notice.

Decommission order:

1. Freeze DS4/DS5 now.
2. Run the parity harness in ST0.
3. Migrate consumers in ST1.
4. Run `export-binfile` once for any Penpot file worth archiving (the Arthaus demo files, into
   cold storage, not git; 30 §8 "a build output in git").
5. Remove `@penpot/library`, `lib/design-surfaces/{rpc,adapter,compose}.ts`, the `PENPOT_*` env
   and the canary suite.
6. Shut down the GCE `design.avant-garde.ai` instance.

## 9. Phases

- **ST0 — SDoc + renderer + parity.** `surface-doc` (types, validator, patch engine, rebase),
  `surface-render`, `composeSpecToDoc()`. The **parity harness** renders every Arthaus archetype
  through both Penpot and the new renderer and pixel-diffs them with `design-loop`'s
  visual-diff. **Exit:** parity on all current archetypes, *plus* fixed image crops.
- **ST1 — Migrate consumers (§8 table).** Export via the Sandbox Chromium worker. Amend
  migration 004. **Exit:** Arthaus social publish runs end to end with Penpot switched off.
- **ST2 — Studio, agentic.** UIMessage streaming on the hosted `/api/chat`; the split layout;
  the `surface_*` tools; selection-aware chat; variants strip; history and undo; send-for-review
  → change set. **Exit:** a post goes from brief to approved without leaving the Studio.
- **ST3 — Light inspector (§4 table) + brand constraint (§5).** Built only after ST2 has been in
  use. Build the controls people reach for, in the order they reach for them.
- **FG0 — Figma connect + verification spike.** OAuth app; re-verify §6.1 (scopes, app review,
  `plugin_data` over REST, plugin variable APIs by plan); submit the MCP catalog request.
- **FG1 — Plugin push (§6.3)** with pairing, variables collection, idempotent upsert.
  **Exit:** a carousel opens in Figma as native auto-layout frames bound to brand variables.
- **FG2 — Read-back (§6.4)** via webhooks + REST + the plugin's "send changes" button; Figma
  proposals in the Studio. **Exit:** a designer's headline edit in Figma comes back as an
  accept/reject proposal, and a blur they added is reported as not carried.
- **FG3 — Library sync (§6.6)** and the Figma-owned escape hatch (D5).
- **FG-M1** comes with ST2's tool work. **FG-M2** waits on Figma.

ST and FG are independent after ST0, so they can run in parallel.

## 10. Decisions

- **D1 — Retire Penpot.** *Leaning-decided 2026-10-01 (Garrett).* The render engine and the
  canvas both go. The surface primitive stays.
- **D2 — SDoc is the source; the agent never emits HTML.** *Proposed.* The alternative (the
  agent writes HTML/CSS that is visually edited, as in Builder.io's `visual-edit` skill) gives
  more freedom and loses three things: brand enforcement (§5), a faithful Figma projection (the
  intersection rule), and review as a readable diff.
- **D3 — Export engine.** *Leaning: Chromium in a Vercel Sandbox*, reusing the offers worker,
  because preview and export are then the same engine. The alternative is satori + resvg
  (serverless, already used for charts). It is cheaper and faster but supports only a CSS
  subset, so the preview could differ from what ships. Revisit if Sandbox latency or cost hurts
  at volume.
- **D4 — Figma write channel.** *Leaning: plugin first, hosted MCP if and when approved.* The
  plugin needs no one's permission. The MCP lane is a better user experience and arrives later
  or never.
- **D5 — Figma-owned surfaces.** *Open.* The escape hatch is cheap to build and honest about its
  cost. The risk is that teams use it by default and lose the agent loop.
- **D6 — Plugin distribution.** *Open. Leaning: Figma Community publish.* It is free to
  install, and inert without pairing. A private org plugin only reaches *our* Figma org, so it
  is a dev channel and not a distribution channel.
- **D7 — Where the hosted Studio lives.** *Open.* Options: a full-screen App Bridge surface
  inside the Shopify admin, or a runtime-hosted page opened from the admin (the runtime already
  has `/chat` and the conversations API). Leaning toward whichever keeps the HMAC chat handoff
  (`/api/chat/grant`) unchanged.

## 11. Risks

- **Vocabulary pressure.** Designers will want things outside the intersection. The answer is a
  reported "not carried" list plus D5, not widening the vocabulary one-sidedly.
- **Figma API drift.** The MCP is beta and the plugin and REST APIs are versioned. FG0's
  verification becomes a small canary like the Penpot one, scoped to the handful of calls we
  use.
- **Two-place editing confusion.** A person edits in the Studio while a designer edits in Figma.
  The rebase rule and per-change acceptance handle correctness. The UI must show "Figma has 3
  unreviewed changes" before anyone exports.
- **Sandbox render latency** in the agent's self-critique loop. Critique can render client-side
  or in-process HTML → screenshot only when needed. Measure in ST0.

---
*Sources (Figma, checked 2026-10-01): help.figma.com Figma MCP server guide; forum.figma.com threads
on remote-MCP OAuth client registration and the catalog allowlist; developers.figma.com REST API
(variables endpoints, webhooks v2); Builder.io `skills/visual-edit` README (the pattern weighed in D2).*
