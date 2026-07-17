/**
 * `assembleEmail` — the pure assembly function (WS2-R4, 04 §4):
 *
 *   skeleton.html + sections[] + tokens → email.html
 *
 * Slots are filled in order, the preview-text span and head assets are
 * injected, lineage is stamped, and the mechanical invariant gate
 * (invariants.ts, 04 §6) runs on the result. The caller (WS3's
 * `klaviyo.create_campaign_draft` Action, or the ungated preview) uploads
 * the HTML as a CODE-editor template (03 §3) — this function never touches
 * Klaviyo, Penpot, the filesystem, a clock, or randomness.
 *
 * ## Determinism
 *
 * Same input → byte-identical output; approval-nonce hashing depends on it.
 * Consequences baked in:
 *   - lineage carries only caller-supplied version strings (no timestamps
 *     unless the caller puts one in a version string);
 *   - all string substitution uses replacer FUNCTIONS — a replacement string
 *     containing `$` (a price, say) would otherwise trip JavaScript's
 *     `$&`/`$1` replacement patterns and corrupt output non-obviously;
 *   - slots fill in skeleton order; multiple sections targeting one slot
 *     concatenate in `sections[]` order.
 *
 * ## Error posture
 *
 * MALFORMED input (bad section shape, missing meta) throws — that is a
 * programming error in the tooling layer. INVARIANT violations (missing alt,
 * foreign image host, oversized HTML…) come back as `report.errors` with
 * `ok: false` — the html is still returned so the preview can SHOW the human
 * what is wrong, but callers MUST treat `ok: false` as a hard gate before
 * any Klaviyo write.
 *
 * ## Store-repo pipeline note
 *
 * Skeletons may be authored from shared partials (`<!--PARTIAL:name-->`,
 * see compose.ts): the canonical pipeline is
 * `composePartials → extractSkeleton → assembleEmail`. Klaviyo Django tags
 * (`{{ first_name }}`, `{% … %}`) pass through this function verbatim —
 * slot substitution is the only edit inside `<body>`, and the
 * `merge-tag-altered` invariant re-verifies preservation mechanically.
 */

import {
  assembleEmailInputSchema,
  type AssembledEmail,
  type AssembleEmailInput,
  type AssemblyIssue,
  type CampaignMeta,
} from "./types";
import { COLOR_SCHEME_META, emitEmailStyles, resolveEmailTheme } from "./css";
import { renderBlock, renderSurface } from "./renderers";
import { DEFAULT_ALLOWED_IMAGE_HOSTS, checkAssembledEmail } from "./invariants";

const SLOT_MARKER_RE = /\{\{slot:([A-Za-z0-9_-]+)\}\}/g;

/**
 * The preheader: preview text hidden from the rendered body but read by
 * inbox list views. Every hiding technique in the stack is load-bearing:
 * `display:none` alone is ignored by some Outlook builds (hence
 * `mso-hide:all` and max-height/max-width:0), and the trailing run of
 * `&#847;&zwnj;&nbsp;` word-joiner padding stops clients from pulling
 * adjacent body text into the preview line. Fixed-length padding —
 * deterministic bytes.
 */
function preheaderHtml(previewText: string): string {
  const pad = "&#847;&zwnj;&nbsp;".repeat(30);
  const escaped = previewText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    `<div class="eab-preheader" style="display:none;font-size:1px;line-height:1px;` +
    `max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">` +
    `${escaped}${pad}</div>`
  );
}

/** Lineage comment (04 §6.6) — versions are caller-supplied, never clocked. */
function lineageComment(meta: CampaignMeta): string {
  const v = (s: string | undefined): string => s ?? "unversioned";
  return (
    `<!-- @avant-garde/email-assembly lineage ` +
    `tokens=${v(meta.tokensVersion)} design=${v(meta.designMdVersion)} skeleton=${v(meta.skeletonVersion)} -->`
  );
}

/**
 * Assemble the final email HTML from a skeleton, sections, and brand tokens.
 * See module JSDoc for determinism and error posture. Throws `ZodError` on
 * malformed input; never throws for invariant violations.
 */
export function assembleEmail(input: AssembleEmailInput): AssembledEmail {
  const parsed = assembleEmailInputSchema.parse(input);
  const { skeleton, sections, meta } = parsed;
  const strict = parsed.options?.strict ?? true;
  const allowedImageHosts = parsed.options?.allowedImageHosts ?? DEFAULT_ALLOWED_IMAGE_HOSTS;

  const theme = resolveEmailTheme(parsed.tokens);
  const inputErrors: AssemblyIssue[] = [];
  const inputWarnings: AssemblyIssue[] = [];

  // -- Render sections, grouped by slot, preserving sections[] order --------
  const markerNames = new Set<string>();
  for (const m of skeleton.html.matchAll(SLOT_MARKER_RE)) {
    if (m[1] !== undefined) markerNames.add(m[1]);
  }

  const bySlot = new Map<string, string[]>();
  for (const section of sections) {
    if (!markerNames.has(section.slot)) {
      inputErrors.push({
        code: "slot-unknown",
        message: `section targets slot "${section.slot}" but the skeleton has no {{slot:${section.slot}}} marker (available: ${[...markerNames].join(", ") || "none"})`,
      });
      continue;
    }
    const rendered =
      section.type === "surface"
        ? renderSurface(section, theme)
        : (Array.isArray(section.block) ? section.block : [section.block])
            .map((block) => renderBlock(block, theme))
            .join("\n");
    const list = bySlot.get(section.slot);
    if (list) list.push(rendered);
    else bySlot.set(section.slot, [rendered]);
  }

  // -- Fill slots (replacer function: content may contain `$`) --------------
  let html = skeleton.html.replace(SLOT_MARKER_RE, (_marker, name: string) => {
    const chunks = bySlot.get(name);
    if (!chunks) {
      inputWarnings.push({
        code: "slot-unfilled",
        message: `skeleton slot "${name}" received no section — marker stripped (the frame renders without that band)`,
      });
      return "";
    }
    return chunks.join("\n");
  });

  // -- Inject preheader right after <body …> ---------------------------------
  const preheader = preheaderHtml(meta.previewText);
  const bodyOpen = /<body[^>]*>/i.exec(html);
  if (bodyOpen) {
    const at = bodyOpen.index + bodyOpen[0].length;
    html = html.slice(0, at) + "\n" + preheader + html.slice(at);
  } else {
    html = preheader + "\n" + html;
  }

  // -- Inject head assets: color-scheme metas, support styles, lineage ------
  const hasColorSchemeMeta = /name\s*=\s*["']color-scheme["']/i.test(html);
  const headBits = [
    ...(hasColorSchemeMeta ? [] : [COLOR_SCHEME_META]),
    emitEmailStyles(theme),
    lineageComment(meta),
  ].join("\n");
  const headClose = /<\/head>/i.exec(html);
  if (headClose) {
    html = html.slice(0, headClose.index) + headBits + "\n" + html.slice(headClose.index);
  } else {
    // Headless fragment (test skeletons): stamp assets before everything so
    // lineage + styles still ship.
    html = headBits + "\n" + html;
  }

  // -- Mechanical gate (04 §6) -----------------------------------------------
  const result = checkAssembledEmail(html, {
    skeletonHtml: skeleton.html,
    sections,
    meta,
    strict,
    allowedImageHosts,
  });

  const errors = [...inputErrors, ...result.errors];
  const warnings = [...inputWarnings, ...result.warnings];
  return {
    html,
    report: { ok: errors.length === 0, errors, warnings, stats: result.stats },
  };
}
