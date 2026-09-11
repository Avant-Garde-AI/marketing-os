/**
 * Compile a store's design library into a Penpot SHARED LIBRARY file
 * (spec 30 §2).
 *
 * The craft layer — type scale, a caption band, a credit lockup, the colours
 * with names rather than hex codes — currently lives in a TypeScript literal
 * where no designer can reach it and every change is a platform deploy. This
 * module is the compiler that lets it live in the store's own repo instead:
 * JSON in, a `.penpot` library out, published into the tenant's team.
 *
 * ## Source is JSON; the binfile is a build output (spec 30 §1)
 *
 * `LibrarySource` is what a store commits and reviews. A `.penpot` file is
 * opaque, unmergeable and meaningless in a diff — a store that cannot read its
 * own design system in a pull request does not own it. So the binary is never
 * the source, and this compiler is deterministic: same JSON, same bytes, so a
 * republish that changes nothing produces a file that changed nothing.
 *
 * ## Components speak the compose vocabulary
 *
 * A component's contents are `ComposeElement`s — the same text/rect/image
 * vocabulary `composeSurfaceFile` already draws. That is deliberate: a
 * component is a named, reusable fragment of exactly what a surface is made
 * of, so nothing needs translating between the two and a component can be
 * proven by composing it.
 *
 * ## One way, always (spec 30 D1)
 *
 * Nothing here reads FROM Penpot. The repo is master; Penpot holds a published
 * artefact. `sourceDigest` exists so drift can be REPORTED — a published
 * library records the digest it was built from, and a later check can say "the
 * live library is not what the repo says" without silently re-syncing. A
 * system that auto-repairs teaches people the repo does not matter.
 */

import type { BuildContext } from "@penpot/library";
import type { ComposeElement, Fill } from "./types";

export interface LibraryColor {
  /** Token name as designers will see it, e.g. "warm-parchment". */
  name: string;
  /** "#RRGGBB". */
  color: string;
  opacity?: number;
}

export interface LibraryTypography {
  /**
   * Slash-separated for grouping in Penpot's asset panel, e.g.
   * "display/headline". The path IS the hierarchy — a flat list of twelve
   * styles is unusable at the moment a designer needs one.
   */
  name: string;
  fontFamily: string;
  /** Penpot font id (`gfont-*`); derived from fontFamily when omitted. */
  fontId?: string;
  fontSize: string;
  fontWeight?: string;
  fontStyle?: string;
  lineHeight?: string;
  letterSpacing?: string;
}

export interface LibraryComponent {
  name: string;
  width: number;
  height: number;
  background?: Fill;
  /** Board-relative, exactly as in a ComposeSpec board. */
  elements: ComposeElement[];
}

export interface LibrarySource {
  /** File name in Penpot; also how the store recognises it in the asset panel. */
  name: string;
  /** Bumped by the store when the library changes meaningfully. */
  version: string;
  colors?: LibraryColor[];
  typographies?: LibraryTypography[];
  components?: LibraryComponent[];
  /** Brand tokens (DTCG), embedded so the library carries them too. */
  tokens?: Record<string, unknown>;
}

export interface LibraryProblem {
  field: string;
  detail: string;
}

/** Penpot font id from a family, matching compose.ts's scheme exactly. */
function gfontId(family: string): string {
  return `gfont-${family.toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * Check a library before compiling it.
 *
 * Duplicate names are an ERROR rather than a warning: Penpot resolves assets
 * by name, so two components called "caption-band" means every reference to it
 * is a coin flip, and the surface that gets the wrong one still exports
 * cleanly. That is the failure class this whole lane keeps running into.
 */
export function validateLibrary(source: LibrarySource): LibraryProblem[] {
  const problems: LibraryProblem[] = [];
  if (!source.name.trim()) problems.push({ field: "name", detail: "a library needs a name" });
  if (!source.version.trim()) problems.push({ field: "version", detail: "a library needs a version" });

  const seen = (kind: string, names: string[]) => {
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    for (const d of new Set(dupes)) {
      problems.push({
        field: kind,
        detail: `duplicate ${kind} name "${d}" — Penpot resolves assets by name, so a reference to it would be ambiguous`,
      });
    }
  };
  seen("color", (source.colors ?? []).map((c) => c.name));
  seen("typography", (source.typographies ?? []).map((t) => t.name));
  seen("component", (source.components ?? []).map((c) => c.name));

  for (const c of source.components ?? []) {
    if (c.width <= 0 || c.height <= 0) {
      problems.push({ field: "component", detail: `"${c.name}" has non-positive size ${c.width}x${c.height}` });
    }
    if (c.elements.length === 0) {
      problems.push({
        field: "component",
        detail: `"${c.name}" has no elements — an empty component instantiates as an invisible rectangle nobody can see is missing`,
      });
    }
    for (const el of c.elements) {
      if (el.x < 0 || el.y < 0 || el.x + el.width > c.width || el.y + el.height > c.height) {
        problems.push({
          field: "component",
          detail: `"${c.name}": element "${el.name ?? el.type}" sits outside the component bounds`,
        });
      }
    }
  }
  return problems;
}

/**
 * A stable digest of the SOURCE, for drift reporting (spec 30 §2).
 *
 * Deliberately over the parsed source rather than the file bytes: whitespace
 * and key order in the committed JSON are not design changes, and a digest
 * that moves when someone reformats a file makes the drift report noise. Keys
 * are sorted so the same library always digests the same.
 */
export function sourceDigest(source: LibrarySource): string {
  const canonical = JSON.stringify(source, Object.keys(flatten(source)).sort());
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16);
}

function flatten(v: unknown, out: Record<string, true> = {}): Record<string, true> {
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out[k] = true;
      flatten(x, out);
    }
  }
  return out;
}

/**
 * Compile the library to `.penpot` bytes.
 *
 * Components are registered by building each as a BOARD carrying a
 * `componentId`, then declaring the component against that id — which is the
 * shape Penpot's builder actually accepts (verified by probing: `addComponent`
 * rejects name/path forms and takes `{ componentId, name }`). The board is the
 * main instance; instantiating the component elsewhere references it.
 */
export async function composeLibraryFile(source: LibrarySource): Promise<Uint8Array> {
  const problems = validateLibrary(source);
  if (problems.length > 0) {
    throw new Error(
      `design library "${source.name}" is not publishable:\n` +
        problems.map((p) => `  - ${p.field}: ${p.detail}`).join("\n"),
    );
  }

  const penpot = await import("@penpot/library");
  const ctx = penpot.createBuildContext();
  ctx.addFile({ name: source.name });

  if (source.tokens) {
    const sets = Object.fromEntries(Object.entries(source.tokens).filter(([k]) => !k.startsWith("$")));
    if (Object.keys(sets).length > 0) ctx.addTokensLib(sets);
  }

  for (const c of source.colors ?? []) {
    ctx.addLibraryColor({ name: c.name, color: c.color, ...(c.opacity != null ? { opacity: c.opacity } : {}) });
  }

  for (const t of source.typographies ?? []) {
    ctx.addLibraryTypography({
      name: t.name,
      fontId: t.fontId ?? gfontId(t.fontFamily),
      fontFamily: t.fontFamily,
      fontSize: t.fontSize,
      fontWeight: t.fontWeight ?? "400",
      fontStyle: t.fontStyle ?? "normal",
      ...(t.lineHeight ? { lineHeight: t.lineHeight } : {}),
      ...(t.letterSpacing ? { letterSpacing: t.letterSpacing } : {}),
    });
  }

  if ((source.components ?? []).length > 0) {
    ctx.addPage({ name: "Components" });
    // Laid out in a row with a gutter so a designer opening the library sees
    // them side by side rather than stacked on the origin.
    let x = 0;
    for (const component of source.components ?? []) {
      const componentId = ctx.genId();
      ctx.addBoard({
        name: component.name,
        x,
        y: 0,
        width: component.width,
        height: component.height,
        componentId,
        ...(component.background ? { fills: [component.background] } : {}),
      });
      for (const el of component.elements) addElement(ctx, el, x);
      ctx.closeBoard();
      ctx.addComponent({ componentId, name: component.name });
      x += component.width + COMPONENT_GUTTER;
    }
    ctx.closePage();
  }

  ctx.closeFile();
  return penpot.exportAsBytes(ctx);
}

/** Horizontal gap between component boards on the library page. */
export const COMPONENT_GUTTER = 120;

/**
 * Place one element inside the component board.
 *
 * Shares compose.ts's text-content rule: Penpot renders text from a content
 * TREE, and flat `characters` import but never render. Kept in step here
 * rather than imported, because compose.ts's version is private and a
 * component whose type silently vanishes is worse than a duplicated helper.
 */
function addElement(ctx: BuildContext, el: ComposeElement, dx: number): void {
  const x = el.x + dx;
  switch (el.type) {
    case "rect":
      ctx.addRect({
        name: el.name ?? "rect",
        x,
        y: el.y,
        width: el.width,
        height: el.height,
        ...(el.fills ? { fills: el.fills } : {}),
      });
      break;
    case "text": {
      const style = {
        fontId: el.fontId ?? (el.fontFamily ? gfontId(el.fontFamily) : "sourcesanspro"),
        fontFamily: el.fontFamily ?? "sourcesanspro",
        fontSize: el.fontSize ?? "16",
        fontWeight: el.fontWeight ?? "400",
        fontStyle: el.fontStyle ?? "normal",
        textAlign: el.textAlign ?? "left",
        ...(el.lineHeight ? { lineHeight: el.lineHeight } : {}),
        fills: (el.fills ?? [{ fillColor: "#000000" }]).map((f) => ({ fillOpacity: 1, ...f })),
      };
      ctx.addText({
        name: el.name ?? "text",
        x,
        y: el.y,
        width: el.width,
        height: el.height,
        content: {
          type: "root",
          children: [
            {
              type: "paragraph-set",
              children: el.characters.split("\n").map((line) => ({
                type: "paragraph",
                ...style,
                children: [{ text: line, ...style }],
              })),
            },
          ],
        },
      });
      break;
    }
    case "image": {
      const mediaId = ctx.addFileMedia(
        { name: el.name ?? "image", width: el.width, height: el.height },
        new Blob([el.data as Uint8Array<ArrayBuffer>], { type: el.mediaType }),
      );
      ctx.addRect({
        name: el.name ?? "image",
        x,
        y: el.y,
        width: el.width,
        height: el.height,
        fills: [{ fillImage: ctx.getMediaAsImage(mediaId), fillOpacity: 1 }],
      });
      break;
    }
  }
}
