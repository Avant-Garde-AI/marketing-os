# 35 — Design Studio and the Figma Bridge: retiring Penpot

> **Status:** PROPOSAL — direction set 2026-10-01 (Garrett: retire Penpot; the hosted console is the
> agentic design surface, connected Figma is where teams edit by hand, with sync both ways).
> D1 + D8 leaning-decided; D2–D7 open (§10). Build not started.
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
                 + PNG/PDF export   agentic    direct manipulation:
                 (Chromium)         chat +     frames, auto-layout,
                                    live view  variables, components
         every change, whoever makes it (agent · person · Figma), is a PATCH on the SDoc
```

Three rules carry the design:

1. **The SDoc is the only master.** This is 30 D1 again with Penpot removed from the
   sentence. HTML is a projection, and so is Figma. A Figma edit reaches the surface only as a
   patch on the SDoc: applied automatically to a draft and proposed once a design is in review
   (§6.5, D8). It is never a second copy that wins.
2. **Everyone edits through the same pipe.** An agent tool call, an undo in the console,
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

## 4. The Studio: the console is where you *talk* to the design ⟨BUILD⟩

**Division of labour (Garrett, 2026-10-01).** The hosted console is the agentic surface: chat
beside the live design, and every change made by asking. **Direct manipulation lives in
Figma.** A team that wants to push pixels around opens the design in its connected Figma
account (§6). The console does not try to be a second, worse Figma. This replaces the "light
inspector" of the first draft. The console keeps only the controls that make *talking*
precise.

```
┌──────────────────────┬──────────────────────────────────────────────┐
│ Chat (session, 27)   │  [Feed 1:1] [Story 9:16] [Carousel 1/5 ▸]    │
│                      │  ┌────────────────────────────────────────┐  │
│ › tighten the        │  │                                        │  │
│   headline and use   │  │   live render (iframe)                 │  │
│   the gold variant   │  │   click → point at a node (●headline)  │  │
│                      │  │                                        │  │
│ ⚙ surface_patch (3)  │  └────────────────────────────────────────┘  │
│   headline.size 64→56│  History · rev 14 · ↶ ↷   Figma: ✓ synced    │
│ ✓ re-rendered        │  [Send for review] [Export] [Open in Figma ↗]│
└──────────────────────┴──────────────────────────────────────────────┘
```

**The agentic loop is primary.** The creative agent gains `surface_read` (the SDoc plus a
render URL), `surface_patch`, `surface_render` (returns the image to the model for
self-critique), and `surface_variants`. Variants fork N child drafts, shown as a strip, and the
person picks one.

**Pointing, not editing.** Clicking a node in the render puts `selected: headline (node h1)` into
the turn context. Shift-click selects several. "Make this bigger" or "swap this photo for the
oak frame" then has an unambiguous referent. This is the one direct interaction the canvas
owns, and it covers most of the moments that would otherwise send someone looking for a
manual editor.

**What the console keeps, beyond chat:**
- History with undo and redo.
- Per-node "revert to before that change".
- Variant pick.
- Format and board switching.
- Send for review, export, and **Open in Figma**.

There is no text editing on the canvas, no colour pickers and no drag handles. A one-word copy
fix is a one-line chat message. If that turns out to be too slow in practice, inline text edit
is the single control to add first; it would be a `SurfacePatch` with `actor.kind = "user"`,
because the pipe already supports it.

**Streaming is a prerequisite.** The hosted runtime's `/api/chat` currently returns the final
answer as `text/plain` (`app/api/chat/route.ts:121-218`). The Studio needs tool calls as they
happen, so the canvas can re-render mid-turn. The OSS template already does this with
`createUIMessageStreamResponse`. ST2 brings the hosted route up to that contract, which also
benefits the plain console.

**Figma status is always visible.** Each surface shows its Figma state: not linked, synced, N
changes pulled from Figma, or conflict. Someone chatting in the console can always see that a
teammate has been working on the same design in Figma (§6.5).

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
to sizes off the type scale. Agents may not set `offBrand` unless the person asked for it in the
turn. This is enforced in the tool rather than in the prompt.

Figma is where off-brand values will actually come from: a designer picks a colour by eye.
Read-back (§6.5) maps a colour back to its token when the value matches one. A colour that
matches none comes back as `offBrand`. The validator counts off-brand values per surface and
shows them in review, so "why is this teal?" has an answer and a one-click "snap to nearest
brand token".

## 6. The Figma bridge ⟨BUILD⟩

**The goal (Garrett, 2026-10-01):** a team connects its Figma account from the console in one
web flow. From then on, every design the agent makes can be opened in that team's Figma.
Changes made there come back into the console without anyone thinking about sync, and existing
Figma designs can be brought in for the agent to work from.

**The asymmetry this design has to live with:** Figma's public APIs make the **inbound**
direction (Figma → us) fully server-side. The **outbound** direction (us → Figma) has no pure
REST path, because REST cannot create layers. §6.4 gives the three outbound channels, ranked.

### 6.1 Platform reality (checked 2026-10-01; re-verify at FG0)

| Fact | Consequence |
|---|---|
| **OAuth 2 apps** issue REST tokens with granular scopes via a standard web redirect flow. | "Connect Figma" is an ordinary console connector, using the same shape as Klaviyo and Google. Confirm at FG0 whether Figma reviews an OAuth app before users outside our team can authorize it, and budget for that. |
| The **REST API** reads files and nodes (geometry, layout, styles, text, components, and a plugin's shared data via `plugin_data`), renders any node to PNG/SVG/PDF (`GET /v1/images`), and handles comments. **Webhooks v2** fire `FILE_VERSION_UPDATE`, `FILE_UPDATE` (after ~30 min idle), `LIBRARY_PUBLISH` and `FILE_COMMENT`. | **Inbound is all API:** import (§6.3) and sync back (§6.5) need no plugin and no open Figma tab. |
| REST **cannot create or modify nodes**, and there is no file-import endpoint. **Variables write** over REST is **Enterprise-only**. There appears to be no "list my teams" endpoint, so a team is identified from a pasted team, project or file URL. | **Outbound needs something running inside Figma** (§6.4). |
| Figma's **capture script** (the `generate_figma_design` / html-to-design path) serializes a rendered web page into Figma's clipboard format. Pasting yields editable layers with inferred auto-layout. The format is **undocumented** and may change. | A no-install "Copy to Figma" is possible because our designs *are* rendered HTML (§6.4 E1). It is fragile, so it is a convenience, never the sync backbone. |
| The **Plugin API** has full read/write: frames, auto-layout, text styles, components, variables on all plans, image fills, `setSharedPluginData` tags readable over REST, and `setRelaunchData` buttons on nodes. | A **Marketing OS plugin** is the reliable outbound channel (§6.4 E2). Installed once, it turns updates into one click on the frame itself. |
| The **remote MCP** (`mcp.figma.com/mcp`) can write (`use_figma`, `generate_figma_design`) but is OAuth-only for **allowlisted catalog clients**. Other clients get a 403 at dynamic client registration, approvals are paused, and the server is beta and expected to become usage-priced. | Zero-touch server push exists only if Figma admits us (§6.4 E3). Apply now; depend on nothing. |

### 6.2 Connect: one web flow from the console

1. In **Integrations → Figma → Connect**, the person is sent to Figma's consent screen and back.
   This is authorization code + PKCE, modeled on `klaviyo-connect.server.ts`, with HMAC state as
   in `oauth.server.ts`.
2. The token is stored as a new `figma` value in `provider_name` → `provider_connections` +
   Vault. The broker issues and refreshes it like Google (`broker.server.ts`).
3. **Choose where designs go.** The person pastes the Figma team or project link once (see §6.1
   on team discovery). We list its projects and files and record a default project. On first
   export we create a **"Marketing OS — {store}"** file there, plus a **"{store} Brand"** library
   file (§6.7).
4. Webhooks are registered on the team for sync back (§6.5).

Requested scopes, to be finalized at FG0: file content and metadata read, comments read and
write, library content read, webhooks write, and variables read where the plan allows.
Connection status, the connected Figma user and team, and a Disconnect button that revokes the
connection and deletes the webhooks all appear on the same Integrations page as the other
connectors.

### 6.3 Import: bring a Figma design in (pure API)

The person pastes a frame link in chat ("make this month's posts from this template"), or picks
one in the Studio. Then:

1. `GET /v1/files/:key/nodes?ids=…` fetches the subtree, and `GET /v1/files/:key/images`
   fetches the image fills.
2. Under the intersection rule (§2), it maps to an SDoc:
   - Frames and auto-layout become row/column frames, and absolute frames stay absolute.
   - Text and its style are carried over.
   - Fills are mapped to tokens where the values match, and to `offBrand` otherwise.
   - Image fills keep their crop.
   - Component instances map to library instances where the component is in the store's
     library.
3. Every SDoc node records the **Figma node id it came from**. An imported design is therefore
   *already linked*: sync back (§6.5) maps 1:1 with no tagging step.
4. Anything outside the intersection (effects, vectors, blend modes) is listed as "not
   carried". The agent says so in chat rather than approximating silently.

An import can become a **surface** (work on this design) or a **template** (an archetype the
social and email packs fill). The template path is how a team's existing Figma brand work
becomes the agent's raw material on day one.

### 6.4 Export: put a console design into Figma (three channels)

**E1 — Copy to Figma (no install).** The Studio's renderer output is HTML, so "Copy to Figma"
runs Figma's capture script over the rendered board and puts Figma clipboard data on the
person's clipboard. They paste into any file and get editable layers. Layer names carry
`mos:{nodeId}` anchors so sync back can find them, *if* the capture preserves names; FG2's
spike checks this.
- **Cost:** an undocumented format, no variable bindings, and each copy is a fresh paste rather
  than an update.
- **Use:** one-offs, first impressions, and teams that won't install anything.

**E2 — Plugin sync (the backbone).** The team installs the Marketing OS plugin once from
Figma Community. It pairs to the store through the same console session: `figma.openExternal`
→ `/figma/pair?code=…` → confirm → a scoped, revocable token in `connector_tokens`.
- **Opening a design:** "Open in Figma" in the console opens the store's Marketing OS file. If
  the design is not there yet or is out of date, the plugin's panel says "2 designs ready", and
  one click materializes them as **native content**:
  - frames with auto-layout;
  - text bound to text styles;
  - fills bound to the **{store} Brand** variables;
  - library components as instances;
  - images with the focal crop applied.
- **Tagging:** every node gets shared plugin data `mos:{surfaceId, nodeId, rev}`.
- **Updating:** each synced frame carries a relaunch button, **"Update from Marketing OS"**, so
  pulling the agent's latest revision is one click on the frame. Updates are an idempotent
  upsert by `nodeId`. They change only nodes we own and never rename, move or delete anything
  the designer added.

**E3 — Hosted MCP push (zero touch, if approved).** With catalog access, the Studio agent writes
straight into the linked file via `use_figma`, and "Open in Figma" lands on an up-to-date frame
with no plugin step. The connection uses the shipped Higgsfield OAuth-MCP pattern (DCR + PKCE +
RFC 8707 `resource` + row-locked refresh) through a **governed adapter**, not the generic merge
(`external-mcp.server.ts:151-153`). If approved, E3 replaces E2's click; it does not replace E2.

**Default:** E2 for any team that syncs more than once, and E1 as the always-available fallback.

### 6.5 Sync back: Figma changes flow into the console (pure API)

A webhook triggers the read-back: `FILE_VERSION_UPDATE` when a designer saves a version, or
`FILE_UPDATE` after ~30 minutes idle. The plugin's **"Send to Marketing OS"** and a console
**"Pull from Figma"** button trigger it immediately.

1. **Read** the linked nodes over REST (`plugin_data=shared` for E2, layer-name anchors for E1,
   recorded node ids for imports).
2. **Map** supported properties back to SDoc paths and diff against the SDoc at the linked
   `rev`.
3. **Classify** each change using 30 §4's rules:
   - **Attributable** changes become a `SurfacePatch` with `actor.kind = "figma"` and the Figma
     user's name.
   - **Off-vocabulary** changes are reported as "kept in Figma, not carried".
   - **Unattributable** changes (new untagged layers) are reported, never guessed at.
4. **Apply** according to the surface's state (D8):
   - **Draft:** attributable changes **apply automatically**. They show in history as "Dana in
     Figma: headline text, image crop", and each is individually undoable. Editing a draft in
     Figma should feel like editing it here; there is no inbox to babysit.
   - **In review or approved:** changes arrive as a **proposal**. Accepting one re-opens the
     review, because what was approved is no longer what's on the canvas (23 §2's nonce rule,
     now enforceable).
   - **Conflict** (the same node changed in the console since the linked rev): both versions are
     shown side by side, and the person picks one. Nothing merges silently.

Changes are attributed in the Studio header ("synced from Figma 4 min ago · Dana") and in chat,
so the agent's next turn knows a person changed the headline and does not "fix" it back.

### 6.6 The shipped pixels

**Pixels that ship are always rendered from the SDoc by our renderer.** Figma is where a person
*changes* a design. It is never where the shipped file comes from. Two consequences, both
intended:

- What Figma shows and what ships can differ only by the reported "not carried" list. That
  difference is visible, never silent.
- Publishing never depends on a Figma seat, a Figma tab, or Figma's uptime.

The **escape hatch (D5)**: a surface can be marked *Figma-owned*. The designer then owns it
outright. Export comes from `GET /v1/images`, and the agent may read it but not patch it. This
is for a hero piece a designer wants to hand-make, at the cost of agent editability for that
surface.

### 6.7 The design library in Figma

- **Tokens** are one-way, repo → the **{store} Brand** variable collection, via the plugin on
  any plan or REST `POST /variables` on Enterprise.
- **Components** go from `design/library/components/*.json` into the Brand library file.
  Publishing a library inside Figma stays a human click, since Figma exposes no API for it.
- **Inbound:** a `LIBRARY_PUBLISH` webhook turns a designer's change to a library component
  into a **proposed** change to the component JSON in the store repo. That is 30 D1 applied to
  Figma: the repo is master, Figma proposes, and component changes always go through review
  because they propagate to every future design.

### 6.8 Bring your own agent

Designers already running Claude Code or Cursor with Figma's MCP can add the store's MCP
endpoint (spec 12, already serving `compose_design_surface` / `export_design_surface` /
`list_design_surfaces`), extended with `surface_read` / `surface_propose_patch`. Their agent is
the approved Figma client and bridges both servers. This works today, and their changes into
our system arrive as patches like any other.

## 7. Data model

`004_design_surfaces_and_social.sql` is **not yet applied to production**, so it is amended in
place rather than migrated:

- Drop `penpot_team_id`, `penpot_project_id`, `penpot_file_id`, `penpot_page_id` and
  `idx_mos_design_surfaces_file`.
- Add `doc_path` (store-repo path of the committed SDoc), `doc_rev`, `doc_sha`,
  `draft_doc jsonb` (the working draft between commits), `exported_rev` (so `edited` =
  `doc_rev > exported_rev`) and `owner` (`'mos' | 'figma'`, D5).
- New `mos_surface_patches` (append-only: surface, base, applied rev, actor, ops, note,
  status `applied|proposed|rejected|conflict`) is the history, undo, and the record of Figma
  changes (auto-applied on drafts, proposed after review, §6.5).
- New `mos_figma_links` (surface ↔ file key, node map — from plugin tags, layer anchors or
  import — channel `clipboard|plugin|mcp|import`, last pushed rev, last pulled version) and
  `figma_push_jobs` (what the plugin's "ready" panel lists).
- `figma_webhooks` (team, webhook id, passcode hash) for the inbound lane.
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
| Design library publish/check (template `design-library.ts`) | → Penpot shared library | → renderer (components resolved at render) and → Figma Brand library (§6.7). |
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
  the `surface_*` tools; point-to-select; variants strip; history and undo; brand constraint (§5);
  send-for-review → change set. **Exit:** a post goes from brief to approved by conversation
  alone, without leaving the Studio.
- **FG0 — Connect + verification spike.** Console OAuth flow (§6.2), team/project linking,
  webhook registration. Re-verify §6.1: scopes, OAuth app review, team discovery, `plugin_data`
  over REST, plugin variables by plan, whether capture preserves layer names. Submit the MCP
  catalog request.
- **FG1 — Inbound: import + sync back (pure API, §6.3, §6.5).** This ships before outbound
  because it needs nothing installed. **Exit:** a team's existing Figma post template is
  imported as a social archetype, and the agent fills it. A designer's edit to that frame in
  Figma lands in the console draft as an attributed, undoable change, while a blur they added
  is reported as not carried.
- **FG2 — Outbound (§6.4).** E1 "Copy to Figma" as a spike first, then the E2 plugin: pairing,
  the Brand variable collection, materialize + relaunch "Update from Marketing OS", idempotent
  upsert. **Exit:** a console carousel opens in Figma as native auto-layout frames bound to
  brand variables. A designer edits it, and the change round-trips back (FG1).
- **FG3 — Library sync (§6.7)** and the Figma-owned escape hatch (D5). E3 (hosted MCP) when and
  if Figma approves us. Bring your own agent (§6.8) arrives with ST2's tool work.
- **Deferred — console direct editing.** Inline text edit only, and only if usage shows chat is
  too slow for one-word fixes (§4).

ST and FG are independent after ST0, so they can run in parallel. The order inside FG is
deliberate: inbound first, because it is all API.

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
- **D4 — Figma outbound channel.** *Leaning: E2 plugin as the backbone, E1 clipboard as the
  no-install fallback, E3 hosted MCP if and when approved* (§6.4). REST cannot write layers, so
  some piece of us has to run inside Figma until Figma admits us to the MCP catalog.
- **D5 — Figma-owned surfaces.** *Open.* The escape hatch is cheap to build and honest about its
  cost. The risk is that teams use it by default and lose the agent loop.
- **D6 — Plugin distribution.** *Open. Leaning: Figma Community publish.* It is free to
  install, and inert without pairing. A private org plugin only reaches *our* Figma org, so it
  is a dev channel and not a distribution channel.
- **D7 — Where the hosted Studio lives.** *Open.* Options: a full-screen App Bridge surface
  inside the Shopify admin, or a runtime-hosted page opened from the admin (the runtime already
  has `/chat` and the conversations API). Leaning toward whichever keeps the HMAC chat handoff
  (`/api/chat/grant`) unchanged.
- **D8 — Console = agentic, Figma = direct manipulation.** *Leaning-decided 2026-10-01
  (Garrett).* The console gets no inspector, pickers or drag handles (§4); the hand-editing
  surface is the team's own Figma. As a consequence, Figma edits to a **draft** apply
  automatically as attributed, undoable patches. Edits to a design **in review or approved**
  arrive as proposals that re-open review (§6.5).

## 11. Risks

- **Vocabulary pressure.** Designers will want things outside the intersection. The answer is a
  reported "not carried" list plus D5, not widening the vocabulary one-sidedly.
- **Figma API drift.** The MCP is beta and the plugin and REST APIs are versioned. FG0's
  verification becomes a small canary like the Penpot one, scoped to the handful of calls we
  use.
- **Two-place editing confusion.** Someone chats in the console while a designer edits in Figma.
  Rebase plus side-by-side conflicts handle correctness. The Studio's Figma status (§4) and
  attributed history handle awareness, and export warns when Figma is newer than the last pull.
- **Webhook latency.** `FILE_UPDATE` waits ~30 min of idle time. Saving a version, the plugin's
  "Send to Marketing OS" and the console's "Pull from Figma" are the immediate paths; the UI
  says which applies.
- **Capture format (E1).** It is undocumented and may break without notice. E1 is a convenience
  with a canary, and nothing depends on it.
- **Sandbox render latency** in the agent's self-critique loop. Critique can render client-side
  or in-process HTML → screenshot only when needed. Measure in ST0.

---
*Sources (Figma, checked 2026-10-01): help.figma.com Figma MCP server guide; Figma capture.js clipboard mode (html.to.design, open-source capture extensions); forum.figma.com threads
on remote-MCP OAuth client registration and the catalog allowlist; developers.figma.com REST API
(variables endpoints, webhooks v2); Builder.io `skills/visual-edit` README (the pattern weighed in D2).*
