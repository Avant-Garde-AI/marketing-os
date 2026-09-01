/**
 * Apply this deployment's pending schema migrations.
 *
 * The console runs its own migrations because it is the only party that
 * already holds the database credential — see lib/migrations/run.ts for why
 * that is the whole point rather than a convenience.
 *
 *   GET  — what this database has and what is pending (a dry run; changes
 *          nothing). Use it to answer "did the upgrade actually land?".
 *   POST — apply pending migrations.
 *
 * AUTH. A shared secret in the Authorization header, the same one the cron
 * routes use. This endpoint executes DDL, so it is deliberately NOT reachable
 * by the agent: no Mastra tool calls it, and the model never holds the secret.
 * A migration is an operator action or a deploy step, never something a model
 * decides to do.
 *
 * Returns 200 with a report even when a migration FAILED, because the report
 * is the useful part; `ok: false` carries the failure. The one exception is
 * auth, which fails closed.
 */

import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "../../../../lib/migrations/run";

export const runtime = "nodejs";
// DDL on a cold database (indexes, backfills) can take a while; a timeout
// mid-migration would leave the ledger arguing with the schema.
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.MIGRATIONS_SECRET ?? process.env.CRON_SECRET ?? process.env.ACTIONS_GATE_SECRET;
  if (!secret) return false; // fail closed: no secret configured means no remote DDL
  const header = req.headers.get("authorization") ?? "";
  const raw = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Length check first so the compare below is on equal-length buffers.
  if (raw.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < raw.length; i++) diff |= raw.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runMigrations({ dryRun: true }));
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // `baselineThrough` is the one-time adoption path for a console whose schema
  // predates the runner: it records history as applied instead of re-running
  // it. See lib/migrations/run.ts. Everything after the named migration still
  // applies normally.
  const body = (await req.json().catch(() => ({}))) as { baselineThrough?: string; dryRun?: boolean };
  const report = await runMigrations({
    ...(typeof body.baselineThrough === "string" ? { baselineThrough: body.baselineThrough } : {}),
    ...(body.dryRun === true ? { dryRun: true } : {}),
  });
  return NextResponse.json(report);
}
