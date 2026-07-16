/**
 * Vendored from marketing-os packages/design-surfaces @ 2026-07-16 — npm
 * publish blocked (no auth); replace with @avant-garde/design-surfaces when
 * published. Do not edit here without porting back.
 *
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

import type { ComposeSpec } from "./types";

type PenpotLibrary = typeof import("@penpot/library");

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

/** Compose a single-board .penpot document; returns the binfile-v3 zip bytes. */
export async function composeSurfaceFile(spec: ComposeSpec): Promise<Uint8Array> {
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

  ctx.addBoard({
    name: spec.board.name,
    x: 0,
    y: 0,
    width: spec.board.width,
    height: spec.board.height,
    ...(spec.board.background ? { fills: [spec.board.background] } : {}),
  });

  for (const el of spec.elements) {
    switch (el.type) {
      case "rect":
        ctx.addRect({
          name: el.name ?? "rect",
          x: el.x,
          y: el.y,
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
          x: el.x,
          y: el.y,
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
          // Cast added while vendoring: this repo's TS 5.7 lib types BlobPart
          // as ArrayBufferView<ArrayBuffer>, rejecting Uint8Array<ArrayBufferLike>.
          new Blob([el.data as Uint8Array<ArrayBuffer>], { type: el.mediaType }),
        );
        const imageFill = ctx.getMediaAsImage(mediaId);
        ctx.addRect({
          name: el.name ?? "image",
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          fills: [{ fillImage: imageFill, fillOpacity: 1 }],
        });
        break;
      }
    }
  }

  ctx.closeBoard();
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
