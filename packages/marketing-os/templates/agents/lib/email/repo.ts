/**
 * EmailRepo binding (email-campaign WS1-R3 hosted-runtime enable).
 *
 * CANONICAL LOGIC lives in packages/skills/email-campaign (vendored beside
 * this file); this module only supplies the storage seam its tools read
 * through — the exact mirror of lib/social/repo.ts.
 *
 * Spec 22 D1 declares files-are-truth-in-the-store-repo (`email/` alongside
 * `agents/brand/` and `social/`, DB as the rebuildable index). That lane is
 * DEFERRED for v1 — REVISIT when the git write path (dispatch-to-github)
 * carries strategies/calendars/campaigns into the repo. Until then this is
 * DB-backed: `mos_email_artifacts` is a per-tenant keyed store (shop +
 * repo-relative path → markdown content), the same shape mos_social_artifacts
 * uses and trivially rebuildable INTO the repo later.
 *
 * Degrade-don't-throw: with no database configured, reads answer "nothing
 * here yet" (null / []) so the console renders its empty states and the
 * agent's tools report "no strategy yet" instead of crashing the turn.
 */

import { Pool } from "pg";
import { getTenant } from "../tenant-context";
import type { EmailRepo } from "./types";

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
    `CREATE TABLE IF NOT EXISTS mos_email_artifacts (
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

/** Read one artifact (repo-relative path, e.g. "email/strategy.md"). */
export async function readEmailFile(shop: string, path: string): Promise<string | null> {
  const p = pool();
  if (!p) return null;
  try {
    await ensureTable(p);
    const r = await p.query(
      `SELECT content FROM mos_email_artifacts WHERE shop = $1 AND path = $2`,
      [shop, path]
    );
    return r.rows[0]?.content ?? null;
  } catch (e) {
    console.error("[email] read failed (degrading to empty):", errMsg(e));
    return null;
  }
}

/** Upsert one artifact. Unused by the read tools; the seam WS3's Actions write through. */
export async function writeEmailFile(shop: string, path: string, content: string): Promise<void> {
  const p = pool();
  if (!p) {
    throw new Error(
      "Email artifacts need a database (SUPABASE_DATABASE_URL) — nothing was saved."
    );
  }
  await ensureTable(p);
  await p.query(
    `INSERT INTO mos_email_artifacts (shop, path, content, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (shop, path) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [shop, path, content]
  );
}

/** List artifact paths under a prefix (e.g. "email/calendar/"). */
export async function listEmailFiles(shop: string, prefix: string): Promise<string[]> {
  const p = pool();
  if (!p) return [];
  try {
    await ensureTable(p);
    const r = await p.query(
      `SELECT path FROM mos_email_artifacts WHERE shop = $1 AND path LIKE $2 ORDER BY path`,
      [shop, prefix.replace(/[%_]/g, "\\$&") + "%"]
    );
    return r.rows.map((row: { path: string }) => row.path);
  } catch (e) {
    console.error("[email] list failed (degrading to empty):", errMsg(e));
    return [];
  }
}

/**
 * The tenant-bound EmailRepo the agent tools read through. The shop resolves
 * per call via getTenant() — inside a request this is the resolved tenant
 * (hosted: runWithTenant; client-owned: the env-configured store), the same
 * pattern the social + design-surface tools use.
 */
export const emailRepo: EmailRepo = {
  readFile: (path) => readEmailFile(getTenant().shop, path),
  writeFile: (path, content) => writeEmailFile(getTenant().shop, path, content),
  list: (prefix) => listEmailFiles(getTenant().shop, prefix),
};
