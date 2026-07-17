/**
 * Assembly invariants — the mechanical gate before any Klaviyo write
 * (04 §6). `assembleEmail` runs `checkAssembledEmail` on its final HTML and
 * a `report.ok === false` result MUST hard-fail the draft Action's preview.
 *
 * Every check here is MECHANICAL — no LLM judgment, no network. Numbered to
 * match 04 §6:
 *
 *   1. Unsubscribe merge tag present and untouched (every tag captured from
 *      the skeleton must survive to the output — breaking `{% unsubscribe %}`
 *      is a compliance incident). Extended: EVERY Klaviyo Django/Liquid tag
 *      (`{% … %}` / `{{ … }}`) present in the skeleton must survive verbatim.
 *   2. Every `<img>` has alt text or explicit decorative marking
 *      (`role="presentation"`/`aria-hidden`); in strict mode every image URL
 *      resolves to an allowed host (Klaviyo CDN patterns by default — sent
 *      mail must never hotlink our own hosts, 03 §5).
 *   3. Single-column ≤600px frame intact; HTML ≤100KB fail (Gmail clips at
 *      ~102KB — clipped mail hides the unsubscribe link, compounding into a
 *      compliance problem), >80KB warn; total image weight >1.5MB warn when
 *      per-image byte sizes were supplied.
 *   4. Links resolve: no empty or fragment-only hrefs, no `mailto:` in CTAs.
 *      The assembler does NOT rewrite links for UTM — Klaviyo's `is_add_utm`
 *      owns decoration (03 §4); we only verify links are decoration-friendly.
 *   5. Text-to-image sanity: ≥1 non-trivial HTML text section (images-off
 *      clients and spam-filter text/image ratios both need real text);
 *      subject ≤~60 chars warn; preview text 40–130 chars warn.
 *   6. Lineage comment stamped (tokensVersion/designMdVersion/skeletonVersion
 *      — the artifact must be traceable to what produced it).
 */

import { parseDocument, DomUtils } from "htmlparser2";
import type {
  AssemblyIssue,
  CampaignMeta,
  EmailSection,
} from "./types";

type ParsedDoc = ReturnType<typeof parseDocument>;
type AnyChild = ParsedDoc["children"][number];
type ElementNode = Extract<AnyChild, { attribs: Record<string, string> }>;

function* walkElements(nodes: AnyChild[]): Generator<ElementNode> {
  for (const node of nodes) {
    if (DomUtils.isTag(node)) {
      yield node as ElementNode;
      yield* walkElements(node.children as AnyChild[]);
    }
  }
}

// ---------------------------------------------------------------------------
// Unsubscribe + merge-tag detection (shared with extract.ts).
// ---------------------------------------------------------------------------

/**
 * The Klaviyo unsubscribe family: the `{% unsubscribe %}` Django-tag family
 * (any tag mentioning unsubscribe — `{% unsubscribe %}`, `{% unsubscribe_url %}`,
 * `{{ unsubscribe_link }}` variants) plus plain hrefs containing
 * "unsubscribe" (hand-coded templates pointing at a hosted preference page).
 */
const UNSUBSCRIBE_TAG_RE = /\{%[^%{}]*unsubscribe[^%{}]*%\}|\{\{[^{}]*unsubscribe[^{}]*\}\}/gi;
const UNSUBSCRIBE_HREF_RE = /href\s*=\s*["'][^"']*unsubscribe[^"']*["']/gi;

/** Every unsubscribe token in `html`, as the exact matched substrings. */
export function findUnsubscribeTags(html: string): string[] {
  const tags: string[] = [];
  for (const re of [UNSUBSCRIBE_TAG_RE, UNSUBSCRIBE_HREF_RE]) {
    const fresh = new RegExp(re.source, re.flags);
    for (const m of html.matchAll(fresh)) tags.push(m[0]);
  }
  return tags;
}

/**
 * Every Klaviyo Django/Liquid merge-tag sequence in `html` — `{% … %}` tags
 * and `{{ … }}` variables — EXCLUDING our own `{{slot:NAME}}` markers (which
 * are assembly plumbing, not template language).
 */
export function findMergeTags(html: string): string[] {
  const tags: string[] = [];
  for (const m of html.matchAll(/\{%[^%{}]*%\}|\{\{[^{}]*\}\}/g)) {
    if (m[0].startsWith("{{slot:")) continue;
    tags.push(m[0]);
  }
  return tags;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Image host allowlist.
// ---------------------------------------------------------------------------

/**
 * Klaviyo CDN patterns (03 §5): uploaded images come back as
 * `d3k81ch9hvuctc.cloudfront.net` URLs; klaviyo.com/klaviyomail.com cover
 * account-hosted assets and Klaviyo's own tracking imagery.
 */
export const DEFAULT_ALLOWED_IMAGE_HOSTS = [
  "*.klaviyo.com",
  "*.klaviyomail.com",
  "d3k81ch9hvuctc.cloudfront.net",
];

/** `*.klaviyo.com` matches any subdomain plus the apex; others match exactly. */
export function hostAllowed(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith("*.")) {
      const base = p.slice(2);
      return h === base || h.endsWith(`.${base}`);
    }
    return h === p;
  });
}

/** True for `{% … %}` / `{{ … }}` src/href values (resolved by Klaviyo at send). */
function isMergeTagValue(value: string): boolean {
  const v = value.trim();
  return v.startsWith("{%") || v.startsWith("{{");
}

// ---------------------------------------------------------------------------
// Column-width check (shared with extract.ts).
// ---------------------------------------------------------------------------

const STYLE_WIDTH_RE = /(?:^|[^-\w])(?:max-)?width\s*:\s*(\d+(?:\.\d+)?)px/i;

/** Declared pixel width of a structural element (attr first, then style). */
export function declaredPxWidth(el: ElementNode): number | undefined {
  const attr = el.attribs["width"];
  if (attr && /^\d+$/.test(attr)) return Number(attr);
  const style = el.attribs["style"];
  if (style) {
    const m = STYLE_WIDTH_RE.exec(style);
    if (m && m[1] !== undefined) return Number(m[1]);
  }
  return undefined;
}

const STRUCTURAL_TAGS = new Set(["table", "td", "div", "center"]);

/**
 * Invariant 3a: no structural element (table/td/div) declares a width over
 * 600px. Images are exempt — retina exports legitimately carry large `width`
 * attributes ONLY when a CSS width constrains them, which the surface
 * renderer guarantees; structural overflow is what breaks the single column.
 * MSO-conditional markup lives inside comments and is not parsed — by
 * design, the ghost tables mirror the real ones.
 */
export function checkColumnWidths(html: string): AssemblyIssue[] {
  const issues: AssemblyIssue[] = [];
  const doc = parseDocument(html);
  for (const el of walkElements(doc.children)) {
    if (!STRUCTURAL_TAGS.has(el.name)) continue;
    const width = declaredPxWidth(el);
    if (width !== undefined && width > 600) {
      issues.push({
        code: "column-too-wide",
        message: `<${el.name}> declares width ${width}px — the single-column frame must stay ≤600px (04 §6.3)`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// The full assembled-email gate.
// ---------------------------------------------------------------------------

export const HTML_FAIL_BYTES = 100_000;
export const HTML_WARN_BYTES = 80_000;
export const IMAGE_WEIGHT_WARN_BYTES = 1_500_000;
/** A text block below this many characters doesn't count as "non-trivial". */
export const NON_TRIVIAL_TEXT_CHARS = 20;

export const LINEAGE_COMMENT_RE = /<!--\s*@avant-garde\/email-assembly lineage\b/;

export interface InvariantContext {
  /** The skeleton HTML the email was assembled from (merge-tag baseline). */
  skeletonHtml: string;
  sections: EmailSection[];
  meta: CampaignMeta;
  strict: boolean;
  allowedImageHosts: string[];
}

export interface InvariantResult {
  errors: AssemblyIssue[];
  warnings: AssemblyIssue[];
  stats: { htmlBytes: number; imageCount: number; textSections: number };
}

export function checkAssembledEmail(html: string, ctx: InvariantContext): InvariantResult {
  const errors: AssemblyIssue[] = [];
  const warnings: AssemblyIssue[] = [];
  const doc = parseDocument(html);
  const elements = [...walkElements(doc.children)];

  // -- 1. Unsubscribe present + untouched --------------------------------
  const skeletonUnsubs = findUnsubscribeTags(ctx.skeletonHtml);
  if (skeletonUnsubs.length === 0 || findUnsubscribeTags(html).length === 0) {
    errors.push({
      code: "unsubscribe-missing",
      message:
        "no Klaviyo unsubscribe merge tag ({% unsubscribe %} family or unsubscribe href) survives in the assembled email — this is a compliance incident (04 §6.1)",
    });
  } else {
    for (const tag of new Set(skeletonUnsubs)) {
      if (!html.includes(tag)) {
        errors.push({
          code: "unsubscribe-missing",
          message: `skeleton unsubscribe token ${JSON.stringify(tag)} was altered or dropped during assembly (04 §6.1)`,
        });
      }
    }
  }

  // -- 1b. Every skeleton merge tag preserved verbatim -------------------
  // Klaviyo resolves {{ first_name }} / {% ... %} at send time; any
  // re-encoding (entity escaping, whitespace normalization) silently breaks
  // personalization. Assembly only splices at slot markers, so every tag the
  // skeleton carried must appear in the output at least as often.
  const skeletonTags = findMergeTags(ctx.skeletonHtml);
  const tagCounts = new Map<string, number>();
  for (const tag of skeletonTags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  for (const [tag, count] of tagCounts) {
    if (countOccurrences(html, tag) < count) {
      errors.push({
        code: "merge-tag-altered",
        message: `Klaviyo template tag ${JSON.stringify(tag)} appears ${count}× in the skeleton but fewer times in the output — merge tags must pass through every transform verbatim`,
      });
    }
  }

  // -- 2. Image alt + host discipline ------------------------------------
  let imageCount = 0;
  for (const el of elements) {
    if (el.name !== "img") continue;
    imageCount++;
    const alt = el.attribs["alt"];
    const decorative =
      el.attribs["role"] === "presentation" || el.attribs["aria-hidden"] === "true";
    if (alt === undefined || (alt.trim() === "" && !decorative)) {
      errors.push({
        code: "img-alt-missing",
        message: `<img src="${(el.attribs["src"] ?? "").slice(0, 80)}"> lacks alt text and is not explicitly decorative — every image must be described or marked decorative (04 §5d)`,
      });
    }
    const src = el.attribs["src"];
    if (ctx.strict && src !== undefined && !isMergeTagValue(src)) {
      let host: string | undefined;
      try {
        host = new URL(src).hostname;
      } catch {
        host = undefined;
      }
      if (host === undefined || !hostAllowed(host, ctx.allowedImageHosts)) {
        errors.push({
          code: "img-host-untrusted",
          message: `image ${src.slice(0, 100)} is not hosted on an allowed host (${ctx.allowedImageHosts.join(", ")}) — sent mail must reference Klaviyo-hosted image_urls (03 §5); use strict:false only for ungated previews`,
        });
      }
    }
  }

  // -- 3. Column, weight, clipping ----------------------------------------
  errors.push(...checkColumnWidths(html));
  const htmlBytes = new TextEncoder().encode(html).length;
  if (htmlBytes > HTML_FAIL_BYTES) {
    errors.push({
      code: "html-too-large",
      message: `assembled HTML is ${htmlBytes} bytes — Gmail clips at ~102KB, hiding the unsubscribe link; hard limit ${HTML_FAIL_BYTES} (04 §5e)`,
    });
  } else if (htmlBytes > HTML_WARN_BYTES) {
    warnings.push({
      code: "html-large",
      message: `assembled HTML is ${htmlBytes} bytes (> ${HTML_WARN_BYTES}) — approaching Gmail's ~102KB clip`,
    });
  }
  const imageBytes = ctx.sections.reduce(
    (sum, s) => sum + (s.type === "surface" && s.byteSize !== undefined ? s.byteSize : 0),
    0,
  );
  if (imageBytes > IMAGE_WEIGHT_WARN_BYTES) {
    warnings.push({
      code: "image-weight",
      message: `total declared image weight ${imageBytes} bytes exceeds ${IMAGE_WEIGHT_WARN_BYTES} — heavy emails load slowly on cellular and hurt engagement (04 §6.3)`,
    });
  }

  // -- 4. Links resolve; decoration-compatible ---------------------------
  for (const el of elements) {
    if (el.name !== "a") continue;
    const href = el.attribs["href"];
    const cls = el.attribs["class"] ?? "";
    if (href === undefined || href.trim() === "") {
      errors.push({
        code: "link-unresolvable",
        message: `anchor "${DomUtils.textContent(el).trim().slice(0, 60)}" has no href — every link must resolve (04 §6.4)`,
      });
      continue;
    }
    const h = href.trim();
    if (isMergeTagValue(h)) continue; // resolved by Klaviyo at send time
    if (h.startsWith("#")) {
      errors.push({
        code: "link-unresolvable",
        message: `anchor href "${h}" is fragment-only — fragments don't survive into mail clients and can't carry UTM decoration (04 §6.4)`,
      });
    }
    if (h.toLowerCase().startsWith("mailto:") && /\beab-btn\b/.test(cls)) {
      errors.push({
        code: "cta-mailto",
        message: `CTA button links to ${h} — mailto CTAs break click tracking and UTM decoration; CTAs must land on web URLs (04 §6.4)`,
      });
    }
  }

  // -- 5. Text-to-image sanity + envelope budgets -------------------------
  const textSections = ctx.sections.filter((s) => s.type === "html").length;
  const hasNonTrivialText = ctx.sections.some(
    (s) =>
      s.type === "html" &&
      (Array.isArray(s.block) ? s.block : [s.block]).some(
        (b) =>
          (b.kind === "paragraph" || b.kind === "heading") &&
          b.text.trim().length >= NON_TRIVIAL_TEXT_CHARS,
      ),
  );
  if (!hasNonTrivialText) {
    errors.push({
      code: "no-text-section",
      message: `no non-trivial HTML text section (≥${NON_TRIVIAL_TEXT_CHARS} chars of real copy) — images-off clients would render an empty email and spam filters weight text/image ratio (04 §6.5)`,
    });
  }
  if (ctx.meta.subject.length > 60) {
    warnings.push({
      code: "subject-long",
      message: `subject is ${ctx.meta.subject.length} chars — most clients truncate around 60`,
    });
  }
  const previewLen = ctx.meta.previewText.length;
  if (previewLen < 40 || previewLen > 130) {
    warnings.push({
      code: "preview-length",
      message: `preview text is ${previewLen} chars — the useful envelope window is 40–130 (below it clients pad with body text; above it truncates)`,
    });
  }

  // -- 6. Lineage stamped --------------------------------------------------
  if (!LINEAGE_COMMENT_RE.test(html)) {
    errors.push({
      code: "lineage-missing",
      message:
        "lineage comment (tokensVersion/designMdVersion/skeletonVersion) missing — assembled artifacts must be traceable to what produced them (04 §6.6)",
    });
  }

  return { errors, warnings, stats: { htmlBytes, imageCount, textSections } };
}
