# @avant-garde/skill-social-media

The Social Media Agent skill pack (spec 24), at phase **SM0 — model + planning reads**.

Social planning the way this platform runs everything else: **the agent plans from the Brand Soul, a human approves, the platform executes, and every artifact is versioned in the store's repo.** This package ships the model (the `social/` artifact formats) and the ungated planning intelligence. It publishes nothing.

## What SM0 covers

1. **Artifact formats** (spec 24 §1 — spec 22 D1 pattern: files are truth, DB is the index). Parse + serialize for the three repo artifacts under `social/` (alongside `agents/brand/`), all YAML-front-matter markdown like brand.md:
   - `social/strategy.md` — channel roster (`{channel, register, cadencePerWeek}`), content pillars (`{name, messagingRef, weight}`) mapped to brand.md's messaging framework, optional seasonal arcs; prose rationale in the body.
   - `social/calendar/{YYYY-MM}.md` — front matter `month` + `status`; body is a markdown table, one row per planned post: `| slot | channel | pillar | intent | postId | status |`. `parseCalendar`/`serializeCalendar` round-trip.
   - `social/posts/{id}/post.md` — the post spec: channel, schedule, copy (+ the copy formula it instantiated), asset refs, target link, per-claim provenance (`owner | agent | data`), lifecycle status (`proposed → approved → asset_ready → scheduled → published → measured`, + `declined/cancelled/failed`); agent rationale in the body.

2. **Planning read tools** (spec 24 §2 — reads compose freely, nothing gated):
   - `social_plan_propose` — deterministic calendar scaffold from `strategy.md`: slots laid out by per-channel cadence across the month's weeks, pillars rotated by weight, every slot carrying its *why* (plus top movers / seasonal context woven in when supplied). Pure — no clocks, month comes from the input; the LLM layers creative content on the scaffold. Returns the draft as structure **and** as ready-to-propose `calendar/{month}.md` markdown; it does not write.
   - `social_calendar_read` — a month's plan with gap analysis: unassigned slots, pillar balance vs. strategy weights, missing pillars.
   - `social_post_read` — a parsed post spec.

3. **`instructions.md`** — the agent instructions merged in when the pack is enabled: plan from brand.md §10/§11 + tone table + copy formulas, every slot carries its why, never engagement bait, reads compose freely / writes are Actions.

## What's deferred

| Phase | What | Where it lands |
|---|---|---|
| **SM1** | Asset pipeline: post.md → imagery fan-out → compose lane → DesignSurface → export → `asset_ready` | spec 23 **DS2** (compose lane) + DS1 (export) |
| **SM2** | Publishing: `social.approve_plan` / `social.schedule_post` / `social.publish_post` / `social.cancel_post` Actions, Pinterest + Instagram connectors, `/api/cron/social` | spec 20 **A0/A1** Action framework |
| **SM3–SM5** | Weekly/monthly rituals, performance readback, more channels, batch minting | spec 24 §7 |

Also owned by the hosted runtime, not this package: the `mos_social_posts` DB index (rebuildable from files) and the console calendar view.

## Skill-package shape (spec 20 §5)

| spec 20 §5 export | here |
|---|---|
| `metadata` | `{ id: "social-media", category: "campaign", … }` |
| `requires` | `{ providers: [], scopes: [] }` — SM0 reads only the store repo (SM2 adds pinterest/meta connections) |
| `tools` | `createSocialTools(repo)` — a **factory**, because the tools need the tenant's repo binding (see below) |
| `actions` | `[]` — intentionally empty until SM2; writes narrow through the spec 20 gate |
| `instructions` | exported string, canonical copy in [instructions.md](./instructions.md) (a test keeps them in sync) |
| `reports` / `surfaces` | none in SM0 (the "Social Recap" report is SM4, riding spec 19) |

### Why plain tool definitions, not Mastra tools

This package deliberately does **not** depend on `@mastra/core`. Tools are exported as plain `{ id, description, inputSchema, outputSchema, execute }` objects (`SkillToolDefinition`), and the hosted runtime — which owns the Mastra version — wraps them at merge time:

```ts
import { createTool } from "@mastra/core/tools";
import { createSocialTools } from "@avant-garde/skill-social-media";

const defs = createSocialTools(tenantRepo);
const tools = Object.fromEntries(
  Object.values(defs).map((d) => [
    d.id,
    createTool({
      id: d.id,
      description: d.description,
      inputSchema: d.inputSchema,
      outputSchema: d.outputSchema,
      execute: async ({ context }) => d.execute(context),
    }),
  ]),
);
```

This keeps the pack version-independent of the runtime's Mastra (no duplicate-core resolution headaches) and trivially testable.

### The repo binding

Tools are constructed against a minimal accessor, so the same definitions serve production and tests:

```ts
interface SocialRepo {
  readFile(path: string): Promise<string | null>; // null = not found
  writeFile(path: string, content: string): Promise<void>; // unused in SM0 (SM1+)
  list(prefix: string): Promise<string[]>;
}
```

The hosted runtime binds it to the tenant's store repo; tests bind it to an in-memory map (see `test/tools.test.ts`).

## Develop

```bash
pnpm --filter @avant-garde/skill-social-media test       # vitest
pnpm --filter @avant-garde/skill-social-media typecheck
pnpm --filter @avant-garde/skill-social-media build      # tsup, ESM + d.ts
```
