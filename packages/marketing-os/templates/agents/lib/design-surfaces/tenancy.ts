/**
 * Tenant → Penpot team resolution (spec 23 §3/§7: tenant = team, owned by the
 * platform service account). Idempotent — provisionTenantTeam and
 * ensureProject both no-op when the team/project already exist — and cached
 * in-process per shop (10-min TTL, same pattern as the brand-context cache).
 */

import { getDesignSurfaceAdapter } from "./config";

/** The project inside each tenant team that holds agent-composed surfaces. */
export const SURFACES_PROJECT_NAME = "Design Surfaces";

export interface TenantDesignHome {
  slug: string;
  teamId: string;
  projectId: string;
}

/** "Arthaus-2.myshopify.com" → "arthaus-2" (strip .myshopify.com, lowercase). */
export function tenantSlug(shop: string): string {
  return shop
    .toLowerCase()
    .replace(/\.myshopify\.com$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: TenantDesignHome }>();

/** Resolve (provisioning if needed) the tenant's team + "Design Surfaces" project. */
export async function getTenantTeam(shop: string): Promise<TenantDesignHome> {
  const hit = cache.get(shop);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const adapter = getDesignSurfaceAdapter();
  const slug = tenantSlug(shop);
  if (!slug) throw new Error(`cannot derive a tenant slug from shop "${shop}"`);
  const team = await adapter.provisionTenantTeam(slug);
  const project = await adapter.ensureProject(team.id, SURFACES_PROJECT_NAME);

  const value: TenantDesignHome = { slug, teamId: team.id, projectId: project.id };
  cache.set(shop, { at: Date.now(), value });
  return value;
}
