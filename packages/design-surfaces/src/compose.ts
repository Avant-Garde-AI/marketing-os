/**
 * Lane 1 — file-first composition (spec 23 §4).
 *
 * Builds a .penpot document in memory via @penpot/library and returns the
 * bytes; the adapter's importBinfile lands it in a tenant team. Deterministic,
 * headless, no browser, no MCP.
 *
 * @penpot/library is 1.2.0-RC ("limited feature set" — spec 23 OQ1). The
 * builder surface we rely on (verified against RC2): addFile/addPage/addBoard,
 * addRect/addText, addFileMedia + getMediaAsImage (image fills), addTokensLib
 * (DTCG sets), addLibraryColor/addLibraryTypography. The canary suite
 * round-trips a composed file through a live instance.
 */

import type { BoardSpec, ComposeElement, ComposeSpec } from "./types.js";

type PenpotLibrary = typeof import("@penpot/library");
type BuildContext = import("@penpot/library").BuildContext;

let libPromise: Promise<PenpotLibrary> | undefined;
function lib(): Promise<PenpotLibrary> {
  libPromise ??= import("@penpot/library");
  return libPromise;
}

/** Penpot text style attrs from a ComposeElement — applied at both paragraph
 * and text-node level. Google-font ids follow Penpot's `gfont-<slug>` scheme;
 * the instance default (sourcesanspro) is used when no family is given. */
function textStyle(el: {
  fontId?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  lineHeight?: string;
  textAlign?: string;
  fills?: unknown[];
}): Record<string, unknown> {
  const family = el.fontFamily ?? "sourcesanspro";
  const fontId =
    el.fontId ?? (el.fontFamily ? `gfont-${family.toLowerCase().replace(/\s+/g, "-")}` : "sourcesanspro");
  const weight = el.fontWeight ?? "400";
  const italic = el.fontStyle === "italic";
  const fontVariantId = italic ? (weight === "400" ? "italic" : `${weight}italic`) : weight === "400" ? "regular" : weight;
  return {
    fontId,
    fontFamily: family,
    fontSize: el.fontSize ?? "16",
    fontWeight: weight,
    fontStyle: el.fontStyle ?? "normal",
    fontVariantId,
    textAlign: el.textAlign ?? "left",
    ...(el.lineHeight ? { lineHeight: el.lineHeight } : {}),
    // Text fills WITHOUT an explicit fillOpacity render as default black —
    // normalize so palette colors actually apply.
    fills: (el.fills ?? [{ fillColor: "#000000" }]).map((f) => ({
      fillOpacity: 1,
      ...(f as Record<string, unknown>),
    })),
  };
}

/** Vertical gap between boards on a multi-board page (WS2-R1). Fixed by
 * design — deterministic compose means layout is never an input. */
export const BOARD_GUTTER = 100;

/**
 * Normalize a ComposeSpec to its multi-board form. The original single-board
 * shape (`board` + top-level `elements`) is sugar for a one-element `boards`
 * array; the two forms are mutually exclusive so a spec can never be
 * ambiguous about which elements belong to which board.
 */
export function resolveBoards(spec: ComposeSpec): BoardSpec[] {
  if (spec.boards) {
    if (spec.board) {
      throw new Error("ComposeSpec: provide either `boards` or the single-`board` sugar, not both");
    }
    if (spec.elements) {
      throw new Error(
        "ComposeSpec: top-level `elements` belongs to the single-`board` sugar; with `boards`, put elements inside each BoardSpec",
      );
    }
    if (spec.boards.length === 0) throw new Error("ComposeSpec: `boards` must not be empty");
    return spec.boards;
  }
  if (!spec.board) throw new Error("ComposeSpec: provide `boards` or the single-`board` sugar");
  return [{ ...spec.board, elements: spec.elements ?? [] }];
}

/** A BoardSpec with its resolved page-space position. */
export interface PlacedBoard extends BoardSpec {
  x: number;
  y: number;
}

/**
 * Pure column layout: boards stack vertically in declaration order at x=0,
 * board N's y = sum of previous board heights + N × gutter. Deterministic —
 * the same boards always land at the same coordinates.
 */
export function layoutBoards(boards: BoardSpec[], gutter: number = BOARD_GUTTER): PlacedBoard[] {
  let y = 0;
  return boards.map((b) => {
    const placed: PlacedBoard = { ...b, x: 0, y };
    y += b.height + gutter;
    return placed;
  });
}

// ── Fit check (refinement backlog #1) ────────────────────────────────────
//
// Composed drafts must not overflow their board: a clipped CTA in the first
// live sim came from free-form (LLM-authored) layout with nothing validating
// bounds. Two certainty tiers, kept separate on purpose:
//
//   error   — the DECLARED geometry violates the board rect. Certain from the
//             spec alone; composeSurfaceFile refuses to build these.
//   warning — a text element's RENDERED height (Penpot draws text past its
//             declared box rather than clipping to it) is *estimated* to
//             overflow. Heuristic — no font metrics here — so the library
//             never blocks on it; enforcement policy belongs to callers
//             (the agent tool boundary rejects board-edge clips).

/** Average glyph width as a fraction of fontSize — deliberately LOW so the
 * wrap estimate under-counts lines and board-clip findings stay rare enough
 * to trust (a false block costs an agent turn; a miss costs one re-compose). */
const AVG_CHAR_WIDTH_FACTOR = 0.5;
/** Penpot's default line height when a text node sets none. */
const DEFAULT_LINE_HEIGHT = 1.2;

export interface FitFinding {
  severity: "error" | "warning";
  /** "out-of-bounds" | "nonpositive-size" (errors) · "text-board-clip" | "text-box-overflow" (warnings) */
  code: "out-of-bounds" | "nonpositive-size" | "text-board-clip" | "text-box-overflow";
  board: string;
  element: string;
  message: string;
}

export interface FitReport {
  ok: boolean;
  errors: FitFinding[];
  warnings: FitFinding[];
}

/** Estimated rendered text height: newline paragraphs, each wrapped at the
 * declared width using the average-glyph-width heuristic. */
function estimateTextHeight(el: Extract<ComposeElement, { type: "text" }>): number {
  const fontSize = Number(el.fontSize) || 16;
  const lineHeight = Number(el.lineHeight) || DEFAULT_LINE_HEIGHT;
  const lines = el.characters.split("\n").reduce((n, line) => {
    const lineWidth = line.length * fontSize * AVG_CHAR_WIDTH_FACTOR;
    return n + Math.max(1, Math.ceil(lineWidth / Math.max(el.width, 1)));
  }, 0);
  return lines * fontSize * lineHeight;
}

/**
 * Validate a ComposeSpec's layout against its board rects. Element
 * coordinates are board-relative, so each element checks against its own
 * board's width/height directly. Pure and deterministic — same spec, same
 * report.
 */
export function checkComposeFit(spec: ComposeSpec): FitReport {
  const errors: FitFinding[] = [];
  const warnings: FitFinding[] = [];
  for (const board of resolveBoards(spec)) {
    board.elements.forEach((el, i) => {
      const id = el.name ?? `${el.type}#${i + 1}`;
      if (el.width <= 0 || el.height <= 0) {
        errors.push({
          severity: "error",
          code: "nonpositive-size",
          board: board.name,
          element: id,
          message: `"${id}" on board "${board.name}" has non-positive size ${el.width}×${el.height}.`,
        });
        return;
      }
      const overRight = el.x + el.width - board.width;
      const overBottom = el.y + el.height - board.height;
      if (el.x < 0 || el.y < 0 || overRight > 0 || overBottom > 0) {
        const spill = [
          el.x < 0 ? `${-el.x}px past the left edge` : null,
          el.y < 0 ? `${-el.y}px past the top edge` : null,
          overRight > 0 ? `${overRight}px past the right edge` : null,
          overBottom > 0 ? `${overBottom}px past the bottom edge` : null,
        ]
          .filter(Boolean)
          .join(", ");
        errors.push({
          severity: "error",
          code: "out-of-bounds",
          board: board.name,
          element: id,
          message: `"${id}" (x=${el.x}, y=${el.y}, ${el.width}×${el.height}) extends ${spill} of board "${board.name}" (${board.width}×${board.height}).`,
        });
        return;
      }
      if (el.type === "text") {
        const estHeight = Math.ceil(estimateTextHeight(el));
        const estOverBottom = el.y + estHeight - board.height;
        if (estOverBottom > 0) {
          warnings.push({
            severity: "warning",
            code: "text-board-clip",
            board: board.name,
            element: id,
            message: `"${id}" likely renders ~${estHeight}px tall (declared ${el.height}px) and would clip ~${estOverBottom}px past the bottom edge of board "${board.name}" — move it up, shorten the text, or reduce the font size.`,
          });
        } else if (estHeight > el.height) {
          warnings.push({
            severity: "warning",
            code: "text-box-overflow",
            board: board.name,
            element: id,
            message: `"${id}" likely renders ~${estHeight}px tall, overflowing its declared ${el.height}px box (stays on the board).`,
          });
        }
      }
    });
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * COORDINATE SEMANTICS (verified empirically against @penpot/library
 * 1.2.0-RC2 by unzipping the emitted binfile — see test/multiboard.test.ts):
 * child shapes added between addBoard...closeBoard are stored VERBATIM in the
 * page JSON (`selrect` in absolute page coordinates); the library does NOT
 * translate them into the open board's space. A rect given x=10,y=20 inside a
 * board at y=500 lands at page (10,20) — outside its own board. The shipped
 * single-board case placed the board at the origin, where board-relative and
 * absolute are indistinguishable; multi-board makes the difference real, so
 * this helper applies the board's page offset to every element. BoardSpec
 * elements therefore stay board-relative — the ergonomic contract callers
 * (and compose templates) author against.
 */
function addElement(ctx: BuildContext, el: ComposeElement, dx: number, dy: number): void {
  const x = el.x + dx;
  const y = el.y + dy;
  switch (el.type) {
    case "rect":
      ctx.addRect({
        name: el.name ?? "rect",
        x,
        y,
        width: el.width,
        height: el.height,
        ...(el.fills ? { fills: el.fills } : {}),
        ...(el.rx != null ? { rx: el.rx } : {}),
        ...(el.ry != null ? { ry: el.ry } : {}),
      });
      break;
    case "text": {
      // Penpot renders text from a content TREE (root → paragraph-set →
      // paragraph → text nodes); flat `characters` params import but never
      // render. Synthesize the tree, one paragraph per newline-split line.
      const style = textStyle(el);
      const paragraphs = el.characters.split("\n").map((line) => ({
        type: "paragraph",
        ...style,
        children: [{ text: line, ...style }],
      }));
      ctx.addText({
        name: el.name ?? "text",
        x,
        y,
        width: el.width,
        height: el.height,
        content: {
          type: "root",
          children: [{ type: "paragraph-set", children: paragraphs }],
        },
      });
      break;
    }
    case "image": {
      const mediaId = ctx.addFileMedia(
        { name: el.name ?? "image", width: el.width, height: el.height },
        new Blob([el.data], { type: el.mediaType }),
      );
      const imageFill = ctx.getMediaAsImage(mediaId);
      ctx.addRect({
        name: el.name ?? "image",
        x,
        y,
        width: el.width,
        height: el.height,
        fills: [{ fillImage: imageFill, fillOpacity: 1 }],
      });
      break;
    }
  }
}

/**
 * Compose a .penpot document (binfile-v3 zip bytes) — one page, one or more
 * boards. Multi-board specs (WS2-R1) stack boards vertically with
 * BOARD_GUTTER between them; the single-board `board`+`elements` sugar is
 * unchanged from the shipped shape. Tokens and library colors are file-level.
 */
export async function composeSurfaceFile(spec: ComposeSpec): Promise<Uint8Array> {
  const fit = checkComposeFit(spec);
  if (!fit.ok) {
    throw new Error(
      `ComposeSpec does not fit its board(s):\n${fit.errors.map((f) => `- ${f.message}`).join("\n")}`,
    );
  }
  const penpot = await lib();
  const ctx = penpot.createBuildContext();

  ctx.addFile({ name: spec.fileName });

  if (spec.tokens) {
    // Penpot's addTokensLib validator accepts token SETS only — root-level
    // DTCG metadata keys ($description, $extensions, $metadata, $themes)
    // fail its check. Strip them; set-level content passes through intact.
    const sets = Object.fromEntries(
      Object.entries(spec.tokens).filter(([k]) => !k.startsWith("$")),
    );
    if (Object.keys(sets).length > 0) ctx.addTokensLib(sets);
  }
  for (const c of spec.libraryColors ?? []) {
    ctx.addLibraryColor({ name: c.name, color: c.color, opacity: c.opacity ?? 1 });
  }

  ctx.addPage({ name: spec.pageName ?? "Surface" });

  for (const board of layoutBoards(resolveBoards(spec))) {
    ctx.addBoard({
      name: board.name,
      x: board.x,
      y: board.y,
      width: board.width,
      height: board.height,
      ...(board.background ? { fills: [board.background] } : {}),
    });
    for (const el of board.elements) {
      // Translate board-relative element coords to page space — see the
      // coordinate-semantics note on addElement.
      addElement(ctx, el, board.x, board.y);
    }
    ctx.closeBoard();
  }

  ctx.closePage();
  ctx.closeFile();

  // exportStream rather than exportAsBytes: the byte path trips over the
  // bundle's zip writer in some runtimes (vitest pools); streaming is the
  // code path that behaves everywhere.
  const chunks: Uint8Array[] = [];
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });
  await penpot.exportStream(ctx, sink);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
