/**
 * Partial composition — the store-repo template authoring seam.
 *
 * The proven as-built Arthaus email system authors its 8 Klaviyo lifecycle
 * templates from shared partials (`partials/head.html`, `header.html`,
 * `footer.html`, …) via `<!--PARTIAL:name-->` comment markers, composed
 * deterministically by its `scripts/compose.js`. This is the same composer
 * as a pure library function: the marker regex is IDENTICAL to compose.js
 * (`/<!--PARTIAL:(\w[\w-]*)-->/g`), and a missing partial leaves the same
 * `<!-- PARTIAL "name" NOT FOUND -->` comment — so templates round-trip
 * between the two toolchains byte-for-byte.
 *
 * Canonical store-repo pipeline:
 *
 *   templates/partials + template
 *     → composePartials()          (this function)
 *     → full HTML                  (a complete email, or a skeleton source)
 *     → extractSkeleton()          (when deriving a slotted skeleton)
 *     → assembleEmail()
 *
 * Klaviyo Django tags (`{{ first_name }}`, `{% for item in items %}`) are
 * preserved VERBATIM — substitution is a literal splice (replacer function,
 * so `$` sequences in partial content are safe) and nothing else in the
 * template or the partials is touched.
 *
 * ## Single pass, by design
 *
 * Resolution is ONE pass: a `<!--PARTIAL:x-->` marker INSIDE a partial's
 * content is spliced in literally and NOT recursively resolved — matching
 * compose.js, and keeping composition trivially terminating and
 * order-independent. If nesting is ever needed, call composePartials again
 * on the output (explicitly, where the caller can see the fixpoint).
 *
 * One deliberate divergence from compose.js: an EMPTY-STRING partial counts
 * as found here (compose.js's falsy check reports it missing). An empty
 * partial is a legitimate way to blank a band per-store.
 */

import type { ComposedTemplate } from "./types";

/** Identical to the Arthaus compose.js marker regex — do not "improve" it. */
export const PARTIAL_MARKER_RE = /<!--PARTIAL:(\w[\w-]*)-->/g;

/**
 * Replace every `<!--PARTIAL:name-->` marker in `templateHtml` with
 * `partials[name]`. Missing partials leave a
 * `<!-- PARTIAL "name" NOT FOUND -->` comment and are reported in
 * `report.missing`. Pure and deterministic; single pass (see module JSDoc).
 */
export function composePartials(
  templateHtml: string,
  partials: Record<string, string>,
): ComposedTemplate {
  const used: string[] = [];
  const missing: string[] = [];

  const html = templateHtml.replace(
    new RegExp(PARTIAL_MARKER_RE.source, PARTIAL_MARKER_RE.flags),
    (_marker, name: string) => {
      if (!Object.prototype.hasOwnProperty.call(partials, name)) {
        if (!missing.includes(name)) missing.push(name);
        return `<!-- PARTIAL "${name}" NOT FOUND -->`;
      }
      if (!used.includes(name)) used.push(name);
      // Replacer function return values are literal — `$&`-style patterns in
      // partial content cannot corrupt the output.
      return partials[name] as string;
    },
  );

  return { html, report: { used, missing } };
}
