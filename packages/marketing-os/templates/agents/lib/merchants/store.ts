/**
 * Merchant management — central record for each installed merchant.
 * Used by the cross-merchant admin dashboard.
 *
 * SQL:
 *   create table if not exists merchants (
 *     shop text primary key,
 *     store_name text not null,
 *     plan text not null default 'free',
 *     status text not null default 'onboarding',
 *     shopify_scopes text not null default '',
 *     github_user text,
 *     github_repo text,
 *     anthropic_workspace_id text,
 *     anthropic_key_id text,
 *     anthropic_key_hint text,
 *     agent_runs_this_month integer not null default 0,
 *     agent_runs_total integer not null default 0,
 *     installed_at timestamptz not null default now(),
 *     onboarded_at timestamptz,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table merchants enable row level security;
 *
 *   -- Index for admin dashboard queries
 *   create index idx_merchants_status on merchants(status);
 *   create index idx_merchants_plan on merchants(plan);
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";

export type MerchantPlan = "free" | "starter" | "pro" | "agency";
export type MerchantStatus = "onboarding" | "active" | "paused" | "uninstalled";

export interface Merchant {
  shop: string;
  storeName: string;
  plan: MerchantPlan;
  status: MerchantStatus;
  shopifyScopes: string;
  githubUser: string | null;
  githubRepo: string | null;
  anthropicWorkspaceId: string | null;
  anthropicKeyId: string | null;
  anthropicKeyHint: string | null;
  agentRunsThisMonth: number;
  agentRunsTotal: number;
  installedAt: string;
  onboardedAt: string | null;
  updatedAt: string;
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createMerchant(
  merchant: Pick<Merchant, "shop" | "storeName" | "shopifyScopes">
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase required");

  const { error } = await supabase.from("merchants").upsert(
    {
      shop: merchant.shop,
      store_name: merchant.storeName,
      shopify_scopes: merchant.shopifyScopes,
      status: "onboarding",
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop" }
  );

  if (error) throw new Error(`Failed to create merchant: ${error.message}`);
}

export async function getMerchant(shop: string): Promise<Merchant | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("merchants")
    .select("*")
    .eq("shop", shop)
    .single();

  if (error || !data) return null;
  return mapRow(data);
}

export async function updateMerchant(
  shop: string,
  updates: Partial<{
    plan: MerchantPlan;
    status: MerchantStatus;
    githubUser: string;
    githubRepo: string;
    anthropicWorkspaceId: string;
    anthropicKeyId: string;
    anthropicKeyHint: string;
    onboardedAt: string;
  }>
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.plan !== undefined) row.plan = updates.plan;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.githubUser !== undefined) row.github_user = updates.githubUser;
  if (updates.githubRepo !== undefined) row.github_repo = updates.githubRepo;
  if (updates.anthropicWorkspaceId !== undefined) row.anthropic_workspace_id = updates.anthropicWorkspaceId;
  if (updates.anthropicKeyId !== undefined) row.anthropic_key_id = updates.anthropicKeyId;
  if (updates.anthropicKeyHint !== undefined) row.anthropic_key_hint = updates.anthropicKeyHint;
  if (updates.onboardedAt !== undefined) row.onboarded_at = updates.onboardedAt;

  await supabase.from("merchants").update(row).eq("shop", shop);
}

export async function incrementAgentRuns(shop: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  await supabase.rpc("increment_agent_runs", { shop_domain: shop });
}

// ---------------------------------------------------------------------------
// Admin queries
// ---------------------------------------------------------------------------

export async function listMerchants(filters?: {
  status?: MerchantStatus;
  plan?: MerchantPlan;
  limit?: number;
  offset?: number;
}): Promise<{ merchants: Merchant[]; total: number }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { merchants: [], total: 0 };

  let query = supabase.from("merchants").select("*", { count: "exact" });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.plan) query = query.eq("plan", filters.plan);
  query = query
    .order("installed_at", { ascending: false })
    .range(
      filters?.offset ?? 0,
      (filters?.offset ?? 0) + (filters?.limit ?? 50) - 1
    );

  const { data, count, error } = await query;
  if (error) throw new Error(`Failed to list merchants: ${error.message}`);

  return {
    merchants: (data ?? []).map(mapRow),
    total: count ?? 0,
  };
}

export async function getMerchantStats(): Promise<{
  total: number;
  active: number;
  onboarding: number;
  totalAgentRuns: number;
}> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { total: 0, active: 0, onboarding: 0, totalAgentRuns: 0 };

  const [totalRes, activeRes, onboardingRes, runsRes] = await Promise.all([
    supabase.from("merchants").select("*", { count: "exact", head: true }),
    supabase.from("merchants").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("merchants").select("*", { count: "exact", head: true }).eq("status", "onboarding"),
    supabase.from("merchants").select("agent_runs_total").not("agent_runs_total", "is", null),
  ]);

  const totalRuns = (runsRes.data ?? []).reduce(
    (sum: number, r: any) => sum + (r.agent_runs_total ?? 0),
    0
  );

  return {
    total: totalRes.count ?? 0,
    active: activeRes.count ?? 0,
    onboarding: onboardingRes.count ?? 0,
    totalAgentRuns: totalRuns,
  };
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapRow(row: any): Merchant {
  return {
    shop: row.shop,
    storeName: row.store_name,
    plan: row.plan,
    status: row.status,
    shopifyScopes: row.shopify_scopes,
    githubUser: row.github_user,
    githubRepo: row.github_repo,
    anthropicWorkspaceId: row.anthropic_workspace_id,
    anthropicKeyId: row.anthropic_key_id,
    anthropicKeyHint: row.anthropic_key_hint,
    agentRunsThisMonth: row.agent_runs_this_month,
    agentRunsTotal: row.agent_runs_total,
    installedAt: row.installed_at,
    onboardedAt: row.onboarded_at,
    updatedAt: row.updated_at,
  };
}
