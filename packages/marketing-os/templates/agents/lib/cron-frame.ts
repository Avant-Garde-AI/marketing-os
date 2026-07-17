/**
 * The shared cron frame (05 H7) — extracted as the third channel cron arrives
 * (/api/cron/research exists, /api/cron/email lands on this, /api/cron/social
 * moves onto it on next touch).
 *
 * What the frame owns: the CRON_SECRET gate, per-item error isolation (one
 * failing tenant/item never aborts the sweep), self-limiting batches, timing,
 * and the structured run report. What each cron owns: its scan-and-act body.
 *
 * Failure escalation: item failures are collected and returned (Vercel cron
 * logs them); a Slack failure alert rides the platform gate's card plumbing
 * when the alert seam lands (TODO H7 — today: console.error + report).
 */

import type { NextRequest } from "next/server";

export interface CronItemResult {
  key: string;
  status: string;
  detail?: string;
}

export interface CronRunReport {
  cron: string;
  processed: number;
  failed: number;
  results: CronItemResult[];
  ms: number;
}

/** Gate a cron route on CRON_SECRET (same posture as /api/cron/research:
 * enforced when the secret is configured). Returns a 401 Response or null. */
export function cronGate(req: NextRequest): Response | null {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}

/**
 * Run a batch of items through a handler with per-item error isolation and a
 * hard cap (self-limiting: a runaway backlog processes `limit` per firing and
 * catches up across firings — idempotency is the body's contract).
 */
export async function cronSweep<T>(
  cron: string,
  items: T[],
  limit: number,
  keyOf: (item: T) => string,
  handle: (item: T) => Promise<string>,
): Promise<CronRunReport> {
  const started = Date.now();
  const batch = items.slice(0, limit);
  const results: CronItemResult[] = [];
  let failed = 0;
  for (const item of batch) {
    const key = keyOf(item);
    try {
      const status = await handle(item);
      results.push({ key, status });
    } catch (e) {
      failed++;
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`[${cron}] item ${key} failed:`, detail);
      results.push({ key, status: "error", detail });
    }
  }
  if (items.length > batch.length) {
    results.push({ key: "(backlog)", status: `deferred ${items.length - batch.length} to next firing` });
  }
  return { cron, processed: batch.length, failed, results, ms: Date.now() - started };
}
