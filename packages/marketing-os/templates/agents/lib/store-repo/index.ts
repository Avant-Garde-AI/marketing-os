/**
 * Choosing where a pack's artifacts live — and getting there without a
 * flag day.
 *
 * Three modes, set by STORE_REPO_MODE:
 *
 *   "db"     (default) — today's behaviour exactly. Artifacts in the tenant's
 *                        mos_*_artifacts table. Nothing changes for a store
 *                        that hasn't opted in.
 *   "mirror"           — git is truth, the DB is kept in step. Reads prefer
 *                        git and fall back to the DB, so artifacts written
 *                        before the switch still resolve. Writes go to git
 *                        first, then the DB.
 *   "git"              — git only. The end state.
 *
 * The point of "mirror" is that a store can move one artifact at a time,
 * driven by ordinary use, and roll back by flipping an env var. A cutover that
 * requires every artifact to migrate at once is a cutover nobody schedules.
 *
 * WRITE ORDER IS DELIBERATE: git first, then the DB. If the DB write fails
 * afterwards, truth is still correct and the cron sweep rebuilds the index from
 * it. The reverse order would leave the index claiming an artifact that was
 * never committed — the index lying about truth is the worse failure, and the
 * harder one to notice.
 */

import type { StoreRepo } from "../skill-kit";
import { createGitHubStoreRepo } from "./github";

export type StoreRepoMode = "db" | "mirror" | "git";

export function storeRepoMode(): StoreRepoMode {
  const raw = (process.env.STORE_REPO_MODE ?? "db").toLowerCase();
  return raw === "git" || raw === "mirror" ? raw : "db";
}

export interface GitBinding {
  repo: string;
  token: string;
  branch?: string;
  rootPrefix?: string;
}

/**
 * The git binding for a tenant, or null when this deployment has none.
 *
 * `repo` is per-tenant on the hosted platform (Tenant.githubRepo) and falls
 * back to GITHUB_REPO for a self-hosted console, which serves exactly one
 * store. The token is env-based today; the hosted platform will want a GitHub
 * App installation token per tenant, which is why this is a function and not a
 * constant.
 */
export function gitBindingFor(tenantRepo?: string | null): GitBinding | null {
  const repo = tenantRepo ?? process.env.GITHUB_REPO ?? null;
  const token = process.env.GITHUB_TOKEN ?? null;
  if (!repo || !token) return null;
  return {
    repo,
    token,
    ...(process.env.GITHUB_BRANCH ? { branch: process.env.GITHUB_BRANCH } : {}),
    ...(process.env.STORE_REPO_PREFIX ? { rootPrefix: process.env.STORE_REPO_PREFIX } : {}),
  };
}

/**
 * Wrap a pack's existing DB-backed repo with the configured lane.
 *
 * Callers pass their current binding and get back the one to use, so adopting
 * this is a one-line change at each pack's repo.ts and nothing else moves.
 * Falls back to the DB binding — loudly — when git is selected but unconfigured,
 * because silently writing to a different store than the operator asked for is
 * how artifacts go missing.
 */
export function withStoreRepoMode(dbRepo: StoreRepo, tenantRepo?: string | null): StoreRepo {
  const mode = storeRepoMode();
  if (mode === "db") return dbRepo;

  const binding = gitBindingFor(tenantRepo);
  if (!binding) {
    console.warn(
      `[store-repo] STORE_REPO_MODE="${mode}" but no git binding ` +
        `(need GITHUB_REPO or Tenant.githubRepo, plus GITHUB_TOKEN) — falling back to the database.`,
    );
    return dbRepo;
  }

  const git = createGitHubStoreRepo(binding);
  if (mode === "git") return git;

  // mirror
  return {
    async readFile(path) {
      const fromGit = await git.readFile(path);
      if (fromGit !== null) return fromGit;
      return dbRepo.readFile(path);
    },

    async writeFile(path, content) {
      await git.writeFile(path, content); // truth first
      try {
        await dbRepo.writeFile(path, content);
      } catch (e) {
        // Truth landed; the index is stale at worst and the cron sweep fixes
        // it. Do not fail the caller's turn over a mirror.
        console.error(
          `[store-repo] mirrored DB write failed for ${path} (git commit succeeded):`,
          e instanceof Error ? e.message : e,
        );
      }
    },

    async list(prefix) {
      const [g, d] = await Promise.all([git.list(prefix), dbRepo.list(prefix)]);
      return [...new Set([...g, ...d])].sort();
    },
  };
}
