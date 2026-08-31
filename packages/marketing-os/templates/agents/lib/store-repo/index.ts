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
 *
 * FAILURE POSTURE DIFFERS BY MODE. In "git", a failed commit fails the write:
 * there is nowhere else for truth to live, so reporting success would be a lie.
 * In "mirror", a failed commit falls back to the database with a loud log —
 * mirror exists to be a safe place to sit during a migration, and a mode more
 * fragile than the "db" it replaces is one nobody would keep enabled. Only when
 * BOTH sides refuse does the caller see an error.
 */

import type { StoreRepo } from "../skill-kit";
import { createGitHubStoreRepo } from "./github";
import { appAuthConfigured, installationTokenFor } from "./app-auth";

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
 * store.
 *
 * The token prefers a GitHub App installation token, minted per repo and
 * expiring hourly, and falls back to GITHUB_TOKEN. That fallback is the
 * self-hosted case: one console, one store, one credential. It is NOT
 * appropriate on the hosted platform, where a shared PAT would make every
 * tenant's artifacts writable with the same secret.
 */
export async function gitBindingFor(tenantRepo?: string | null): Promise<GitBinding | null> {
  const repo = tenantRepo ?? process.env.GITHUB_REPO ?? null;
  if (!repo) return null;

  // Prefer the GitHub App: it mints a token scoped to THIS repo that expires in
  // an hour, so one tenant's credential cannot reach another tenant's store.
  // A shared PAT is proportionate only for a self-hosted console, which serves
  // exactly one store — hence the fallback rather than a hard requirement.
  let token: string | null = null;
  if (appAuthConfigured()) {
    try {
      token = await installationTokenFor(repo);
    } catch (e) {
      // Surface it: falling back to a PAT here would quietly write with the
      // wrong credential, or with none.
      console.error(
        `[store-repo] GitHub App auth failed for ${repo}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  token ??= process.env.GITHUB_TOKEN ?? null;
  if (!token) return null;

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
export async function resolveStoreRepo(
  dbRepo: StoreRepo,
  tenantRepo?: string | null,
): Promise<StoreRepo> {
  const mode = storeRepoMode();
  if (mode === "db") return dbRepo;

  const binding = await gitBindingFor(tenantRepo);
  if (!binding) {
    console.warn(
      `[store-repo] STORE_REPO_MODE="${mode}" but no git binding ` +
        `(need GITHUB_REPO or Tenant.githubRepo, plus a GitHub App installation ` +
        `or GITHUB_TOKEN) — falling back to the database.`,
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
      // Git first — it is truth. But a git failure must NOT take authoring down
      // in mirror mode: the whole point of mirror is a transition that is safe
      // to sit in, and a mode strictly more fragile than "db" is one nobody
      // would leave enabled. The database is still a real store here, and the
      // backfill script reconciles anything git missed.
      //
      // Found the hard way: flipping a store to mirror with a stale
      // GITHUB_TOKEN made every campaign save fail outright. In "git" mode that
      // is correct — there is nowhere else for truth to live. In "mirror" it is
      // just an outage with a fallback sitting right there.
      let gitOk = true;
      try {
        await git.writeFile(path, content);
      } catch (e) {
        gitOk = false;
        console.error(
          `[store-repo] git write FAILED for ${path} — falling back to the database. ` +
            `This artifact is not in the repo; re-run the backfill once git is reachable:`,
          e instanceof Error ? e.message : e,
        );
      }

      try {
        await dbRepo.writeFile(path, content);
      } catch (e) {
        if (gitOk) {
          // Truth landed; the index is stale at worst and the cron sweep fixes
          // it. Do not fail the caller's turn over a mirror.
          console.error(
            `[store-repo] mirrored DB write failed for ${path} (git commit succeeded):`,
            e instanceof Error ? e.message : e,
          );
          return;
        }
        // Neither side took it. Now the caller must hear about it, because
        // reporting a save that went nowhere is the one outcome worse than
        // failing.
        throw new Error(
          `Could not save ${path} to git or the database — nothing was written. ` +
            `Cause: ${e instanceof Error ? e.message : e}`,
        );
      }
    },

    async list(prefix) {
      const [g, d] = await Promise.all([git.list(prefix), dbRepo.list(prefix)]);
      return [...new Set([...g, ...d])].sort();
    },
  };
}
