/**
 * Review notes — the feedback lane between a shared review link and the next
 * agent session.
 *
 * The loop this closes: the agent builds a campaign → a session hands out a
 * review link → teammates leave notes on the hosted page → the agent reads
 * them back through MCP and revises → final approval still happens in Slack.
 *
 * IDENTITY: `author` is self-declared free text from a token-gated public page
 * (see the migration's warning). Every read path in this module carries that
 * caveat outward rather than laundering it — a note is a request, never an
 * authorisation. Callers that render or summarise notes must keep saying so.
 *
 * Degrade-don't-throw, matching lib/email/console-data.ts: no DB or an
 * unapplied migration answers [] and the page renders its empty state.
 */

import { getTenant } from "../tenant-context";
import { safeQuery, tenantIdForShop } from "../platform-db";

/** Hard ceiling on a note. Generous for prose, small enough that a public
 *  endpoint can't be used to park data in the tenant's database. */
export const MAX_NOTE_LENGTH = 4000;
export const MAX_AUTHOR_LENGTH = 80;

export interface ReviewNote {
  id: string;
  campaignId: string;
  slot: string | null;
  /** SELF-DECLARED. Not an authenticated identity. */
  author: string;
  body: string;
  /** 'link' = arrived through a shared review link; 'console' = authenticated. */
  source: string;
  resolvedAt: string | null;
  createdAt: string;
}

interface NoteRow {
  id: string;
  campaign_id: string;
  slot: string | null;
  author: string;
  body: string;
  source: string;
  resolved_at: Date | string | null;
  created_at: Date | string;
}

function iso(v: Date | string | null): string | null {
  if (v === null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toNote(r: NoteRow): ReviewNote {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    slot: r.slot,
    author: r.author,
    body: r.body,
    source: r.source,
    resolvedAt: iso(r.resolved_at),
    createdAt: iso(r.created_at)!,
  };
}

const COLUMNS = "id, campaign_id, slot, author, body, source, resolved_at, created_at";

/** Notes on one campaign, oldest first — the review room's thread. */
export async function listNotes(campaignId: string): Promise<ReviewNote[]> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid) return [];
  const rows = await safeQuery<NoteRow>(
    `email review notes ${campaignId}`,
    `SELECT ${COLUMNS} FROM mos_email_review_notes
      WHERE tenant_id = $1 AND campaign_id = $2
      ORDER BY created_at`,
    [tid, campaignId],
  );
  return (rows ?? []).map(toNote);
}

/** Unresolved notes across campaigns — "what came back from review?", the
 *  question a planning session actually asks. */
export async function listOpenNotes(limit = 100): Promise<ReviewNote[]> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid) return [];
  const rows = await safeQuery<NoteRow>(
    "email review notes (open)",
    `SELECT ${COLUMNS} FROM mos_email_review_notes
      WHERE tenant_id = $1 AND resolved_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2`,
    [tid, Math.min(Math.max(1, limit), 500)],
  );
  return (rows ?? []).map(toNote);
}

/** Per-campaign note counts for the contact sheet — one query, not one per
 *  card. `open` is what a reviewer scanning a month actually wants to see. */
export async function countNotes(
  campaignIds: string[],
): Promise<Map<string, { total: number; open: number }>> {
  const out = new Map<string, { total: number; open: number }>();
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid || campaignIds.length === 0) return out;
  const rows = await safeQuery<{ campaign_id: string; total: string; open: string }>(
    "email review note counts",
    `SELECT campaign_id,
            COUNT(*)                                        AS total,
            COUNT(*) FILTER (WHERE resolved_at IS NULL)     AS open
       FROM mos_email_review_notes
      WHERE tenant_id = $1 AND campaign_id = ANY($2::text[])
      GROUP BY campaign_id`,
    [tid, campaignIds],
  );
  for (const r of rows ?? []) {
    out.set(r.campaign_id, { total: Number(r.total), open: Number(r.open) });
  }
  return out;
}

export interface AddNoteInput {
  campaignId: string;
  author: string;
  body: string;
  slot?: string | null;
  source?: "link" | "console";
}

/**
 * Append a note. Returns null when the write could not land (no DB, migration
 * unapplied, unknown tenant) so the caller can tell the reviewer their note
 * did NOT save — the failure mode that matters, since a swallowed note looks
 * exactly like a note nobody acted on.
 */
export async function addNote(input: AddNoteInput): Promise<ReviewNote | null> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid) return null;

  const author = input.author.trim().slice(0, MAX_AUTHOR_LENGTH) || "anonymous";
  const body = input.body.trim().slice(0, MAX_NOTE_LENGTH);
  if (!body) return null;

  const rows = await safeQuery<NoteRow>(
    `email review note add ${input.campaignId}`,
    `INSERT INTO mos_email_review_notes (tenant_id, campaign_id, slot, author, body, source)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${COLUMNS}`,
    [tid, input.campaignId, input.slot ?? null, author, body, input.source ?? "link"],
  );
  return rows?.[0] ? toNote(rows[0]) : null;
}

/** Mark notes handled. Used by the agent after it revises a campaign, so the
 *  open-notes read stays a live worklist instead of an archive. */
export async function resolveNotes(noteIds: string[]): Promise<number> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid || noteIds.length === 0) return 0;
  const rows = await safeQuery<{ id: string }>(
    "email review notes resolve",
    `UPDATE mos_email_review_notes
        SET resolved_at = now()
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND resolved_at IS NULL
      RETURNING id`,
    [tid, noteIds],
  );
  return rows?.length ?? 0;
}
