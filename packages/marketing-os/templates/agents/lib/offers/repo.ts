/**
 * OfferRepo binding (spec 32 D6/OF2) — the exact mirror of lib/email/repo.ts.
 *
 * Spec 32 D6: "Instrumentation mirrors the email agent exactly, not a new
 * design." Same `STORE_REPO_MODE` seam (db/mirror/git — lib/store-repo/index.ts),
 * same DB-backed fallback table shape (`mos_offer_artifacts`, the
 * `mos_email_artifacts` shape verbatim), same degrade-don't-throw reads.
 *
 * With no database configured, reads answer "nothing here yet" (null / [])
 * so the console renders its empty states and the agent's tools report "no
 * strategy yet" instead of crashing the turn.
 */

import { Pool } from "pg";
import { getTenant } from "../tenant-context";
import { resolveStoreRepo } from "../store-repo";
import type { OfferRepo } from "./types";

let _pool: Pool | null = null;

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
    `CREATE TABLE IF NOT EXISTS mos_offer_artifacts (
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

/** Read one artifact (repo-relative path, e.g. "offers/strategy.md"). */
export async function readOfferFile(shop: string, path: string): Promise<string | null> {
  const p = pool();
  if (!p) return null;
  try {
    await ensureTable(p);
    const r = await p.query(
      `SELECT content FROM mos_offer_artifacts WHERE shop = $1 AND path = $2`,
      [shop, path]
    );
    return r.rows[0]?.content ?? null;
  } catch (e) {
    console.error("[offers] read failed (degrading to empty):", errMsg(e));
    return null;
  }
}

/** Upsert one artifact. Written by the offer Actions' execute(). */
export async function writeOfferFile(shop: string, path: string, content: string): Promise<void> {
  const p = pool();
  if (!p) {
    throw new Error(
      "Offer artifacts need a database (SUPABASE_DATABASE_URL) — nothing was saved."
    );
  }
  await ensureTable(p);
  await p.query(
    `INSERT INTO mos_offer_artifacts (shop, path, content, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (shop, path) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [shop, path, content]
  );
}

/** List artifact paths under a prefix (e.g. "offers/"). */
export async function listOfferFiles(shop: string, prefix: string): Promise<string[]> {
  const p = pool();
  if (!p) return [];
  try {
    await ensureTable(p);
    const r = await p.query(
      `SELECT path FROM mos_offer_artifacts WHERE shop = $1 AND path LIKE $2 ORDER BY path`,
      [shop, prefix.replace(/[%_]/g, "\\$&") + "%"]
    );
    return r.rows.map((row: { path: string }) => row.path);
  } catch (e) {
    console.error("[offers] list failed (degrading to empty):", errMsg(e));
    return [];
  }
}

const dbBackedOfferRepo: OfferRepo = {
  readFile: (path) => readOfferFile(getTenant().shop, path),
  writeFile: (path, content) => writeOfferFile(getTenant().shop, path, content),
  list: (prefix) => listOfferFiles(getTenant().shop, prefix),
};

/**
 * The lane is chosen per call, not at module load — see lib/email/repo.ts's
 * comment on why. resolveStoreRepo() returns dbBackedOfferRepo unchanged in
 * the default "db" mode, so this costs nothing until a store opts in.
 */
export const offerRepo: OfferRepo = {
  readFile: async (path) => (await resolveStoreRepo(dbBackedOfferRepo, getTenant().githubRepo)).readFile(path),
  writeFile: async (path, content) =>
    (await resolveStoreRepo(dbBackedOfferRepo, getTenant().githubRepo)).writeFile(path, content),
  list: async (prefix) => (await resolveStoreRepo(dbBackedOfferRepo, getTenant().githubRepo)).list(prefix),
};
