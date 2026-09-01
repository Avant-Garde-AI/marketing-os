/**
 * The migration runner — applies pending schema migrations using the console's
 * OWN database credentials.
 *
 * WHY THIS SHAPE. Every upgrade PR that adds a table has, until now, needed a
 * human to paste SQL into the Supabase dashboard, because the connection string
 * is a write-only secret: it is set in the deployment's environment and cannot
 * be read back out of it. That is correct security and a bad workflow — the
 * migration and the code that needs it ship together and then land apart, and
 * every projection-backed surface reads empty in between with no error
 * (spec 26 §5, failure mode 4).
 *
 * The fix is to stop trying to move the credential to the operator and instead
 * run the migration where the credential already lives. The deployment has
 * SUPABASE_DATABASE_URL; the deployment applies its own migrations. No secret
 * is exported, no CI variable is duplicated, and self-hosted works the same way
 * as hosted because both have a database URL by definition.
 *
 * DISCIPLINES
 *  - FORWARD ONLY. There is no `down`. A migration that turns out wrong is
 *    fixed by a new migration, never by reversing history under a running
 *    console.
 *  - LEDGERED. `mos_migrations` records every applied name with a checksum, so
 *    "what does this database actually have" is answerable without inspecting
 *    the schema.
 *  - LOCKED. A Postgres advisory lock serialises concurrent runners — a
 *    redeploy that boots several instances must not race them into the same
 *    CREATE.
 *  - ONE TRANSACTION EACH. A migration applies completely or not at all, and a
 *    failure stops the run so the ledger never claims something half-applied.
 *  - DRIFT IS REPORTED, NEVER REPAIRED. If an already-applied file's checksum
 *    changed, the runner says so and moves on. Re-running edited DDL against a
 *    live database is exactly the destructive surprise this exists to avoid.
 */

import { createHash } from "node:crypto";
import { Pool } from "pg";
import { MIGRATIONS, type BundledMigration } from "./bundled";

/** Deterministic lock id for this runner (any constant works; it just has to
 * be the same across instances). */
const ADVISORY_LOCK_ID = 8_240_517;

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS mos_migrations (
  name        TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export interface MigrationOutcome {
  name: string;
  status: "applied" | "already-applied" | "drifted" | "failed" | "skipped" | "baselined";
  ms?: number;
  error?: string;
}

export interface MigrationReport {
  ok: boolean;
  /** False when no database is configured — nothing was attempted. */
  configured: boolean;
  applied: number;
  pending: number;
  outcomes: MigrationOutcome[];
}

function checksum(sql: string): string {
  // Whitespace-insensitive so reformatting a file is not reported as drift;
  // any real DDL change still is.
  return createHash("sha256").update(sql.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

function connectionString(): string | null {
  return process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
}

/**
 * Apply every migration this deployment carries that the database has not
 * seen. Safe to call repeatedly — that is the point.
 *
 * @param dryRun report what WOULD be applied without applying it.
 * @param baselineThrough ADOPTION ONLY. Record every migration up to and
 *   including this filename as applied WITHOUT running it.
 *
 *   An existing database has a schema but an empty ledger, so a runner turned
 *   loose on it would try to re-run history — including the init migration
 *   that built the database in the first place. `IF NOT EXISTS` makes most of
 *   that harmless, but "most" is not a property to bet a production console
 *   on. Baselining states the truth instead: these are already here.
 *
 *   Use it once, when a console adopts the runner, with the name of the last
 *   migration already applied by hand. Never afterwards.
 */
export async function runMigrations(
  opts: { dryRun?: boolean; baselineThrough?: string } = {},
): Promise<MigrationReport> {
  const cs = connectionString();
  if (!cs) {
    return {
      ok: false,
      configured: false,
      applied: 0,
      pending: MIGRATIONS.length,
      outcomes: [
        {
          name: "(none)",
          status: "skipped",
          error:
            "no SUPABASE_DATABASE_URL/DATABASE_URL — this deployment cannot reach a database, so nothing was applied",
        },
      ],
    };
  }

  // A dedicated short-lived pool: migrations run rarely and must not sit in
  // the request pool's way.
  const pool = new Pool({ connectionString: cs, max: 1 });
  const outcomes: MigrationOutcome[] = [];
  let applied = 0;

  try {
    const client = await pool.connect();
    try {
      await client.query(LEDGER_DDL);
      // Serialise runners. Blocking (not `try_`) is right: a second instance
      // should wait and then find everything already applied, not skip.
      await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_ID]);

      const seen = new Map<string, string>();
      for (const r of (await client.query<{ name: string; checksum: string }>(
        "SELECT name, checksum FROM mos_migrations",
      )).rows) {
        seen.set(r.name, r.checksum);
      }

      // Lexical order is the contract — migrations are numbered for exactly
      // this reason, and the bundler sorts by filename.
      const ordered = [...MIGRATIONS].sort((a: BundledMigration, b: BundledMigration) =>
        a.name.localeCompare(b.name),
      );

      for (const m of ordered) {
        const sum = checksum(m.sql);
        const prior = seen.get(m.name);

        if (prior !== undefined) {
          outcomes.push({
            name: m.name,
            status: prior === sum ? "already-applied" : "drifted",
            ...(prior === sum
              ? {}
              : {
                  error:
                    "this migration's SQL changed after it was applied. It was NOT re-run — migrations are immutable once applied; correct it with a new migration.",
                }),
          });
          continue;
        }

        // Adoption: claim it as present without executing it.
        if (opts.baselineThrough && m.name.localeCompare(opts.baselineThrough) <= 0) {
          if (!opts.dryRun) {
            await client.query(
              "INSERT INTO mos_migrations (name, checksum) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
              [m.name, sum],
            );
          }
          outcomes.push({
            name: m.name,
            status: "baselined",
            error: opts.dryRun ? "dry run — would be recorded as already applied, not executed" : undefined,
          });
          continue;
        }

        if (opts.dryRun) {
          outcomes.push({ name: m.name, status: "skipped", error: "dry run — not applied" });
          continue;
        }

        const started = Date.now();
        try {
          await client.query("BEGIN");
          await client.query(m.sql);
          await client.query(
            "INSERT INTO mos_migrations (name, checksum) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
            [m.name, sum],
          );
          await client.query("COMMIT");
          applied++;
          outcomes.push({ name: m.name, status: "applied", ms: Date.now() - started });
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          const error = e instanceof Error ? e.message : String(e);
          outcomes.push({ name: m.name, status: "failed", ms: Date.now() - started, error });
          console.error(`[migrations] ${m.name} FAILED (rolled back): ${error}`);
          // Stop: later migrations may depend on this one, and applying them
          // over a gap makes the ledger lie about what the schema is.
          break;
        }
      }

      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]).catch(() => {});
    } finally {
      client.release();
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[migrations] runner could not reach the database:", error);
    return {
      ok: false,
      configured: true,
      applied,
      pending: MIGRATIONS.length - applied,
      outcomes: [...outcomes, { name: "(connection)", status: "failed", error }],
    };
  } finally {
    await pool.end().catch(() => {});
  }

  const failed = outcomes.some((o) => o.status === "failed");
  const pending = outcomes.filter((o) => o.status === "skipped" || o.status === "failed").length;
  if (applied > 0) console.log(`[migrations] applied ${applied} migration(s)`);
  return { ok: !failed, configured: true, applied, pending, outcomes };
}
