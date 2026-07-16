/**
 * Design Surfaces runtime config (spec 23) — env-driven adapter singleton.
 *
 * Env:
 *   PENPOT_URL              public URI of the managed Penpot instance
 *   PENPOT_ACCESS_TOKEN     platform service-account access token (RPC lane)
 *   PENPOT_SERVICE_EMAIL    service-account email (export lane — the exporter
 *   PENPOT_SERVICE_PASSWORD authenticates by SESSION, not access token)
 *
 * Tools must degrade, never throw, when unconfigured: check
 * isDesignSurfacesConfigured() before calling getDesignSurfaceAdapter().
 */

import { DesignSurfaceAdapter } from "./adapter";

export const NOT_CONFIGURED_NOTE =
  "Design Surfaces is not configured for this deployment (PENPOT_URL / PENPOT_ACCESS_TOKEN missing). " +
  "Design drafts and exports are unavailable until the Design Studio backend is connected.";

export function isDesignSurfacesConfigured(): boolean {
  return Boolean(process.env.PENPOT_URL && process.env.PENPOT_ACCESS_TOKEN);
}

/** True when the session-auth export lane is also configured. */
export function isDesignSurfaceExportConfigured(): boolean {
  return (
    isDesignSurfacesConfigured() &&
    Boolean(process.env.PENPOT_SERVICE_EMAIL && process.env.PENPOT_SERVICE_PASSWORD)
  );
}

/** Public base URL of the Penpot instance, no trailing slash ("" if unset). */
export function penpotUrl(): string {
  return (process.env.PENPOT_URL ?? "").replace(/\/$/, "");
}

/** Workspace deep link into the Design Studio (Penpot editor). */
export function penpotEditUrl(teamId: string, fileId: string, pageId?: string): string {
  const base = `${penpotUrl()}/#/workspace?team-id=${teamId}&file-id=${fileId}`;
  return pageId ? `${base}&page-id=${pageId}` : base;
}

let _adapter: DesignSurfaceAdapter | null = null;

/** Lazily-created singleton adapter. Throws when unconfigured — callers gate
 * on isDesignSurfacesConfigured() first (degrade, don't crash the turn). */
export function getDesignSurfaceAdapter(): DesignSurfaceAdapter {
  if (!isDesignSurfacesConfigured()) {
    throw new Error("Design Surfaces not configured (PENPOT_URL / PENPOT_ACCESS_TOKEN missing)");
  }
  if (!_adapter) {
    const email = process.env.PENPOT_SERVICE_EMAIL;
    const password = process.env.PENPOT_SERVICE_PASSWORD;
    _adapter = new DesignSurfaceAdapter({
      baseUrl: penpotUrl(),
      accessToken: process.env.PENPOT_ACCESS_TOKEN as string,
      ...(email && password ? { serviceAccount: { email, password } } : {}),
    });
  }
  return _adapter;
}
