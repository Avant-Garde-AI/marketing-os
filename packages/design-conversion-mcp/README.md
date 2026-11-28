# @avant-garde/design-conversion-mcp

A conversion-oriented design MCP for storefronts. Point it at a page and it tells
you, one design decision at a time, how the page compares with the DTC brands in
its category, and which move to make next.

```
audit_page(url) → the page's design decisions → compared with its category's conventions → ranked strokes
```

It runs on the open **DTC design-craft dataset** (`@avant-garde/design-craft`, spec 35):
296 design treatments on 27 axes, earned from 79 DTC storefronts across 8
categories. A treatment enters the vocabulary only after ≥3 distinct brands use it.

## Quick start

Claude Code:

```bash
claude mcp add design-conversion -e DESIGN_CONVERSION_API_KEY=<gemini-key> -- npx -y @avant-garde/design-conversion-mcp
```

Any MCP client (Claude Desktop, Cursor, …):

```json
{
  "mcpServers": {
    "design-conversion": {
      "command": "npx",
      "args": ["-y", "@avant-garde/design-conversion-mcp"],
      "env": { "DESIGN_CONVERSION_API_KEY": "<key>" }
    }
  }
}
```

URL audits launch a local Chromium. Install it once with `npx playwright install chromium`.
Without a key, everything except the audit tools still works. Describe a page
yourself and call `design_suggest_strokes`.

| Env | Default | |
|---|---|---|
| `DESIGN_CONVERSION_API_KEY` | `GEMINI_API_KEY` | Key for the vision endpoint |
| `DESIGN_CONVERSION_BASE_URL` | Gemini's OpenAI-compatible URL | Any OpenAI-compatible VLM (a local vLLM works) |
| `DESIGN_CONVERSION_MODEL` | `gemini-3.1-pro-preview` | The model the dataset was labeled with. Others work, but agreement varies |

Flags: `--http <port>` serves stateless HTTP on localhost. `--allow-private-urls` lets you
audit a local dev theme. `--no-capture` turns capture off. `--vocab/--benchmarks/--taxonomy/--labels`
point the server at your own dataset.

## Tools

All tools are read-only. Nothing here changes a store.

| Tool | What it does | Model call |
|---|---|---|
| `design_audit_page` | Captures a URL (first screen + full page), labels it, ranks strokes | 1 VLM call |
| `design_audit_screenshot` | The same from a screenshot you send (base64 or a data URL) | 1 VLM call |
| `design_suggest_strokes` | Ranks strokes for a page you've described: `{axis: treatment}` | none |
| `design_benchmark` | A category's decisions and conventions per axis, with example brands | none |
| `design_vocabulary` | Axes, their conversion role, families and admitted values | none |
| `design_report` | Vocabulary health: MVP criteria, stage coverage, outcome coverage | none |

Resources: `design://method`, `design://lens`, `design://taxonomy`, `design://vocabulary`,
`design://benchmarks/{category}`. Prompt: `conversion_design_review`.

## How it thinks

**The taxonomy** is `axis → family → value`:

- an **axis** is a question a designer answers (`announcement-bar-treatment`: what does the strip above the header do?);
- a **family** is a decision (static message vs message carousel vs scrolling marquee);
- a **value** is one named treatment (`static-text-strip`).

Conventions are measured on **families**, so near-identical wordings don't split a
convention, and a stroke changes a decision, not a phrase.

**The conversion lens** gives every axis a purchase-path **stage** (attention →
orientation → evaluation → confidence → commitment → basket) and a **lever**
(clarity, motivation, trust, friction, value, identity), plus the conversion
question it answers. Each page type weights the stages differently: a product page
cares most about commitment, a home page about attention and orientation.

**A stroke** is one move on one axis:

```
score = (convention share − the page's share) × stage weight × confidence(brands answering)
```

Each stroke carries its evidence: the benchmark (category + viewport), how many
brands it rests on, and example brands you can go and look at.

## What it will not claim

- **Convention is not conversion.** The corpus was chosen for reputation and distinctiveness, and nobody
  outside a store can see its conversion rate. A stroke is a hypothesis to test. Ship one axis per change
  so each move can be measured and reverted.
- **Brand axes aren't flattened.** Type, ground, photography, motion and brand story are never suggested
  as strokes. A rare choice there is reported as *distinctive*, because it is often the brand's edge.
- **Season is reported, not followed.** The wave-1 benchmarks were captured during Black Friday 2026, so
  promotional conventions (hero message, offers, overlays) show up under `seasonal`, not as strokes,
  until the January wave lands.
- **Desktop is compared with desktop**, and mobile with mobile.
- **Small categories fall back.** A category with fewer than 5 brands uses the cross-category benchmark,
  and the plan says so.
- **Labels can vary between runs.** The vision model is not perfectly deterministic. Re-audit before acting
  on a borderline stroke.

The stage/lever assignments and page-type weights are stated hypotheses (`design://lens`).
Measured outcomes enter through each value's `reward` (offered/chosen through an approval gate).
When a value has them, the stroke says `basis: corpus-prevalence+outcomes`.

## Embedding the server

The core is transport-free, so it can run inside your own host:

```ts
import { createDesignConversionServer, createHttpHandler, loadDataset } from "@avant-garde/design-conversion-mcp";

const server = createDesignConversionServer({
  ...(await loadDataset()),
  vision,                                    // any VisionModel; omit to disable audits
  authorize: async ({ tool, costly }, ctx) => { /* scopes, quotas */ },
});
export const POST = createHttpHandler(server, { authenticate: async (req) => /* CallContext | null */ null });
```

`createHttpHandler` speaks stateless Streamable HTTP (one JSON response per POST), which suits
serverless hosts. `serveStdio(server)` is the local transport.

## Hosted

Marketing OS will host this server for registered stores (account-scoped tokens, no local key or
browser). The planned hosted tier ranks strokes with category models trained on outcomes from stores
that opt in (approved and rejected design changes, then measured results), so ranking moves from
"what the category does" toward "what converted". That tier doesn't exist yet. Today, hosted and
open run the same convention-based ranking. The open server and dataset stay the base layer.

MIT. Dataset: labels only. No third-party screenshots are stored or redistributed.
