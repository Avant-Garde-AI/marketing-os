# Figma capture spike (2026-10-01)

Feasibility check for spec 35 §6.9. Question: can our server render a page in headless
Chromium and produce a Figma clipboard payload with layer names we control, without any Figma
account, plugin or MCP?

## Run

```sh
npm i @figit/dom-to-figma@0.2.4 @figit/fig-kiwi@0.2.0 playwright-core esbuild
npx esbuild entry.mjs --bundle --format=iife --platform=browser --outfile=bundle.js
CHROMIUM_PATH=/path/to/chrome node run.mjs
```

- `page.html` is a mock two-section storefront page with `shopify-section-*` ids.
- Fonts are supplied by the Node side (`exposeFunction`), as the production worker would do.

## Result

| | |
|---|---|
| Convert time | ~0.45 s (1440 px wide page) |
| Payload | ~40 KB Kiwi binary; ~54 KB as the `text/html` clipboard envelope |
| Nodes | 13 frames (auto-layout inferred: `HORIZONTAL`/`VERTICAL` stacks), 10 editable text layers |
| Anchors | 4 frames renamed through the trace (`mos:shopify-section-hero`, `mos:hero-cta`, `mos:hero-art`, `mos:shopify-section-grid`), re-encoded with `fig-kiwi`, and present after a decode round trip |

## Not proven here

- Pasting into a real Figma file, and Figma keeping layer names on paste. This needs a person
  with Figma; it is FG4's first task.
- A real storefront page: theme fonts, Shopify CDN images, long pages and payload size.
- Stability of the clipboard format. It is undocumented, and the `@figit` packages are 0.x.

In the first attempt the converter silently dropped every text layer because the default font
loader could not fetch the font. Production must fail loudly when a font cannot be loaded.
