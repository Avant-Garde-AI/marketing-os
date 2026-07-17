/**
 * Vendored from marketing-os packages/design-surfaces @ 2026-07-17 (multi-board
 * WS2-R1) — replace with @avant-garde/design-surfaces when published.
 * Do not edit here without porting back.
 */
/**
 * Surface operations — the seam consuming packs call (spec 23 §2).
 * Persistence of DesignSurface rows lives in the platform DB
 * (marketing-os-app `mos_design_surfaces`); this package provides the
 * Penpot-side operations and returns everything the row needs.
 */

import { createHash } from "node:crypto";
import { DesignSurfaceAdapter } from "./adapter";
import { composeSurfaceFile } from "./compose";
import type { ComposeSpec, DesignSurface, ExportArtifact, ExportFormat } from "./types";

export interface CreateSurfaceInput {
  tenantId: string;
  teamId: string;
  /** Project that holds this surface kind's files; ensure with adapter.ensureProject. */
  projectId: string;
  kind: string;
  boundTo: { type: string; id: string };
  spec: ComposeSpec;
  brandLineage?: DesignSurface["brandLineage"];
  createdBy?: "agent" | "user";
}

export interface CreatedSurface {
  surface: Omit<DesignSurface, "id">;
  /** The composed .penpot bytes — callers may persist as the initial snapshot. */
  binfile: Uint8Array;
}

/** Lane 1 end-to-end: compose → import → introspect. */
export async function createSurface(
  adapter: DesignSurfaceAdapter,
  input: CreateSurfaceInput,
): Promise<CreatedSurface> {
  const binfile = await composeSurfaceFile(input.spec);
  const fileId = await adapter.importBinfile(input.projectId, input.spec.fileName, binfile);
  const structure = await adapter.getFileStructure(fileId);
  const page = structure.pages[0];
  if (!page) throw new Error(`imported file ${fileId} has no pages`);

  return {
    binfile,
    surface: {
      tenantId: input.tenantId,
      kind: input.kind,
      boundTo: input.boundTo,
      penpot: {
        fileId,
        pageId: page.id,
        teamId: input.teamId,
        projectId: input.projectId,
      },
      brandLineage: input.brandLineage ?? {},
      status: "ready",
      exports: [],
      createdBy: input.createdBy ?? "agent",
    },
  };
}

export interface ExportSurfaceInput {
  fileId: string;
  pageId: string;
  /** Board to render; defaults to the page's first root board. */
  objectId?: string;
  format?: ExportFormat;
  scale?: number;
}

export interface ExportedArtifact extends ExportArtifact {
  data: Uint8Array;
}

/** Read width/height from a PNG's IHDR chunk (big-endian uint32s at fixed
 * offsets 16/20 — IHDR is required to be the first chunk). Returns undefined
 * for anything that isn't a PNG; callers of other formats decode themselves. */
function pngDimensions(data: Uint8Array): { width: number; height: number } | undefined {
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
    return undefined;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function toArtifact(data: Uint8Array, format: ExportFormat, scale: number): ExportedArtifact {
  const dims = format === "png" ? pngDimensions(data) : undefined;
  return {
    format,
    scale,
    // PNG dimensions read from IHDR; other formats stay 0 — callers that
    // need them decode the artifact themselves.
    width: dims?.width ?? 0,
    height: dims?.height ?? 0,
    sha256: createHash("sha256").update(data).digest("hex"),
    data,
  };
}

/** Server-side render of a surface board (spec 23 §6). */
export async function exportSurface(
  adapter: DesignSurfaceAdapter,
  input: ExportSurfaceInput,
): Promise<ExportedArtifact> {
  let objectId = input.objectId;
  if (!objectId) {
    const structure = await adapter.getFileStructure(input.fileId);
    const page = structure.pages.find((p) => p.id === input.pageId) ?? structure.pages[0];
    objectId = page?.boardIds[0];
    if (!objectId) throw new Error(`no board found on file ${input.fileId} page ${input.pageId}`);
  }
  const format = input.format ?? "png";
  const scale = input.scale ?? 1;
  const data = await adapter.client.exportObject({
    fileId: input.fileId,
    pageId: input.pageId,
    objectId,
    type: format,
    scale,
  });
  return toArtifact(data, format, scale);
}

/**
 * Pure selection step of exportSurfaceBoards: resolve the requested board
 * names against a page's boards. Because the result is keyed by NAME, name
 * collisions among the selected boards would silently drop an artifact —
 * so they throw instead (board names are the slot-addressing contract;
 * consuming packs keep them unique). Unknown names throw listing what IS
 * available, so a typo'd slot name fails loud with the fix in the message.
 */
export function selectBoardsByName(
  boards: { id: string; name: string }[],
  names?: string[],
): { id: string; name: string }[] {
  const available = boards.map((b) => b.name);
  const selected = names
    ? names.map((name) => {
        const board = boards.find((b) => b.name === name);
        if (!board) {
          throw new Error(`board "${name}" not found; available boards: ${available.map((n) => `"${n}"`).join(", ")}`);
        }
        return board;
      })
    : boards;
  const seen = new Set<string>();
  for (const b of selected) {
    if (seen.has(b.name)) {
      throw new Error(`duplicate board name "${b.name}" on page — per-name export would drop one; rename the boards`);
    }
    seen.add(b.name);
  }
  return selected;
}

export interface ExportSurfaceBoardsInput {
  fileId: string;
  pageId: string;
  /** Board names to export; omit for every board on the page. Unknown names
   * throw with the available names listed. */
  names?: string[];
  format?: ExportFormat;
  /** Default 1; email visual blocks pass 2 (retina @2x, 04 §2). */
  scale?: number;
}

/**
 * Per-board export of a multi-board surface (WS2-R1): renders each requested
 * board independently and returns artifacts keyed by board NAME — the slot
 * name the consuming pack composed it under (email.campaign boards ARE slots,
 * 04 §2). Boards are enumerated via getFileStructure (names round-trip from
 * compose through import), then rendered one at a time through the same
 * exporter lane as exportSurface — sequentially, deliberately: the exporter
 * is a single browser-render service and a campaign has a handful of boards.
 */
export async function exportSurfaceBoards(
  adapter: DesignSurfaceAdapter,
  input: ExportSurfaceBoardsInput,
): Promise<Record<string, ExportedArtifact>> {
  const structure = await adapter.getFileStructure(input.fileId);
  const page = structure.pages.find((p) => p.id === input.pageId);
  if (!page) throw new Error(`page ${input.pageId} not found on file ${input.fileId}`);
  if (page.boards.length === 0) throw new Error(`no boards on file ${input.fileId} page ${input.pageId}`);

  const targets = selectBoardsByName(page.boards, input.names);
  const format = input.format ?? "png";
  const scale = input.scale ?? 1;

  const out: Record<string, ExportedArtifact> = {};
  for (const board of targets) {
    const data = await adapter.client.exportObject({
      fileId: input.fileId,
      pageId: input.pageId,
      objectId: board.id,
      type: format,
      scale,
    });
    out[board.name] = toArtifact(data, format, scale);
  }
  return out;
}
