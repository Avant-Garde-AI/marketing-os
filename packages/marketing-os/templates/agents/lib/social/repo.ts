/**
 * SocialRepo binding (spec 24 SM0 hosted-runtime enable).
 *
 * CANONICAL LOGIC lives in packages/skills/social-media (vendored beside this
 * file); this module only supplies the storage seam its tools read through.
 *
 * Spec 24 §1 declares files-are-truth-in-the-store-repo (`social/` alongside
 * `agents/brand/`, DB as the rebuildable index). That lane is DEFERRED for
 * v1 — REVISIT at SM1/SM2 when the git write path (dispatch-to-github)
 * carries calendars and posts into the repo. Until then this is DB-backed:
 * `mos_social_artifacts` is a per-tenant keyed store (shop + repo-relative
 * path → markdown content), the same shape the brand doc store uses for its
 * working versions and trivially rebuildable INTO the repo later.
 *
 * Degrade-don't-throw: with no database configured, reads answer "nothing
 * here yet" (null / []) so the console renders its empty states and the
 * agent's tools report "no strategy yet" instead of crashing the turn.
 */

import { Pool } from "pg";
import { getTenant } from "../tenant-context";
import { resolveStoreRepo } from "../store-repo";
import type { SocialRepo } from "./types";

let _pool: Pool | null = null;

/** Shared small pool; null when no database is configured. */
function pool(): Pool | null {
  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) return null;
  if (!_pool) _pool = new Pool({ connectionString: cs, max: 3 });
  return _pool;
}

let _inited = false;
async function ensureTable(p: Pool): Promise<void> {
  if (_inited) return;
  await p.query(
    `CREATE TABLE IF NOT EXISTS mos_social_artifacts (
       shop text NOT NULL,
       path text NOT NULL,
       content text NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (shop, path)
     )`
  );
  _inited = true;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Read one artifact (repo-relative path, e.g. "social/strategy.md"). */
export async function readSocialFile(shop: string, path: string): Promise<string | null> {
  const p = pool();
  if (!p) return null;
  try {
    await ensureTable(p);
    const r = await p.query(
      `SELECT content FROM mos_social_artifacts WHERE shop = $1 AND path = $2`,
      [shop, path]
    );
    return r.rows[0]?.content ?? null;
  } catch (e) {
    console.error("[social] read failed (degrading to empty):", errMsg(e));
    return null;
  }
}

/** Upsert one artifact. Unused by the SM0 read tools; the seam SM1+ writes through. */
export async function writeSocialFile(shop: string, path: string, content: string): Promise<void> {
  const p = pool();
  if (!p) {
    throw new Error(
      "Social artifacts need a database (SUPABASE_DATABASE_URL) — nothing was saved."
    );
  }
  await ensureTable(p);
  await p.query(
    `INSERT INTO mos_social_artifacts (shop, path, content, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (shop, path) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [shop, path, content]
  );
}

/** List artifact paths under a prefix (e.g. "social/calendar/"). */
export async function listSocialFiles(shop: string, prefix: string): Promise<string[]> {
  const p = pool();
  if (!p) return [];
  try {
    await ensureTable(p);
    const r = await p.query(
      `SELECT path FROM mos_social_artifacts WHERE shop = $1 AND path LIKE $2 ORDER BY path`,
      [shop, prefix.replace(/[%_]/g, "\\$&") + "%"]
    );
    return r.rows.map((row: { path: string }) => row.path);
  } catch (e) {
    console.error("[social] list failed (degrading to empty):", errMsg(e));
    return [];
  }
}

/**
 * The tenant-bound SocialRepo the agent tools read through. The shop resolves
 * per call via getTenant() — inside a request this is the resolved tenant
 * (hosted: runWithTenant; client-owned: the env-configured store), the same
 * pattern the design-surface tools use.
 */
const dbBackedSocialRepo: SocialRepo = {
  readFile: (path) => readSocialFile(getTenant().shop, path),
  writeFile: (path, content) => writeSocialFile(getTenant().shop, path, content),
  list: (prefix) => listSocialFiles(getTenant().shop, prefix),
};

/**
 * The lane is chosen per call, not at module load: STORE_REPO_MODE and the
 * tenant's repo are request-scoped on the hosted platform, and a binding frozen
 * at import would pin every tenant to whichever one warmed the lambda.
 * resolveStoreRepo() returns dbBackedSocialRepo unchanged in the default "db"
 * mode, so this costs nothing until a store opts in.
 *
 * READ THROUGH THIS, not the free functions below. readSocialFile/
 * listSocialFiles talk to the database directly and know nothing about the
 * lane — once a store's artifacts live in git, anything still calling them
 * sees an empty store and, because they degrade rather than throw, says so
 * silently. (That is exactly how the console came to read email campaigns from
 * the social artifact table for months.) The free functions remain for the
 * backfill script and for callers that must address a shop explicitly.
 */
export const socialRepo: SocialRepo = {
  readFile: async (path) => (await resolveStoreRepo(dbBackedSocialRepo, getTenant().githubRepo)).readFile(path),
  writeFile: async (path, content) =>
    (await resolveStoreRepo(dbBackedSocialRepo, getTenant().githubRepo)).writeFile(path, content),
  list: async (prefix) => (await resolveStoreRepo(dbBackedSocialRepo, getTenant().githubRepo)).list(prefix),
};
