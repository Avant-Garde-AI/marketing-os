/**
 * GitHub connection storage — associates a GitHub account with a Shopify shop.
 * Stored in Supabase `github_connections` table.
 *
 * SQL:
 *   create table if not exists github_connections (
 *     shop text primary key references shopify_sessions(shop),
 *     github_token text not null,
 *     github_user text not null,
 *     scope text not null default '',
 *     repo_full_name text,
 *     connected_at timestamptz not null default now(),
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table github_connections enable row level security;
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";

export interface GitHubConnection {
  shop: string;
  githubToken: string;
  githubUser: string;
  scope: string;
  repoFullName?: string;
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

export async function storeGitHubConnection(
  conn: GitHubConnection
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Supabase credentials required to store GitHub connection");
  }

  const { error } = await supabase.from("github_connections").upsert(
    {
      shop: conn.shop,
      github_token: conn.githubToken,
      github_user: conn.githubUser,
      scope: conn.scope,
      repo_full_name: conn.repoFullName ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop" }
  );

  if (error) throw new Error(`Failed to store GitHub connection: ${error.message}`);
}

export async function getGitHubConnection(
  shop: string
): Promise<GitHubConnection | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("github_connections")
    .select("shop, github_token, github_user, scope, repo_full_name")
    .eq("shop", shop)
    .single();

  if (error || !data) return null;

  return {
    shop: data.shop,
    githubToken: data.github_token,
    githubUser: data.github_user,
    scope: data.scope,
    repoFullName: data.repo_full_name ?? undefined,
  };
}

export async function updateRepoName(
  shop: string,
  repoFullName: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  await supabase
    .from("github_connections")
    .update({ repo_full_name: repoFullName, updated_at: new Date().toISOString() })
    .eq("shop", shop);
}
