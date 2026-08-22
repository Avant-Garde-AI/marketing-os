# Email Campaign Agent — UAT harness

Runs the **real vendored pipeline** (`compileDesignTokens` → `composePartials`
→ `extractSkeleton` → `assembleEmail`) against a real store-repo email folder,
outside Slack/Klaviyo/Supabase, so we can iterate on the prompt and the template
structure and eyeball the rendered result.

## Scripts

- **`render.mjs`** — deterministic. Renders sample campaigns two ways: the
  scaffold frame (net-new generation) and ingest-from-a-real-template. No model,
  no network. Writes `out/*.html` + `out/index.html`.
  ```bash
  node render.mjs
  ```

- **`generate.mjs`** — live generation. Gemini 2.5 Flash on Vertex (the prod
  agent's lane) authors copy + structure + curation; product data and hero
  imagery are resolved by the harness (never hallucinated). Grounds creative
  exploration in the **live Picasso art knowledge graph** MCP (`explore_concept`
  + `get_artwork_facets`). Writes `out/generated.html` + per-campaign JSON.
  ```bash
  export VERTEX_TOKEN=$(gcloud auth application-default print-access-token)
  node generate.mjs                 # MODEL=gemini-2.5-pro TEMP=0.6 to vary
  ```

- **`prompt.md`** — the generation prompt (the thing we tune). Mirrors the
  creative-direction intent of the store `AGENT.md` override + the email pack
  instructions.

## Viewing

`out/` is git-ignored. Serve it and open in a browser:
```bash
cd out && python3 -m http.server 8747   # → http://localhost:8747/index.html
```

## Config (env)

`STORE_EMAILS`, `STORE_BRAND` (default: Arthaus marketplace), `MOS_ROOT`
(monorepo for the built packages), `PICASSO_MCP_URL` (default: the registered
Arthaus concierge MCP). Keep `DEFAULT_FRAME` in sync with
`lib/email/assemble.ts` if that frame changes.
