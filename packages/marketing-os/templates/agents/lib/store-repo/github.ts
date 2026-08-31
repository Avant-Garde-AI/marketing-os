/**
 * The git binding for StoreRepo — artifacts live in the store's GitHub repo.
 *
 * This is the lane lib/email/repo.ts and lib/social/repo.ts have been deferring
 * since v1 ("REVISIT when the git write path carries strategies/calendars/
 * campaigns into the repo"). The seam was always shaped for it: skill-kit's
 * StoreRepo doc comment names "GitHub contents API" as the intended hosted
 * binding. Nothing above this file changes — packs keep calling
 * readFile/writeFile/list.
 *
 * WHY IT MATTERS BEYOND DOCTRINE
 *   While artifacts live in a database, that database holds truth, so choosing
 *   where a deployment stores things is a decision with lock-in — and moving a
 *   store between a self-hosted console and the hosted platform is a data
 *   migration. With artifacts in the repo, every deployment's database is a
 *   rebuildable index: the email cron already reconstructs the projections from
 *   artifacts on every sweep. Migration becomes "point it at the repo and let
 *   the sweep run".
 *   It also makes the artifacts reviewable by humans, diffable, and revertible
 *   — which is the actual reason a marketing team should want them in git.
 *
 * WHAT THIS IS NOT: a general filesystem. The contents API is one HTTP call per
 * file, rate-limited, and eventually consistent right after a write. It suits
 * artifacts — a handful of small markdown documents per campaign, written by a
 * human-paced agent. It would be the wrong choice for anything hot.
 */

import type { StoreRepo } from "../skill-kit";

export interface GitHubStoreRepoOptions {
  /** "owner/name". Per-tenant on the hosted platform (Tenant.githubRepo). */
  repo: string;
  /** Token with contents:write on `repo`. */
  token: string;
  /** Defaults to the repository's default branch. */
  branch?: string;
  /** Prefix every path with this (e.g. "agents" when the store lives in a subdir). */
  rootPrefix?: string;
  /** Commit author shown in the repo's history. */
  committer?: { name: string; email: string };
  /** Seconds to cache reads. 0 disables. Writes always invalidate their path. */
  cacheTtlSeconds?: number;
}

const API = "https://api.github.com";

interface CacheEntry {
  content: string | null;
  sha: string | undefined;
  at: number;
}

function joinPath(prefix: string | undefined, path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (!prefix) return clean;
  return `${prefix.replace(/\/+$/, "")}/${clean}`;
}

/**
 * Reject paths that would escape the store root. The agent chooses these
 * strings, so treat them as untrusted input even though the agent is ours —
 * a campaign id that walks up the tree would write anywhere in the repo.
 */
function assertSafePath(path: string): void {
  if (path.includes("..") || path.startsWith("/") || /[\0\r\n]/.test(path)) {
    throw new Error(`unsafe repo path: ${JSON.stringify(path)}`);
  }
}

export function createGitHubStoreRepo(opts: GitHubStoreRepoOptions): StoreRepo {
  const { repo, token, branch, rootPrefix } = opts;
  const ttlMs = (opts.cacheTtlSeconds ?? 20) * 1000;
  const cache = new Map<string, CacheEntry>();

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  async function gh(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
    if (res.status === 401 || res.status === 403) {
      // Distinguish "no permission" from "not found": a 403 that reads as an
      // empty repo would silently look like a store with no artifacts.
      const remaining = res.headers.get("x-ratelimit-remaining");
      throw new Error(
        remaining === "0"
          ? `GitHub rate limit exhausted for ${repo}`
          : `GitHub denied access to ${repo} (${res.status}) — check the token's contents scope`,
      );
    }
    return res;
  }

  /** Fetch a file's content + blob sha. Returns nulls when absent. */
  async function fetchFile(fullPath: string): Promise<CacheEntry> {
    const url = new URL(`${API}/repos/${repo}/contents/${encodeURI(fullPath)}`);
    if (branch) url.searchParams.set("ref", branch);
    const res = await gh(url.toString());
    if (res.status === 404) return { content: null, sha: undefined, at: Date.now() };
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}) for ${fullPath}`);
    const json = (await res.json()) as { content?: string; sha?: string; encoding?: string; type?: string };
    if (json.type !== "file" || typeof json.content !== "string") {
      return { content: null, sha: json.sha, at: Date.now() };
    }
    // The contents API returns base64 with embedded newlines.
    const content = Buffer.from(json.content.replace(/\n/g, ""), "base64").toString("utf-8");
    return { content, sha: json.sha, at: Date.now() };
  }

  async function cachedFile(fullPath: string): Promise<CacheEntry> {
    const hit = cache.get(fullPath);
    if (hit && ttlMs > 0 && Date.now() - hit.at < ttlMs) return hit;
    const fresh = await fetchFile(fullPath);
    cache.set(fullPath, fresh);
    return fresh;
  }

  return {
    async readFile(path: string): Promise<string | null> {
      assertSafePath(path);
      return (await cachedFile(joinPath(rootPrefix, path))).content;
    },

    async writeFile(path: string, content: string): Promise<void> {
      assertSafePath(path);
      const fullPath = joinPath(rootPrefix, path);

      // The sha must be the CURRENT one or GitHub rejects the write, so read
      // through rather than trusting a cached sha — a stale sha turns a normal
      // update into a 409 the caller can do nothing about.
      const existing = await fetchFile(fullPath);
      if (existing.content === content) {
        // Identical content would still create an empty commit; skip it so the
        // history stays a record of actual changes.
        cache.set(fullPath, existing);
        return;
      }

      const verb = existing.sha ? "update" : "add";
      const body: Record<string, unknown> = {
        message: `chore(store): ${verb} ${path}`,
        content: Buffer.from(content, "utf-8").toString("base64"),
        ...(existing.sha ? { sha: existing.sha } : {}),
        ...(branch ? { branch } : {}),
        ...(opts.committer ? { committer: opts.committer } : {}),
      };

      const res = await gh(`${API}/repos/${repo}/contents/${encodeURI(fullPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`GitHub write failed (${res.status}) for ${fullPath}: ${await res.text()}`);
      }
      const json = (await res.json()) as { content?: { sha?: string } };
      cache.set(fullPath, { content, sha: json.content?.sha, at: Date.now() });
    },

    async list(prefix: string): Promise<string[]> {
      assertSafePath(prefix);
      const full = joinPath(rootPrefix, prefix);

      // The trees API returns the whole tree in ONE call. Walking `contents/`
      // directory by directory would be a request per level, and campaigns nest
      // (email/campaigns/{id}/campaign.md) — that is a request per campaign.
      const ref = branch ?? "HEAD";
      const url = `${API}/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
      const res = await gh(url);
      if (res.status === 404) return []; // empty repo or unknown ref
      if (!res.ok) throw new Error(`GitHub tree read failed (${res.status}) for ${repo}`);
      const json = (await res.json()) as {
        tree?: Array<{ path?: string; type?: string }>;
        truncated?: boolean;
      };
      if (json.truncated) {
        // Say so rather than silently returning a partial store — a short list
        // reads exactly like a store with fewer artifacts.
        console.warn(
          `[store-repo] ${repo} tree truncated by GitHub; list("${prefix}") may be incomplete`,
        );
      }
      const strip = rootPrefix ? `${rootPrefix.replace(/\/+$/, "")}/` : "";
      return (json.tree ?? [])
        .filter((n) => n.type === "blob" && typeof n.path === "string" && n.path.startsWith(full))
        .map((n) => (strip && n.path!.startsWith(strip) ? n.path!.slice(strip.length) : n.path!))
        .sort();
    },
  };
}
