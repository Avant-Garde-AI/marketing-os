/** Transaction-scoped advisory lock shared by cron and gate workers. No in-memory concurrency illusion. */
import { Pool } from "pg";
import { getTenant } from "../tenant-context";
let pool: Pool | undefined;
export async function withSocialPostLock<T>(postId: string, run: () => Promise<T>): Promise<T> {
  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) throw new Error("Durable social publishing coordination requires a database");
  pool ??= new Pool({ connectionString: cs, max: 3 });
  const client = await pool.connect();
  const key = `social-publish:${getTenant().shop}:${postId}`;
  let held = false;
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired", [key]);
    held = result.rows[0]?.acquired === true;
    if (!held) throw new Error("This post is already being updated or published. Reload to check its status.");
    return await run();
  } finally {
    try { await client.query("ROLLBACK"); }
    finally { client.release(true); }
  }
}
