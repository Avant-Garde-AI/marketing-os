/**
 * Shopify session management — stores and retrieves per-shop OAuth tokens.
 *
 * Works in two modes:
 *   1. Supabase-backed (multi-tenant / managed): tokens stored in `shopify_sessions` table
 *   2. Env-var fallback (single-tenant / self-hosted): reads SHOPIFY_ACCESS_TOKEN from env
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";

export interface ShopifySession {
  shop: string;
  accessToken: string;
  scope: string;
  installedAt: string;
}

// ---------------------------------------------------------------------------
// Supabase admin client (service-role — server-side only)
// ---------------------------------------------------------------------------
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
export async function storeShopifySession(
  session: ShopifySession
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error(
      "Supabase service-role credentials are required to store Shopify sessions"
    );
  }

  const { error } = await supabase.from("shopify_sessions").upsert(
    {
      shop: session.shop,
      access_token: session.accessToken,
      scope: session.scope,
      installed_at: session.installedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop" }
  );

  if (error) throw new Error(`Failed to store session: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Read — tries Supabase first, falls back to env vars
// ---------------------------------------------------------------------------
export async function getShopifySession(
  shop: string
): Promise<ShopifySession | null> {
  // 1. Try Supabase
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from("shopify_sessions")
      .select("shop, access_token, scope, installed_at")
      .eq("shop", shop)
      .single();

    if (!error && data) {
      return {
        shop: data.shop,
        accessToken: data.access_token,
        scope: data.scope,
        installedAt: data.installed_at,
      };
    }
  }

  // 2. Fallback to env vars (single-tenant / self-hosted)
  const envShop = process.env.SHOPIFY_STORE_URL;
  const envToken = process.env.SHOPIFY_ACCESS_TOKEN;
  if (envToken && envShop && normalizeShop(envShop) === normalizeShop(shop)) {
    return {
      shop: normalizeShop(shop),
      accessToken: envToken,
      scope: "",
      installedAt: "",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Delete (for uninstall webhook)
// ---------------------------------------------------------------------------
export async function deleteShopifySession(shop: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  await supabase.from("shopify_sessions").delete().eq("shop", shop);
}

// ---------------------------------------------------------------------------
// Token helper — resolves the access token for a shop, used by Mastra tools
// ---------------------------------------------------------------------------
export async function getAccessToken(shop: string): Promise<string | null> {
  const session = await getShopifySession(shop);
  return session?.accessToken ?? null;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
export function normalizeShop(shop: string): string {
  return shop
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/**
 * SQL to create the shopify_sessions table in Supabase:
 *
 * create table if not exists shopify_sessions (
 *   shop text primary key,
 *   access_token text not null,
 *   scope text not null default '',
 *   installed_at timestamptz not null default now(),
 *   updated_at timestamptz not null default now()
 * );
 *
 * -- Enable RLS but only allow service-role access
 * alter table shopify_sessions enable row level security;
 */
