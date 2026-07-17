// Serves a server-side render of a Design Surface (spec 23 §6) so chat
// galleries and Slack image blocks can show a draft design — the same
// URL-by-unguessable-id surfacing pattern as /api/brand-image/[id], but
// STATELESS: exports are cheap, so the route re-exports on GET instead of
// persisting bytes (the render always reflects the file's current state).
import { NextRequest } from "next/server";
import {
  getDesignSurfaceAdapter,
  isDesignSurfacesConfigured,
} from "@/lib/design-surfaces/config";
import { exportSurface } from "@/lib/design-surfaces/surface";
import type { ExportFormat } from "@/lib/design-surfaces/types";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const CONTENT_TYPES: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params;
  if (!UUID_RE.test(fileId)) return new Response("bad file id", { status: 400 });
  if (!isDesignSurfacesConfigured()) {
    return new Response("design surfaces not configured", { status: 503 });
  }

  const sp = req.nextUrl.searchParams;
  const format = (sp.get("format") ?? "png") as ExportFormat;
  if (!(format in CONTENT_TYPES)) return new Response("bad format", { status: 400 });
  const pageId = sp.get("pageId") ?? undefined;
  if (pageId && !UUID_RE.test(pageId)) return new Response("bad page id", { status: 400 });
  const scaleRaw = Number(sp.get("scale") ?? "1");
  const scale = Number.isFinite(scaleRaw) ? Math.min(Math.max(scaleRaw, 0.1), 4) : 1;
  // Multi-board surfaces (WS2-R1): ?board=<name> renders that board (email
  // sections address boards by slot name); absent → the page's first board.
  const boardName = sp.get("board") ?? undefined;

  try {
    const adapter = getDesignSurfaceAdapter();
    const structure = await adapter.getFileStructure(fileId);
    const page = pageId ? structure.pages.find((p) => p.id === pageId) : structure.pages[0];
    if (!page) return new Response("file has no pages", { status: 404 });
    let objectId: string | undefined;
    if (boardName) {
      const board = page.boards?.find((b) => b.name === boardName);
      if (!board) {
        const available = (page.boards ?? []).map((b) => b.name).join(", ");
        return new Response(`no board "${boardName}" (have: ${available})`, { status: 404 });
      }
      objectId = board.id;
    }
    const artifact = await exportSurface(adapter, {
      fileId,
      pageId: page.id,
      ...(objectId ? { objectId } : {}),
      format,
      scale,
    });
    return new Response(new Uint8Array(artifact.data), {
      headers: {
        "Content-Type": CONTENT_TYPES[format],
        // Short cache only — the underlying design file is editable, and this
        // route always renders its current state.
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (e) {
    console.error("[design-surfaces] export route failed:", e instanceof Error ? e.message : e);
    return new Response("export failed", { status: 502 });
  }
}
