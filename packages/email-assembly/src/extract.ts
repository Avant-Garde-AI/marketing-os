/**
 * Skeleton extraction + sanitization (WS2-R3, 04 §3).
 *
 * Separates FRAME from CONTENT in a store's reference Klaviyo template: the
 * frame (doctype/head/meta, MSO conditionals, outer table scaffolding,
 * header/logo band, footer/legal/unsubscribe) is preserved BYTE-VERBATIM;
 * content regions become `{{slot:NAME}}` markers.
 *
 * ## Parser strategy — splice, never re-serialize
 *
 * The template is parsed with htmlparser2 (`withStartIndices`/
 * `withEndIndices`) purely to LOCATE byte ranges; the skeleton is then built
 * by splicing the ORIGINAL source string. Nothing outside a removed/replaced
 * range is ever re-encoded, so frame preservation (including MSO conditional
 * comments, `{% unsubscribe %}` merge tags, attribute quoting, whitespace) is
 * guaranteed by construction — and the output is deterministic bytes for
 * deterministic input. Re-serializing through a DOM would silently normalize
 * exactly the fragile parts (conditional comments, void tags, entities) that
 * make a store's frame deliverability-proven.
 *
 * ## Region classification — heuristic, and honestly so (04 §3 step 3)
 *
 * This package's classifier is RULE-BASED. LLM-assisted classification is
 * allowed at the tooling layer above (which can propose region overrides);
 * what lives here must be mechanically checkable. The rules:
 *
 *   spine    the element declaring a 320–600px width (attr or style
 *            width/max-width) with the most "bands" — a table's direct rows,
 *            or a td/div/center's child tables/divs.
 *   header   leading bands containing a logo-hinted image (alt/src/class
 *            matching /logo|wordmark|brand-mark/) or a short nav row
 *            (≥2 links, <90 chars, no imagery) → frame.
 *   footer   the first band carrying an unsubscribe signal, and everything
 *            after it, → frame; immediately preceding bands that look legal
 *            (©, "rights reserved", preference links, {% organization … %})
 *            are pulled into the frame too.
 *   content  everything between → slots, named by shape: a large (≥400px)
 *            image with little text → `hero`; ≥2 images AND ≥2 links →
 *            `products`; a link styled as a button → `cta`; otherwise
 *            `body-N`. Duplicate names get `-2`, `-3` suffixes.
 *
 * Known limits (budget hand-tuning for the first store, 04 §3):
 *   - Unsubscribe living OUTSIDE the spine (a sibling table below it) means
 *     no footer boundary is found inside the spine; trailing legal bands
 *     inside the spine without unsubscribe signals would be misread as
 *     content. The unsubscribe-presence invariant still holds either way.
 *   - MSO conditional comments WRAPPING an individual content band survive
 *     in the skeleton as orphaned ghost markup (comments are opaque to the
 *     classifier). Conditionals in head/outer scaffolding — where real
 *     templates put them — are unaffected.
 *   - A template whose "content" is one giant td (no band structure) yields
 *     a single slot at best.
 * The owner-approval gate (04 §3 step 5) is what makes heuristic acceptable:
 * the product is the pipeline plus the gate, not magic extraction.
 *
 * ## Slot markers
 *
 * A band that is a `<tr>` is replaced by `<tr><td>{{slot:NAME}}</td></tr>`
 * (markers must sit in a td context — renderers emit full `<table>` blocks,
 * valid inside a td). A band that is a sibling table/div is replaced by the
 * bare marker (it already sits inside a td/div). `assembleEmail` therefore
 * never needs to know which kind of band a slot came from.
 *
 * ## Store-repo pipeline note
 *
 * Skeletons and full templates may be AUTHORED from shared partials via
 * `<!--PARTIAL:name-->` markers (the proven Arthaus email-system pattern —
 * see compose.ts). The canonical pipeline is:
 *
 *   templates/partials + template → composePartials() → full HTML
 *     → extractSkeleton() → skeleton → assembleEmail()
 *
 * Klaviyo Django tags (`{{ first_name }}`, `{% … %}`) must be preserved
 * VERBATIM through every one of those transforms — extraction guarantees it
 * for the frame by splicing (above), and assembly re-verifies mechanically
 * (invariants.ts `merge-tag-altered`).
 */

import { parseDocument, DomUtils } from "htmlparser2";
import type {
  ExtractOptions,
  ExtractedSkeleton,
  SkeletonFinding,
  SkeletonSlot,
} from "./types";
import {
  DEFAULT_ALLOWED_IMAGE_HOSTS,
  checkColumnWidths,
  findUnsubscribeTags,
  hostAllowed,
} from "./invariants";

type ParsedDoc = ReturnType<typeof parseDocument>;
type AnyChild = ParsedDoc["children"][number];
type ElementNode = Extract<AnyChild, { attribs: Record<string, string> }>;

/**
 * Thrown when extraction output violates a mechanical invariant (04 §3):
 * unsubscribe present, single ≤600px column, parseable HTML, ≥1 slot.
 * These THROW (rather than reporting) because a skeleton that fails them is
 * unusable — there is nothing downstream to gate.
 */
export class SkeletonExtractionError extends Error {
  readonly code: "unparseable" | "no-single-column" | "column-too-wide" | "unsubscribe-missing" | "no-slots";

  constructor(code: SkeletonExtractionError["code"], message: string) {
    super(message);
    this.name = "SkeletonExtractionError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// DOM helpers (byte-range oriented — see module JSDoc).
// ---------------------------------------------------------------------------

function* walkElements(nodes: AnyChild[]): Generator<ElementNode> {
  for (const node of nodes) {
    if (DomUtils.isTag(node)) {
      yield node as ElementNode;
      yield* walkElements(node.children as AnyChild[]);
    }
  }
}

interface ByteRange {
  start: number;
  /** Exclusive. */
  end: number;
}

function rangeOf(el: ElementNode, doc: string): ByteRange {
  if (el.startIndex == null || el.endIndex == null) {
    // Cannot happen with withStartIndices/withEndIndices; guard for honesty.
    throw new SkeletonExtractionError(
      "unparseable",
      `reference template: parser produced a <${el.name}> without byte indices — cannot splice safely`,
    );
  }
  return { start: el.startIndex, end: Math.min(el.endIndex + 1, doc.length) };
}

function sourceOf(el: ElementNode, doc: string): string {
  const { start, end } = rangeOf(el, doc);
  return doc.slice(start, end);
}

const STYLE_WIDTH_RE = /(?:^|[^-\w])(?:max-)?width\s*:\s*(\d+(?:\.\d+)?)px/i;

function declaredPxWidth(el: ElementNode): number | undefined {
  const attr = el.attribs["width"];
  if (attr && /^\d+$/.test(attr)) return Number(attr);
  const style = el.attribs["style"];
  if (style) {
    const m = STYLE_WIDTH_RE.exec(style);
    if (m && m[1] !== undefined) return Number(m[1]);
  }
  return undefined;
}

function closestTableAncestor(el: ElementNode): ElementNode | null {
  let parent = el.parent;
  while (parent) {
    if (DomUtils.isTag(parent) && parent.name === "table") return parent as ElementNode;
    parent = parent.parent;
  }
  return null;
}

function descendantsByName(el: ElementNode, name: string): ElementNode[] {
  return [...walkElements(el.children as AnyChild[])].filter((d) => d.name === name);
}

// ---------------------------------------------------------------------------
// Spine + band detection.
// ---------------------------------------------------------------------------

interface Spine {
  el: ElementNode;
  width: number;
  bands: ElementNode[];
}

/** Bands of a candidate spine — see module JSDoc for the two shapes. */
function bandsOf(el: ElementNode): ElementNode[] {
  if (el.name === "table") {
    // Direct rows: trs whose nearest table ancestor is this table (rows of
    // nested per-band tables belong to those tables, not the spine).
    return descendantsByName(el, "tr").filter((tr) => closestTableAncestor(tr) === el);
  }
  if (el.name === "td" || el.name === "div" || el.name === "center") {
    // Stacked-block style (drag-drop editors, hybrid hand-coded): each child
    // table/div is one band. Comments between bands are frame and survive.
    return (el.children as AnyChild[]).filter(
      (c): c is ElementNode => DomUtils.isTag(c) && (c.name === "table" || c.name === "div"),
    );
  }
  return [];
}

function findSpine(doc: ParsedDoc): Spine | null {
  let best: Spine | null = null;
  for (const el of walkElements(doc.children)) {
    const width = declaredPxWidth(el);
    if (width === undefined || width < 320 || width > 600) continue;
    const bands = bandsOf(el);
    if (bands.length < 2) continue;
    if (!best || bands.length > best.bands.length) best = { el, width, bands };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Band classification.
// ---------------------------------------------------------------------------

const LOGO_HINT_RE = /logo|wordmark|brand-?mark/i;
const FOOTERISH_RE =
  /©|&copy;|rights\s+reserved|manage\s+preferences|preference\s+(?:center|page)|\{%[^%}]*organization[^%}]*%\}/i;

function bandText(band: ElementNode): string {
  return DomUtils.textContent(band).replace(/\s+/g, " ").trim();
}

function isFrameHeader(band: ElementNode): boolean {
  const imgs = descendantsByName(band, "img");
  for (const img of imgs) {
    const hint = `${img.attribs["alt"] ?? ""} ${img.attribs["src"] ?? ""} ${img.attribs["class"] ?? ""}`;
    if (LOGO_HINT_RE.test(hint)) return true;
  }
  const anchors = descendantsByName(band, "a");
  return imgs.length === 0 && anchors.length >= 2 && bandText(band).length < 90;
}

function hasUnsubscribeSignal(bandSource: string): boolean {
  return findUnsubscribeTags(bandSource).length > 0;
}

type ContentKind = "hero" | "products" | "cta" | "body";

function classifyContent(band: ElementNode): ContentKind {
  const imgs = descendantsByName(band, "img");
  const anchors = descendantsByName(band, "a");
  const text = bandText(band);
  const hasLargeImage = imgs.some((img) => {
    const w = declaredPxWidth(img);
    return w !== undefined && w >= 400;
  });
  if (hasLargeImage && text.length < 200) return "hero";
  if (imgs.length >= 2 && anchors.length >= 2) return "products";
  const buttonish = anchors.some(
    (a) =>
      /background(?:-color)?\s*:/.test(a.attribs["style"] ?? "") ||
      /\b(?:btn|button)\b/i.test(a.attribs["class"] ?? ""),
  );
  if (buttonish && text.length < 120) return "cta";
  return "body";
}

// ---------------------------------------------------------------------------
// Slot constraints (documented heuristics — see SkeletonSlot JSDoc).
// ---------------------------------------------------------------------------

const STYLE_BG_RE = /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\b/;
const STYLE_PADDING_RE = /(?:^|;)\s*padding\s*:\s*([^;"]+)/;

function backgroundOf(el: ElementNode): string | undefined {
  const bgcolor = el.attribs["bgcolor"];
  if (bgcolor) return bgcolor;
  const style = el.attribs["style"];
  if (style) {
    const m = STYLE_BG_RE.exec(style);
    if (m && m[1] !== undefined) return m[1];
  }
  return undefined;
}

function slotConstraints(band: ElementNode, spine: Spine, name: string): SkeletonSlot {
  // maxWidth: the spine's column width, narrowed by the band's own first
  // cell when it declares something narrower. We do NOT subtract padding —
  // padding context is recorded separately and renderers own their gutters.
  const firstCell = band.name === "tr" ? descendantsByName(band, "td")[0] : band;
  const cellWidth = firstCell ? declaredPxWidth(firstCell) : undefined;
  const maxWidth = Math.min(spine.width, cellWidth ?? spine.width, 600);

  // backgroundContext: nearest declared background walking band → ancestors.
  let backgroundContext: string | null = null;
  let cursor: ElementNode | null = band;
  while (cursor) {
    const bg = backgroundOf(cursor);
    if (bg) {
      backgroundContext = bg;
      break;
    }
    const parent: unknown = cursor.parent;
    cursor =
      parent && DomUtils.isTag(parent as AnyChild) ? (parent as ElementNode) : null;
  }

  // paddingContext: the band's own cell padding, verbatim.
  let paddingContext: string | null = null;
  const paddingSource = band.name === "tr" ? descendantsByName(band, "td")[0] : band;
  const style = paddingSource?.attribs["style"];
  if (style) {
    const m = STYLE_PADDING_RE.exec(style);
    if (m && m[1] !== undefined) paddingContext = m[1].trim();
  }

  return { name, maxWidth, backgroundContext, paddingContext };
}

// ---------------------------------------------------------------------------
// Splicing.
// ---------------------------------------------------------------------------

interface Edit extends ByteRange {
  replacement: string;
}

/** Apply non-overlapping edits; inner edits swallowed by an outer range drop. */
function applyEdits(source: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Edit[] = [];
  for (const edit of sorted) {
    const last = kept[kept.length - 1];
    if (last && edit.start < last.end) continue; // contained in a replaced band
    kept.push(edit);
  }
  let out = "";
  let cursor = 0;
  for (const edit of kept) {
    out += source.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return out + source.slice(cursor);
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

const HEX_COLOR_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

/** Normalize #abc → #aabbcc, lowercase, for the naive brand-drift compare. */
function normalizeHex(hex: string): string {
  const h = hex.toLowerCase();
  if (h.length === 4) {
    const r = h[1] ?? "0";
    const g = h[2] ?? "0";
    const b = h[3] ?? "0";
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return h;
}

/**
 * Extract a reusable skeleton from a reference Klaviyo template (04 §3).
 *
 * Sanitization performed (every transform recorded in `findings`):
 *   - `<script>` elements removed anywhere (email clients strip them, spam
 *     filters penalize them, and they can never be part of a frame);
 *   - foreign tracking pixels removed: 1×1/0×0 images whose host is not in
 *     the allowlist (Klaviyo injects its own tracking at send time — a
 *     hardcoded pixel is a previous ESP's leftover);
 *   - campaign-specific copy in content regions replaced by slot markers.
 *
 * `brand-drift` findings are emitted only when `options.brandColors` is
 * provided (naive exact-hex compare — see ExtractOptions).
 *
 * Throws {@link SkeletonExtractionError} when the OUTPUT violates a
 * mechanical invariant: unparseable input, no single ≤600px column, any
 * structural width >600px, no unsubscribe merge tag, or zero slots.
 */
export function extractSkeleton(
  templateHtml: string,
  options?: ExtractOptions,
): ExtractedSkeleton {
  if (typeof templateHtml !== "string" || templateHtml.trim() === "") {
    throw new SkeletonExtractionError("unparseable", "reference template: empty input");
  }

  // htmlparser2 is deliberately lenient (like mail clients themselves), so
  // "valid parseable HTML" here means: parses to a non-empty element tree
  // that contains body/table structure. Malformed-but-renderable email HTML
  // passes — exactly the leniency the frame relies on in the wild.
  const doc = parseDocument(templateHtml, { withStartIndices: true, withEndIndices: true });
  const allElements = [...walkElements(doc.children)];
  if (allElements.length === 0 || !allElements.some((el) => el.name === "body" || el.name === "table")) {
    throw new SkeletonExtractionError(
      "unparseable",
      "reference template: no <body> or <table> structure found — not email HTML",
    );
  }

  const allowedHosts = options?.allowedImageHosts ?? DEFAULT_ALLOWED_IMAGE_HOSTS;
  const findings: SkeletonFinding[] = [];
  const edits: Edit[] = [];

  // -- Sanitize: scripts ---------------------------------------------------
  for (const el of allElements) {
    if (el.name === "script") {
      edits.push({ ...rangeOf(el, templateHtml), replacement: "" });
      findings.push({
        type: "script-removed",
        detail: `removed <script> (${sourceOf(el, templateHtml).slice(0, 80)}…) — scripts never survive mail clients and hurt spam scoring`,
      });
    }
  }

  // -- Sanitize: foreign tracking pixels ------------------------------------
  for (const el of allElements) {
    if (el.name !== "img") continue;
    const w = el.attribs["width"];
    const h = el.attribs["height"];
    const style = el.attribs["style"] ?? "";
    const tiny =
      (w !== undefined && Number(w) <= 1) ||
      (h !== undefined && Number(h) <= 1) ||
      /(?:^|[^-\w])width\s*:\s*[01]px/.test(style);
    if (!tiny) continue;
    const src = el.attribs["src"] ?? "";
    if (src.startsWith("{%") || src.startsWith("{{")) continue; // Klaviyo's own
    let host: string | undefined;
    try {
      host = new URL(src).hostname;
    } catch {
      host = undefined;
    }
    if (host !== undefined && hostAllowed(host, allowedHosts)) continue;
    edits.push({ ...rangeOf(el, templateHtml), replacement: "" });
    findings.push({
      type: "tracking-pixel-removed",
      detail: `removed 1×1 tracking pixel from foreign host: ${src.slice(0, 100) || "(no src)"} — Klaviyo injects its own tracking at send time`,
    });
  }

  // -- Locate spine + bands -------------------------------------------------
  const spine = findSpine(doc);
  if (!spine) {
    throw new SkeletonExtractionError(
      "no-single-column",
      "reference template: no single-column spine detected (an element declaring 320–600px width with ≥2 bands) — the skeleton contract requires the email-standard ≤600px column (04 §3)",
    );
  }
  const preSpliceWidthIssues = checkColumnWidths(templateHtml);
  if (preSpliceWidthIssues.length > 0) {
    throw new SkeletonExtractionError(
      "column-too-wide",
      `reference template: ${preSpliceWidthIssues[0]?.message ?? "structural width over 600px"}`,
    );
  }

  // -- Classify bands ---------------------------------------------------------
  const bands = spine.bands;
  let headerEnd = 0;
  while (headerEnd < bands.length) {
    const band = bands[headerEnd];
    if (!band || !isFrameHeader(band)) break;
    headerEnd++;
  }
  let footerStart = bands.length;
  for (let i = headerEnd; i < bands.length; i++) {
    const band = bands[i];
    if (band && hasUnsubscribeSignal(sourceOf(band, templateHtml))) {
      footerStart = i;
      break;
    }
  }
  while (footerStart > headerEnd) {
    const prev = bands[footerStart - 1];
    if (!prev || !FOOTERISH_RE.test(sourceOf(prev, templateHtml))) break;
    footerStart--;
  }

  const contentBands = bands.slice(headerEnd, footerStart);
  if (contentBands.length === 0) {
    throw new SkeletonExtractionError(
      "no-slots",
      "reference template: no content regions found between the header and footer frame — a skeleton with zero slots cannot host a campaign (04 §3)",
    );
  }

  // -- Name slots, record constraints, splice markers -----------------------
  const nameCounts = new Map<string, number>();
  let bodyCounter = 0;
  const slots: SkeletonSlot[] = [];
  for (const band of contentBands) {
    const kind = classifyContent(band);
    let base: string;
    if (kind === "body") {
      bodyCounter++;
      base = `body-${bodyCounter}`;
    } else {
      base = kind;
    }
    const seen = nameCounts.get(base) ?? 0;
    nameCounts.set(base, seen + 1);
    const name = seen === 0 ? base : `${base}-${seen + 1}`;

    slots.push(slotConstraints(band, spine, name));

    const marker = `{{slot:${name}}}`;
    const replacement = band.name === "tr" ? `<tr><td>${marker}</td></tr>` : marker;
    edits.push({ ...rangeOf(band, templateHtml), replacement });

    const preview = bandText(band).slice(0, 60);
    findings.push({
      type: "content-replaced",
      detail: `slot ${name}: replaced ${kind === "body" ? "copy" : kind} region${preview ? ` ("${preview}${preview.length === 60 ? "…" : ""}")` : ""} with ${marker}`,
    });
  }

  const skeletonHtml = applyEdits(templateHtml, edits);

  // -- Brand drift (optional, naive by design) -------------------------------
  if (options?.brandColors && options.brandColors.length > 0) {
    const palette = new Set(options.brandColors.map(normalizeHex));
    const seenForeign = new Set<string>();
    for (const m of skeletonHtml.matchAll(HEX_COLOR_RE)) {
      const hex = normalizeHex(m[0]);
      if (!palette.has(hex) && !seenForeign.has(hex)) {
        seenForeign.add(hex);
        findings.push({
          type: "brand-drift",
          detail: `frame color ${hex} is not in the DESIGN.md palette — worth surfacing to the owner (spec 21 coherence-check discipline)`,
        });
      }
    }
  }

  // -- Mechanical invariants on the OUTPUT (04 §3) ---------------------------
  if (findUnsubscribeTags(skeletonHtml).length === 0) {
    throw new SkeletonExtractionError(
      "unsubscribe-missing",
      "reference template: no Klaviyo unsubscribe merge tag ({% unsubscribe %} family or unsubscribe href) survives in the skeleton — breaking unsubscribe is a compliance incident; refusing to emit this skeleton",
    );
  }
  const postWidthIssues = checkColumnWidths(skeletonHtml);
  if (postWidthIssues.length > 0) {
    throw new SkeletonExtractionError(
      "column-too-wide",
      `extracted skeleton: ${postWidthIssues[0]?.message ?? "structural width over 600px"}`,
    );
  }
  for (const slot of slots) {
    if (!skeletonHtml.includes(`{{slot:${slot.name}}}`)) {
      throw new SkeletonExtractionError(
        "no-slots",
        `extracted skeleton: marker {{slot:${slot.name}}} was lost during splicing — extraction bug, refusing to emit`,
      );
    }
  }

  return { skeletonHtml, slots, findings };
}
