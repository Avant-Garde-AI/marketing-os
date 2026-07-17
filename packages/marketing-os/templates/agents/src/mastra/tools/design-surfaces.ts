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
function studioPath(teamId: string, fileId: string, pageId?: string): string {
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

interface BrandTokens {
  tokens?: DtcgTokens;
  libraryColors?: { name: string; color: string }[];
  designMdVersion?: number;
}

/** Load + compile the tenant's DESIGN.md tokens. Degrades to {} on any
 * failure (no DESIGN.md, no DB, unparseable front matter) — a surface
 * without brand tokens beats a failed turn. */
async function loadBrandTokens(shop: string): Promise<BrandTokens> {
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

const elementSchema = z.object({
  type: z.enum(["text", "rect"]),
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
});

type ElementInput = z.infer<typeof elementSchema>;

function toComposeElement(el: ElementInput, i: number): ComposeElement {
  const base = { x: el.x, y: el.y, width: el.width, height: el.height };
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
    "Composes a single board (e.g. an Instagram post at 1080x1080) from text and rectangle elements you lay out; the store's DESIGN.md brand tokens (palette, typography) are embedded automatically so the draft opens with the brand system attached. " +
    "Drafts are free — creating or iterating on a design never needs approval; publishing/using the export gates elsewhere. " +
    "Returns fileId/pageId plus studioPath — a console-relative link to the embedded Design Studio (canvas beside chat). " +
    "Link the user THERE, e.g. [Open in Studio](/studio?team-id=…&file-id=…); fall back to editUrl (the raw canvas URL) only where console paths don't resolve. " +
    "Use export_design_surface to render it as an image.",
  inputSchema: z.object({
    kind: z.string().describe("Surface kind, domain-owned and dot-namespaced, e.g. 'social.post', 'ad.creative'"),
    boundToType: z.string().describe("Type of the domain object this design belongs to, e.g. 'post', 'offer'"),
    boundToId: z.string().describe("Id of that domain object (use a slug if none exists yet)"),
    title: z.string().describe("Design file title shown in the Design Studio"),
    board: z.object({
      width: z.number().describe("Board width in px, e.g. 1080"),
      height: z.number().describe("Board height in px, e.g. 1080"),
      backgroundColor: z.string().optional().describe("Board background as hex"),
    }),
    elements: z.array(elementSchema).describe("Elements placed on the board, in paint order (later = on top)"),
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
    board: { width: number; height: number; backgroundColor?: string };
    elements: ElementInput[];
  }) => {
    if (!isDesignSurfacesConfigured()) return { ok: false, note: NOT_CONFIGURED_NOTE };
    const { shop } = getTenant();
    try {
      const home = await getTenantTeam(shop);
      const brand = await loadBrandTokens(shop);

      const spec: ComposeSpec = {
        fileName: inputData.title,
        board: {
          name: inputData.title,
          width: inputData.board.width,
          height: inputData.board.height,
          ...(inputData.board.backgroundColor
            ? { background: { fillColor: inputData.board.backgroundColor, fillOpacity: 1 } }
            : {}),
        },
        elements: inputData.elements.map(toComposeElement),
        ...(brand.tokens ? { tokens: brand.tokens } : {}),
        ...(brand.libraryColors ? { libraryColors: brand.libraryColors } : {}),
      };

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
