// Design Surface tools (spec 23 §4 Lane 1) — the agent's file-first compose
// path into the store's Design Studio (managed Penpot). Composing a draft is
// never an Action (spec 23 §2: drafts are free by construction); whatever the
// domain does with an export gates elsewhere.
//
// Conventions mirror brand-soul.ts: createTool + zod, getTenant() for the
// shop, degrade-don't-throw (an unconfigured or unreachable Design Studio
// returns a clear note; it never crashes the turn).

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getTenant } from "../../../lib/tenant-context";
import {
  getDesignSurfaceAdapter,
  isDesignSurfacesConfigured,
  penpotEditUrl,
  NOT_CONFIGURED_NOTE,
} from "../../../lib/design-surfaces/config";
import { getTenantTeam } from "../../../lib/design-surfaces/tenancy";
import { checkComposeFit } from "../../../lib/design-surfaces/compose";
import { createSurface, exportSurface } from "../../../lib/design-surfaces/surface";
import { compileDesignTokens, type DtcgTokensFile } from "../../../lib/design-surfaces/dtcg";
import type { ComposeElement, ComposeSpec, DtcgTokens, ExportFormat } from "../../../lib/design-surfaces/types";
import { getBrandDoc } from "../brand/store";

const PUBLIC_URL = (
  process.env.MOS_AGENTS_PUBLIC_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

const UUID_RE = /^[0-9a-f-]{36}$/i;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Console-relative Design Studio path (spec 23 DS4) — the abstraction seam:
 * the console owns the Studio URL (/studio embeds the canvas next to chat);
 * the raw Penpot editUrl is only the fallback for surfaces without a console. */
export function studioPath(teamId: string, fileId: string, pageId?: string): string {
  const qs = new URLSearchParams({ "team-id": teamId, "file-id": fileId });
  if (pageId) qs.set("page-id", pageId);
  return `/studio?${qs.toString()}`;
}

// ── Brand tokens (DESIGN.md → DTCG, spec 23 §5) ──────────────────────────

/** Solid hex color tokens from the compiled global set's `colors` group —
 * registered as file library colors so they show in the editor's palette. */
function libraryColorsFromTokens(file: DtcgTokensFile): { name: string; color: string }[] {
  const global = file.global;
  if (!global || typeof global !== "object" || Array.isArray(global)) return [];
  const colors = (global as Record<string, unknown>).colors;
  if (!colors || typeof colors !== "object") return [];
  const out: { name: string; color: string }[] = [];
  for (const [name, tok] of Object.entries(colors as Record<string, unknown>)) {
    if (name.startsWith("$")) continue;
    const t = tok as { $type?: string; $value?: unknown } | null;
    if (t?.$type === "color" && typeof t.$value === "string" && t.$value.startsWith("#")) {
      out.push({ name, color: t.$value });
    }
  }
  return out;
}

export interface BrandTokens {
  tokens?: DtcgTokens;
  libraryColors?: { name: string; color: string }[];
  designMdVersion?: number;
}

/** Load + compile the tenant's DESIGN.md tokens. Degrades to {} on any
 * failure (no DESIGN.md, no DB, unparseable front matter) — a surface
 * without brand tokens beats a failed turn. */
export async function loadBrandTokens(shop: string): Promise<BrandTokens> {
  try {
    const doc = await getBrandDoc(shop, "DESIGN.md");
    if (!doc) return {};
    const compiled = compileDesignTokens(doc.content, { compiledAt: new Date().toISOString() });
    const libraryColors = libraryColorsFromTokens(compiled);
    return {
      tokens: compiled as DtcgTokens,
      ...(libraryColors.length ? { libraryColors } : {}),
      designMdVersion: doc.version,
    };
  } catch (e) {
    console.error("[design-surfaces] DESIGN.md tokens skipped:", errMsg(e));
    return {};
  }
}

// ── Element mapping (simplified tool shape → vendored ComposeSpec) ────────

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/**
 * Fetch an image the STORE owns, for placement on a board.
 *
 * The compose lane needs bytes, not a URL — Penpot uploads the media into the
 * file. So this is the one place the tool reaches out to the network, and it is
 * deliberately narrow: https only, a size cap, and an allow-list of raster
 * types. It exists to place a store's own artwork, product shot or room scene;
 * it is not a general fetcher, and nothing about the reference corpus can reach
 * it, because a corpus asset never has a store URL to pass.
 */
async function fetchImageBytes(
  url: string,
): Promise<{ data: Uint8Array; mediaType: (typeof ALLOWED_IMAGE_TYPES)[number] }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`imageUrl is not a URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`imageUrl must be https (got ${parsed.protocol})`);
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`imageUrl fetch failed (${res.status}) for ${url}`);

  const declared = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const mediaType = ALLOWED_IMAGE_TYPES.find((t) => t === declared);
  if (!mediaType) {
    throw new Error(
      `imageUrl must be one of ${ALLOWED_IMAGE_TYPES.join(", ")} — ${url} served "${declared || "nothing"}"`,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `image is ${(buf.byteLength / 1e6).toFixed(1)}MB, over the ${MAX_IMAGE_BYTES / 1e6}MB cap — use a smaller render`,
    );
  }
  if (buf.byteLength === 0) throw new Error(`imageUrl returned an empty body: ${url}`);
  return { data: buf, mediaType };
}

const elementSchema = z.object({
  type: z.enum(["text", "rect", "image"]),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  characters: z.string().optional().describe("Text content (type 'text' only; newlines make paragraphs)"),
  fontFamily: z.string().optional().describe("Google Font family name, e.g. 'Lora' (text only)"),
  fontSize: z.number().optional().describe("Font size in px (text only)"),
  fontWeight: z.number().optional().describe("Font weight, e.g. 400 or 700 (text only)"),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional().describe("(text only)"),
  lineHeight: z.number().optional().describe("Unitless line height, e.g. 1.4 (text only)"),
  color: z.string().optional().describe("Text color as hex, e.g. '#1a1a1a' (text only)"),
  backgroundColor: z.string().optional().describe("Fill color as hex (rect only)"),
  imageUrl: z
    .string()
    .optional()
    .describe(
      "https URL of an image the STORE owns — artwork, product shot, room scene (type 'image' only). " +
        "Fetched server-side and embedded in the file; png/jpeg/webp/gif, 12MB max.",
    ),
});

type ElementInput = z.infer<typeof elementSchema>;

async function toComposeElement(el: ElementInput, i: number): Promise<ComposeElement> {
  const base = { x: el.x, y: el.y, width: el.width, height: el.height };
  if (el.type === "image") {
    if (!el.imageUrl) throw new Error(`element ${i + 1} is type 'image' but has no imageUrl`);
    const { data, mediaType } = await fetchImageBytes(el.imageUrl);
    return { type: "image", name: `image-${i + 1}`, ...base, data, mediaType };
  }
  if (el.type === "text") {
    return {
      type: "text",
      name: `text-${i + 1}`,
      ...base,
      characters: el.characters ?? "",
      ...(el.fontFamily ? { fontFamily: el.fontFamily } : {}),
      ...(el.fontSize != null ? { fontSize: String(el.fontSize) } : {}),
      ...(el.fontWeight != null ? { fontWeight: String(el.fontWeight) } : {}),
      ...(el.lineHeight != null ? { lineHeight: String(el.lineHeight) } : {}),
      ...(el.textAlign ? { textAlign: el.textAlign } : {}),
      // color → fills [{fillColor, fillOpacity: 1}] (unopacified text fills
      // render as default black — see the vendored compose lane).
      ...(el.color ? { fills: [{ fillColor: el.color, fillOpacity: 1 }] } : {}),
    };
  }
  return {
    type: "rect",
    name: `rect-${i + 1}`,
    ...base,
    ...(el.backgroundColor ? { fills: [{ fillColor: el.backgroundColor, fillOpacity: 1 }] } : {}),
  };
}

// ── Tools ─────────────────────────────────────────────────────────────────

export const composeDesignSurface = createTool({
  id: "compose_design_surface",
  description:
    "CREATE an editable draft design in the store's Design Studio (an on-brand design canvas) and return an edit link. " +
    "PREFER this tool whenever the user asks to draft, compose, mock up, or create a specific design deliverable (a social post, ad, banner, promo graphic) — it produces an editable, brand-tokened draft they can refine on the canvas. Use generate_design_candidates only for early visual EXPLORATION (moodboards, diverse directions), not for deliverable drafts. " +
    "Composes a single board (e.g. an Instagram post at 1080x1080) from text, rectangle and IMAGE elements you lay out; the store's DESIGN.md brand tokens (palette, typography) are embedded automatically so the draft opens with the brand system attached. "
    + "For an image element pass type 'image' and imageUrl — an https URL of an image the STORE owns (artwork, product shot, room scene). It is fetched server-side and embedded in the file. A social post about a piece of art needs one of these; a board of only text and rectangles has no artwork in it. " +
    "Layouts are fit-checked before composing: every element must sit fully inside the board, and text must have room to render (text overflows its declared box rather than clipping, so leave height for wrapping — roughly lines × fontSize × 1.2). A layout that overflows is rejected with exact findings; fix the coordinates and retry. " +
    "Drafts are free — creating or iterating on a design never needs approval; publishing/using the export gates elsewhere. " +
    "Returns fileId/pageId plus studioPath — a console-relative link to the embedded Design Studio (canvas beside chat). " +
    "Link the user THERE, e.g. [Open in Studio](/studio?team-id=…&file-id=…); fall back to editUrl (the raw canvas URL) only where console paths don't resolve. " +
    "When the draft is FOR a planned social post, pass kind 'social.post' and boundToId = the post id, then call social_link_design so the post's calendar entry links to the draft. " +
    "Use export_design_surface to render it as an image.",
  inputSchema: z.object({
    kind: z.string().describe("Surface kind, domain-owned and dot-namespaced, e.g. 'social.post', 'ad.creative'"),
    boundToType: z.string().describe("Type of the domain object this design belongs to, e.g. 'post', 'offer'"),
    boundToId: z.string().describe("Id of that domain object (use a slug if none exists yet)"),
    title: z.string().describe("Design file title shown in the Design Studio"),
    board: z
      .object({
        width: z.number().describe("Board width in px, e.g. 1080"),
        height: z.number().describe("Board height in px, e.g. 1080"),
        backgroundColor: z.string().optional().describe("Board background as hex"),
      })
      .optional()
      .describe("Single-board form. Provide this + elements, OR boards — never both."),
    elements: z
      .array(elementSchema)
      .optional()
      .describe("Elements of the single-board form, in paint order (later = on top)"),
    boards: z
      .array(
        z.object({
          name: z.string().describe("Frame name — for a carousel use the slide order, e.g. '1', '2'"),
          width: z.number(),
          height: z.number(),
          backgroundColor: z.string().optional(),
          elements: z.array(elementSchema).describe("Board-RELATIVE coordinates: (0,0) is this board's top-left"),
        }),
      )
      .optional()
      .describe(
        "Multi-board form — an Instagram CAROUSEL (one board per slide), a story set, or format variants. " +
          "Each board carries its own elements in ITS OWN coordinate space, so a slide is laid out as if it were alone. " +
          "Use this whenever a post is more than one frame; a carousel is not three separate designs.",
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    note: z.string().optional(),
    fileId: z.string().optional(),
    pageId: z.string().optional(),
    teamId: z.string().optional(),
    projectId: z.string().optional(),
    studioPath: z
      .string()
      .optional()
      .describe("Console-relative Design Studio link — prefer this when linking the user"),
    editUrl: z.string().optional().describe("Raw canvas URL — fallback only"),
  }),
  execute: async (inputData: {
    kind: string;
    boundToType: string;
    boundToId: string;
    title: string;
    board?: { width: number; height: number; backgroundColor?: string };
    elements?: ElementInput[];
    boards?: {
      name: string;
      width: number;
      height: number;
      backgroundColor?: string;
      elements: ElementInput[];
    }[];
  }) => {
    if (!isDesignSurfacesConfigured()) return { ok: false, note: NOT_CONFIGURED_NOTE };
    const { shop } = getTenant();
    try {
      const home = await getTenantTeam(shop);
      const brand = await loadBrandTokens(shop);

      const toElements = async (els: ElementInput[]) => {
        const out: ComposeElement[] = [];
        for (const [i, el] of els.entries()) {
          try {
            out.push(await toComposeElement(el, i));
          } catch (e) {
            // Name the element that failed. "fetch failed" with no index is
            // unactionable when a board has eight of them.
            throw new Error(`element ${i + 1} (${el.type}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        return out;
      };

      // Exactly one form. Accepting both would leave the caller guessing which
      // one won, and silently dropping half a carousel is the worst way to find
      // out.
      const hasSingle = !!inputData.board;
      const hasMulti = !!inputData.boards?.length;
      if (hasSingle && hasMulti) {
        return { ok: false, note: "Pass either board+elements OR boards, not both." };
      }
      if (!hasSingle && !hasMulti) {
        return { ok: false, note: "Pass board+elements (single frame) or boards (carousel/story set)." };
      }

      const spec: ComposeSpec = {
        fileName: inputData.title,
        ...(hasMulti
          ? {
              boards: await Promise.all(
                inputData.boards!.map(async (b) => ({
                  name: b.name,
                  width: b.width,
                  height: b.height,
                  ...(b.backgroundColor
                    ? { background: { fillColor: b.backgroundColor, fillOpacity: 1 } }
                    : {}),
                  elements: await toElements(b.elements),
                })),
              ),
            }
          : {
              board: {
                name: inputData.title,
                width: inputData.board!.width,
                height: inputData.board!.height,
                ...(inputData.board!.backgroundColor
                  ? { background: { fillColor: inputData.board!.backgroundColor, fillOpacity: 1 } }
                  : {}),
              },
              elements: await toElements(inputData.elements ?? []),
            }),
        ...(brand.tokens ? { tokens: brand.tokens } : {}),
        ...(brand.libraryColors ? { libraryColors: brand.libraryColors } : {}),
      };

      // Fit gate (refinement backlog #1 — the sim's CTA clipped the board's
      // bottom edge): declared-geometry errors AND estimated board-edge text
      // clips both bounce back to the agent with exact findings, which beats
      // shipping a draft that exports clipped. In-board text-box overflow is
      // advisory only — it renders fine, so it rides along on success.
      const fit = checkComposeFit(spec);
      const blocking = [...fit.errors, ...fit.warnings.filter((w) => w.code === "text-board-clip")];
      if (blocking.length > 0) {
        return {
          ok: false,
          note:
            "The layout does not fit the board — adjust the flagged elements and call compose_design_surface again:\n" +
            blocking.map((f) => `- ${f.message}`).join("\n"),
        };
      }
      const fitNote =
        fit.warnings.length > 0
          ? `Fit notes (draft still created): ${fit.warnings.map((f) => f.message).join(" ")}`
          : undefined;

      const adapter = getDesignSurfaceAdapter();
      const { surface } = await createSurface(adapter, {
        tenantId: shop,
        teamId: home.teamId,
        projectId: home.projectId,
        kind: inputData.kind,
        boundTo: { type: inputData.boundToType, id: inputData.boundToId },
        spec,
        brandLineage:
          brand.designMdVersion != null
            ? { designMdVersion: brand.designMdVersion, tokensVersion: brand.designMdVersion }
            : {},
        createdBy: "agent",
      });

      const { fileId, pageId, teamId, projectId } = surface.penpot;
      return {
        ok: true,
        ...(fitNote ? { note: fitNote } : {}),
        fileId,
        pageId,
        teamId,
        projectId,
        studioPath: studioPath(teamId, fileId, pageId),
        editUrl: penpotEditUrl(teamId, fileId, pageId),
      };
    } catch (e) {
      return { ok: false, note: `Design surface composition failed: ${errMsg(e)}` };
    }
  },
});

export const exportDesignSurface = createTool({
  id: "export_design_surface",
  description:
    "Render a Design Studio draft (created via compose_design_surface, or any listed surface) server-side to an image/PDF. " +
    "Returns the artifact's sha256, byte size, and a hosted url that serves the render — show that url to the user (e.g. in a mos-gallery block) so they can see the design in chat. " +
    "Exporting is a read; publishing or using the export in the store gates elsewhere.",
  inputSchema: z.object({
    fileId: z.string().describe("The design file id"),
    pageId: z.string().optional().describe("Page to render (defaults to the file's first page)"),
    format: z.enum(["png", "jpeg", "svg", "pdf"]).optional().describe("Export format (default png)"),
    scale: z.number().optional().describe("Render scale, e.g. 1 or 2 (default 1)"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    note: z.string().optional(),
    sha256: z.string().optional(),
    bytes: z.number().optional(),
    format: z.string().optional(),
    url: z.string().optional().describe("Hosted URL serving this render — embeddable in chat"),
    dataUrl: z.string().optional().describe("Inline base64 preview; omitted when a hosted url is available"),
  }),
  execute: async (inputData: { fileId: string; pageId?: string; format?: "png" | "jpeg" | "svg" | "pdf"; scale?: number }) => {
    if (!isDesignSurfacesConfigured()) return { ok: false, note: NOT_CONFIGURED_NOTE };
    if (!UUID_RE.test(inputData.fileId)) return { ok: false, note: `Invalid fileId "${inputData.fileId}" — expected the uuid returned by compose_design_surface.` };
    try {
      const adapter = getDesignSurfaceAdapter();
      let pageId = inputData.pageId;
      if (!pageId) {
        const structure = await adapter.getFileStructure(inputData.fileId);
        pageId = structure.pages[0]?.id;
        if (!pageId) return { ok: false, note: `Design file ${inputData.fileId} has no pages to export.` };
      }
      const format: ExportFormat = inputData.format ?? "png";
      const scale = inputData.scale ?? 1;
      const artifact = await exportSurface(adapter, { fileId: inputData.fileId, pageId, format, scale });
      // Exports are cheap + stateless: rather than persisting bytes (the
      // brand-image mechanism is candidate-specific), the export route
      // re-renders on GET — same URL-by-id surfacing pattern as
      // /api/brand-image/{id}.
      const url =
        `${PUBLIC_URL}/api/design-surfaces/export/${inputData.fileId}` +
        `?pageId=${pageId}&format=${format}&scale=${scale}`;
      return { ok: true, sha256: artifact.sha256, bytes: artifact.data.length, format, url };
    } catch (e) {
      return { ok: false, note: `Design surface export failed: ${errMsg(e)}` };
    }
  },
});

export const listDesignSurfaces = createTool({
  id: "list_design_surfaces",
  description:
    "List the store's Design Studio draft designs (the tenant's 'Design Surfaces' project) with links. " +
    "Use to find an existing draft before composing a new one, or to hand the owner links to their designs — " +
    "prefer each surface's studioPath (console-relative, opens the embedded Design Studio), falling back to editUrl.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    note: z.string().optional(),
    surfaces: z
      .array(
        z.object({
          fileId: z.string(),
          name: z.string(),
          studioPath: z
            .string()
            .describe("Console-relative Design Studio link — prefer this when linking the user"),
          editUrl: z.string().describe("Raw canvas URL — fallback only"),
        })
      )
      .optional(),
  }),
  execute: async () => {
    if (!isDesignSurfacesConfigured()) return { ok: false, note: NOT_CONFIGURED_NOTE };
    const { shop } = getTenant();
    try {
      const home = await getTenantTeam(shop);
      const files = await getDesignSurfaceAdapter().getProjectFiles(home.projectId);
      return {
        ok: true,
        surfaces: files.map((f) => ({
          fileId: f.id,
          name: f.name,
          studioPath: studioPath(home.teamId, f.id),
          editUrl: penpotEditUrl(home.teamId, f.id),
        })),
      };
    } catch (e) {
      return { ok: false, note: `Listing design surfaces failed: ${errMsg(e)}` };
    }
  },
});

export const designSurfaceTools = {
  compose_design_surface: composeDesignSurface,
  export_design_surface: exportDesignSurface,
  list_design_surfaces: listDesignSurfaces,
};
