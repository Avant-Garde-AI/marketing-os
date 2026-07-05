/**
 * Per-request tenant resolution (hosted path, spec 11 §3.1).
 *
 * Two-path invariant: one template tree, hosted behavior is env-driven.
 *  - client-owned (default): the deployment IS the tenant. getTenant() returns
 *    the env-configured store; nothing changes for existing installs.
 *  - hosted (MARKETING_OS_MODE=hosted): one pooled deployment serves every
 *    tenant. Identity is NEVER implied by the deployment — request handlers
 *    resolve the tenant (connector token, proxy handoff, session) and wrap
 *    downstream work in runWithTenant(). Reading the tenant outside a request
 *    context is an error, not a fallback — that's the cross-tenant guardrail.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId?: string;
  /** myshopify domain, e.g. arthaus-website.myshopify.com */
  shop: string;
  /** e.g. arthaus-website — also keys the tenant's Postgres schema */
  storeSlug: string;
}

const als = new AsyncLocalStorage<TenantContext>();

export const HOSTED = process.env.MARKETING_OS_MODE === "hosted";

export function runWithTenant<T>(tenant: TenantContext, fn: () => Promise<T>): Promise<T> {
  return als.run(tenant, fn);
}

function envTenant(): TenantContext {
  const shop = process.env.SHOPIFY_STORE_URL ?? "";
  return {
    shop,
    storeSlug:
      process.env.STORE_SLUG ?? (shop ? shop.replace(/\.myshopify\.com$/, "") : "store"),
  };
}

/**
 * The tenant for the current request. In client-owned mode this is always the
 * env-configured store (request context optional). In hosted mode a missing
 * context is a hard error — never silently default to some tenant.
 */
export function getTenant(): TenantContext {
  const ctx = als.getStore();
  if (ctx) return ctx;
  if (HOSTED) {
    throw new Error(
      "No tenant resolved for this request (hosted mode requires runWithTenant)."
    );
  }
  return envTenant();
}

/** Sanitized schema name for the tenant: tenant_<slug>, [a-z0-9_] only. */
export function tenantSchemaName(slug: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!safe) throw new Error("Cannot derive schema name from empty store slug");
  return `tenant_${safe}`;
}
