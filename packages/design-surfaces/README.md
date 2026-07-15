# @avant-garde/design-surfaces

The Design Surface layer (spec 23): the platform's domain-agnostic wrapper
around managed Penpot. Creative capability packs (spec 24 social is the first)
consume *surfaces* — brand-templated design documents with lifecycle,
provenance, and an export contract — and never talk to Penpot directly.

## The two lanes (spec 23 §4)

- **Lane 1 — COMPOSE (headless, default):** `composeSurfaceFile(spec)` builds a
  `.penpot` document in memory via `@penpot/library`; `createSurface(...)`
  imports it into the tenant's team and returns everything the platform index
  row needs. Deterministic, no browser, no MCP.
- **Lane 2 — LIVE (human present):** the managed MCP connects the agent to an
  open canvas session. Not in this package yet (DS5).

## Quick start

```ts
import { DesignSurfaceAdapter, createSurface, exportSurface } from "@avant-garde/design-surfaces";

const adapter = new DesignSurfaceAdapter({
  baseUrl: process.env.PENPOT_URL!,
  accessToken: process.env.PENPOT_ACCESS_TOKEN!,          // RPC lane
  serviceAccount: {                                        // export lane (session auth)
    email: process.env.PENPOT_SERVICE_EMAIL!,
    password: process.env.PENPOT_SERVICE_PASSWORD!,
  },
});

const team = await adapter.provisionTenantTeam("arthaus");
const project = await adapter.ensureProject(team.id, "Design Surfaces");
const { surface } = await createSurface(adapter, { /* kind, boundTo, spec… */ });
const png = await exportSurface(adapter, { fileId: surface.penpot.fileId, pageId: surface.penpot.pageId });
```

`scripts/demo-arthaus.ts` runs the full chain on the real Arthaus DESIGN.md:
DTCG tokens (via `@avant-garde/brand-md`) → composed IG post → editable Penpot
file → on-brand PNG.

## The canary suite (spec 23 §8 — read before touching the adapter)

Penpot's RPC API is officially *internal*. Every internal behavior this package
depends on is exercised by `test/canary.test.ts`, which runs against a LIVE
instance and gates every Penpot version bump (we are self-supported by
decision D4). **Never add an adapter call without adding it to the canary
suite.** Hard-won protocol facts (SSE result streams, transit uuid results,
kebab-case multipart fields, the /api/export transit+session protocol, text
content-tree synthesis, fillOpacity) are documented where they're handled and
in `docs/plans/design-surfaces/REVISIT.md`.

```bash
PENPOT_CANARY=1 PENPOT_URL=… PENPOT_ACCESS_TOKEN=… \
PENPOT_SERVICE_EMAIL=… PENPOT_SERVICE_PASSWORD=… pnpm test:canary
```
