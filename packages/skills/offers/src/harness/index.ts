/**
 * The offer design harness (spec 34 §3) — every pure piece a host needs to
 * run it: the brief and prompt builders, the model-facing ("wire") concept
 * schema and its mapping onto the pack's concept union, concept validation
 * and catalog grounding, critic prompts and fail-closed verdict parsing, the
 * mechanical conformance + dark-pattern critics, repair eligibility, render
 * planning and preview URLs, request parsing, the arm-keyed compile adapter,
 * and lifestyle-image ranking. `offer-render-worker.mjs` (beside this file)
 * is the Playwright script a host runs in its sandbox to render previews and
 * audit the incumbent popup.
 *
 * What stays with the host: the model client, the sandbox, the database, the
 * Shopify Admin reads, and job orchestration. Nothing here takes a
 * credential or makes a request.
 *
 * Exported from the pack index as the `harness` namespace — several adapter
 * names (ARCHETYPES, compileOfferManifestV2, gateOfferManifestV2, …) wrap the
 * pack's own exports with the harness's call shapes and would otherwise clash.
 */
export * from "./adapter";
export * from "./core";
export * from "./lifestyle";
