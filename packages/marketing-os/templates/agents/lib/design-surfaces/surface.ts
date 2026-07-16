/**
 * Vendored from marketing-os packages/design-surfaces @ 2026-07-16 — npm
 * publish blocked (no auth); replace with @avant-garde/design-surfaces when
 * published. Do not edit here without porting back.
 *
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
  return {
    format,
    scale,
    width: 0, // dimensions read back by callers that need them (image decode)
    height: 0,
    sha256: createHash("sha256").update(data).digest("hex"),
    data,
  };
}
