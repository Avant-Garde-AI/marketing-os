/**
 * The fixed section-renderer vocabulary (WS2-R4, 04 §5a).
 *
 * Five HTML block renderers + the surface (image) renderer — hand-hardened
 * once, reused everywhere, NEVER free-form LLM HTML. Every renderer emits a
 * complete `<table role="presentation" width="100%">` block so its output is
 * valid wherever a `{{slot:NAME}}` marker sits (extraction guarantees markers
 * live inside a `<td>` context).
 *
 * Email-client quirks each pattern exists for (the compose.ts-of-email —
 * the reasons are load-bearing, so they live here in the code):
 *
 * - **Tables, not divs, for structure.** Outlook Windows renders with the
 *   Word engine: no box-model floats, unreliable div widths, no max-width.
 *   `role="presentation"` keeps screen readers from announcing layout tables.
 * - **Everything inline.** Gmail clips `<style>` in forwarded/clipped
 *   contexts and some Android clients drop `<head>` wholesale; only media
 *   queries stay in the head (see css.ts).
 * - **px line-height + `mso-line-height-rule:exactly`.** Word rounds
 *   unitless line-heights to its own grid; the rule pins it.
 * - **Bulletproof buttons.** A padded `<a>` alone renders as bare text in
 *   Outlook (anchor padding unsupported); the `<v:roundrect>` VML shape
 *   inside `<!--[if mso]>` gives Outlook a real filled, clickable box while
 *   every other client renders the styled anchor from `<!--[if !mso]>`.
 *   VML needs a FIXED width — estimated from text length (~8.5px/char at
 *   16px bold), deterministic by construction.
 * - **Product rows: fluid-hybrid columns.** `display:inline-block` divs
 *   wrap/stack naturally on narrow screens (plus the head media query for
 *   clients that honor it), while an MSO ghost table pins side-by-side
 *   columns for Outlook — which never stacks; that's the accepted fallback.
 *   The container td sets `font-size:0` to kill inter-inline-block
 *   whitespace gaps.
 * - **Spacers over margins.** Margin support is inconsistent (Outlook.com
 *   strips margin on some elements); a fixed-height td with
 *   `font-size:1px;line-height:Npx` + `&nbsp;` is the only spacer that
 *   holds everywhere. `aria-hidden` keeps it out of the accessibility tree.
 * - **Images: `display:block`** (kills the baseline gap under images in
 *   Gmail/Outlook.com), explicit `width` attribute for the Word engine
 *   (which ignores CSS width), `width:100%;max-width:Npx;height:auto` for
 *   fluid downscale on phones. Boards export @2x, so a 1200px-wide PNG
 *   renders at 600 CSS px — retina-sharp (04 §2).
 *
 * Klaviyo Django/Liquid merge tags (`{{ first_name }}`, `{% ... %}`) in
 * BLOCK TEXT are escaped like any other text — sections carry final copy;
 * personalization tags belong to the skeleton, which is never re-encoded.
 */

import type { EmailBlock, ProductItem, SurfaceSection } from "./types";
import type { EmailTheme } from "./css";

// ---------------------------------------------------------------------------
// Escaping.
// ---------------------------------------------------------------------------

/** Escape text content. Ampersand first — order matters. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape an attribute value (double-quoted attributes everywhere). */
export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

const BLOCK_OPEN =
  `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" class="eab-block">`;

// ---------------------------------------------------------------------------
// Block renderers.
// ---------------------------------------------------------------------------

function renderParagraph(text: string, theme: EmailTheme): string {
  const lhPx = Math.round(theme.bodyFontSize * theme.bodyLineHeight);
  return (
    `${BLOCK_OPEN}<tr><td class="eab-text" align="left" ` +
    `style="padding:0 ${theme.gutterPx}px 16px ${theme.gutterPx}px;` +
    `font-family:${theme.bodyFontStack};font-size:${theme.bodyFontSize}px;` +
    `line-height:${lhPx}px;mso-line-height-rule:exactly;color:${theme.textColor};">` +
    `${escapeHtml(text)}</td></tr></table>`
  );
}

/** Heading sizes derive from the level-1 token size (deterministic ratios). */
function headingSize(theme: EmailTheme, level: 1 | 2 | 3): number {
  if (level === 1) return theme.headingFontSize;
  if (level === 2) return Math.round(theme.headingFontSize * 0.75);
  return Math.round(theme.headingFontSize * 0.625);
}

function renderHeading(text: string, level: 1 | 2 | 3, theme: EmailTheme): string {
  const size = headingSize(theme, level);
  const lhPx = Math.round(size * 1.2);
  // A real h-tag for screen-reader document structure, fully reset inline so
  // no client default (margins, blue Outlook.com headings) leaks through.
  return (
    `${BLOCK_OPEN}<tr><td class="eab-heading" align="left" ` +
    `style="padding:0 ${theme.gutterPx}px 12px ${theme.gutterPx}px;">` +
    `<h${level} style="margin:0;font-family:${theme.headingFontStack};` +
    `font-size:${size}px;line-height:${lhPx}px;mso-line-height-rule:exactly;` +
    `font-weight:${theme.headingWeight};color:${theme.textColor};">` +
    `${escapeHtml(text)}</h${level}></td></tr></table>`
  );
}

const BUTTON_HEIGHT = 48;

/** Deterministic VML box width: ~8.5px/char at 16px bold, clamped 160–400. */
function buttonWidth(text: string): number {
  return Math.min(400, Math.max(160, 48 + Math.ceil(text.length * 8.5)));
}

function renderButton(text: string, href: string, theme: EmailTheme): string {
  const width = buttonWidth(text);
  const arcsize = Math.round((theme.buttonRadiusPx / BUTTON_HEIGHT) * 100);
  const label = escapeHtml(text);
  const hrefAttr = escapeAttr(href);
  const font = `font-family:${theme.bodyFontStack};font-size:16px;font-weight:bold;`;
  return (
    `${BLOCK_OPEN}<tr><td align="center" class="eab-btn-cell" ` +
    `style="padding:8px ${theme.gutterPx}px 24px ${theme.gutterPx}px;">` +
    `<!--[if mso]>` +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" ` +
    `href="${hrefAttr}" style="height:${BUTTON_HEIGHT}px;v-text-anchor:middle;width:${width}px;" ` +
    `arcsize="${arcsize}%" stroke="f" fillcolor="${theme.accentColor}">` +
    `<w:anchorlock/>` +
    `<center style="color:${theme.accentTextColor};${font}">${label}</center>` +
    `</v:roundrect>` +
    `<![endif]-->` +
    `<!--[if !mso]><!--><a href="${hrefAttr}" class="eab-btn" ` +
    `style="background-color:${theme.accentColor};border-radius:${theme.buttonRadiusPx}px;` +
    `color:${theme.accentTextColor};display:inline-block;${font}` +
    `line-height:${BUTTON_HEIGHT}px;text-align:center;text-decoration:none;` +
    `width:${width}px;-webkit-text-size-adjust:none;">${label}</a><!--<![endif]-->` +
    `</td></tr></table>`
  );
}

/** Content width inside the 600px column after the standard 24px gutters. */
const PRODUCT_ROW_WIDTH = 552;

function renderProductCell(product: ProductItem, cardWidth: number, theme: EmailTheme): string {
  const imgWidth = cardWidth - 24;
  const hrefAttr = escapeAttr(product.href);
  // Alt falls back to the product name so the alt invariant holds by
  // construction — a product shot's message IS the product (04 §5d).
  const alt = escapeAttr(product.alt ?? product.name);
  const img = product.imageUrl
    ? `<a href="${hrefAttr}"><img src="${escapeAttr(product.imageUrl)}" alt="${alt}" ` +
      `width="${imgWidth}" style="display:block;width:100%;max-width:${imgWidth}px;height:auto;border:0;"></a>`
    : "";
  return (
    `<div class="eab-col" style="display:inline-block;width:100%;max-width:${cardWidth}px;vertical-align:top;">` +
    `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">` +
    `<tr><td align="center" style="padding:8px 12px 16px 12px;">` +
    img +
    `<a href="${hrefAttr}" class="eab-text" style="display:block;padding-top:12px;` +
    `font-family:${theme.bodyFontStack};font-size:${theme.bodyFontSize}px;font-weight:600;` +
    `color:${theme.textColor};text-decoration:none;">${escapeHtml(product.name)}</a>` +
    `<span class="eab-meta" style="display:block;padding-top:4px;` +
    `font-family:${theme.bodyFontStack};font-size:14px;color:${theme.textColor};">` +
    `${escapeHtml(product.price)}</span>` +
    `</td></tr></table></div>`
  );
}

function renderProductRow(products: ProductItem[], theme: EmailTheme): string {
  const colWidth = Math.floor(PRODUCT_ROW_WIDTH / products.length);
  const cardWidth = colWidth - 8;
  const msoCellSeparator = `<!--[if mso]></td><td width="${colWidth}" valign="top"><![endif]-->`;
  const cells = products.map((p) => renderProductCell(p, cardWidth, theme)).join(msoCellSeparator);
  return (
    `${BLOCK_OPEN}<tr><td align="center" style="padding:0 ${theme.gutterPx}px;font-size:0;">` +
    `<!--[if mso]><table role="presentation" width="${PRODUCT_ROW_WIDTH}" border="0" cellpadding="0" cellspacing="0"><tr>` +
    `<td width="${colWidth}" valign="top"><![endif]-->` +
    cells +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table>`
  );
}

function renderSpacer(height: number): string {
  return (
    `${BLOCK_OPEN}<tr><td aria-hidden="true" ` +
    `style="height:${height}px;line-height:${height}px;font-size:1px;">&nbsp;</td></tr></table>`
  );
}

/** Render one block from the fixed vocabulary. */
export function renderBlock(block: EmailBlock, theme: EmailTheme): string {
  switch (block.kind) {
    case "paragraph":
      return renderParagraph(block.text, theme);
    case "heading":
      return renderHeading(block.text, block.level ?? 2, theme);
    case "button":
      return renderButton(block.text, block.href, theme);
    case "productRow":
      return renderProductRow(block.products, theme);
    case "spacer":
      return renderSpacer(block.height);
  }
}

// ---------------------------------------------------------------------------
// Surface renderer.
// ---------------------------------------------------------------------------

/**
 * A surface section is ONE `<img>` referencing a caller-supplied URL — the
 * assembler never uploads (04 §4: upload to Klaviyo Images and `image_url`
 * substitution happen in the tooling layer above). Boards export @2x, so the
 * display width is min(exported width, 600) CSS px; the `height` attribute is
 * scaled proportionally (deterministic rounding) for the Word engine, while
 * `height:auto` keeps fluid clients proportional.
 *
 * A missing `alt` renders as an alt-less img here and is caught by the
 * invariant gate — rendering must not silently invent descriptions.
 */
export function renderSurface(section: SurfaceSection, theme: EmailTheme): string {
  const displayWidth = Math.min(600, section.width);
  const displayHeight = Math.round((displayWidth * section.height) / section.width);
  const decorative = section.decorative === true;
  const altAttr = decorative
    ? ` alt="" role="presentation"`
    : section.alt !== undefined
      ? ` alt="${escapeAttr(section.alt)}"`
      : "";
  void theme; // surfaces carry their own styling to their edges (04 §5c)
  return (
    `${BLOCK_OPEN}<tr><td align="center" style="padding:0;">` +
    `<img class="eab-img" src="${escapeAttr(section.imageUrl)}" ` +
    `width="${displayWidth}" height="${displayHeight}"${altAttr} ` +
    `style="display:block;width:100%;max-width:${displayWidth}px;height:auto;border:0;">` +
    `</td></tr></table>`
  );
}
