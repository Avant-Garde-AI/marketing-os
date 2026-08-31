/**
 * Review notes — the DB side, generalised across packs (spec 26 D1).
 *
 * The note SHAPE lives in ./note-shape (import-free) so the client thread can
 * share it without dragging `pg` into the browser bundle. This module is the
 * server half and may reach the database freely.
 *
 * Addressing is (packId, itemId). For social the item is a post GROUP key
 * (spec 26 D3) — the group is the review unit, so it is the discussion unit.
 *
 * DEGRADE-DON'T-THROW, with one deliberate exception: `addNote` returns null
 * when the write did not land, and callers MUST surface that. A note that
 * silently vanishes is worse than an error — the reviewer believes they were
 * heard and nobody ever sees it (spec 26 §5: empty is indistinguishable from
 * broken).
 */

import { getTenant } from "../tenant-context";
import { safeQuery, tenantIdForShop } from "../platform-db";
import {
  MAX_AUTHOR_LENGTH,
  MAX_NOTE_LENGTH,
  type ReviewNote,
  type ReviewNoteSource,
} from "./note-shape";

const COLUMNS = "id, pack_id, item_id, slot, author, body, source, resolved_at, created_at";

interface NoteRow {
  id: string;
  pack_id: string;
  item_id: string;
  slot: string | null;
  author: string;
  body: string;
  source: string;
  resolved_at: Date | string | null;
  created_at: Date | string;
}

function iso(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function toNote(r: NoteRow): ReviewNote {
  return {
    id: r.id,
    packId: r.pack_id,
    itemId: r.item_id,
    slot: r.slot,
    author: r.author,
    body: r.body,
    source: (r.source === "console" ? "console" : "link") as ReviewNoteSource,
    resolvedAt: iso(r.resolved_at),
    createdAt: iso(r.created_at)!,
  };
}

/** Resolve the current tenant, or null when there is no usable context. */
async function tid(): Promise<string | null> {
  const { shop, tenantId } = getTenant();
  return tenantIdForShop(shop, tenantId);
}

/** One item's thread, oldest first — what the review room renders. */
export async function listNotes(packId: string, itemId: string): Promise<ReviewNote[]> {
  const t = await tid();
  if (!t) return [];
  const rows = await safeQuery<NoteRow>(
    "review notes: list",
    `SELECT ${COLUMNS} FROM mos_review_notes
      WHERE tenant_id = $1 AND pack_id = $2 AND item_id = $3
      ORDER BY created_at`,
    [t, packId, itemId],
  );
  return (rows ?? []).map(toNote);
}

/** Everything still open for a pack — the "what needs my attention" read. */
export async function listOpenNotes(packId: string, limit = 100): Promise<ReviewNote[]> {
  const t = await tid();
  if (!t) return [];
  const rows = await safeQuery<NoteRow>(
    "review notes: list open",
    `SELECT ${COLUMNS} FROM mos_review_notes
      WHERE tenant_id = $1 AND pack_id = $2 AND resolved_at IS NULL
      ORDER BY created_at DESC LIMIT $3`,
    [t, packId, Math.min(Math.max(1, limit), 500)],
  );
  return (rows ?? []).map(toNote);
}

/**
 * Note counts for many items in ONE query — the month sheet shows a count per
 * card, and a query per card would be a sheet-sized N+1 (spec 26 D7).
 */
export async function countNotes(
  packId: string,
  itemIds: string[],
): Promise<Map<string, { total: number; open: number }>> {
  const out = new Map<string, { total: number; open: number }>();
  if (itemIds.length === 0) return out;
  const t = await tid();
  if (!t) return out;
  const rows = await safeQuery<{ item_id: string; total: string; open: string }>(
    "review notes: count",
    `SELECT item_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open
       FROM mos_review_notes
      WHERE tenant_id = $1 AND pack_id = $2 AND item_id = ANY($3::text[])
      GROUP BY item_id`,
    [t, packId, itemIds],
  );
  for (const r of rows ?? []) {
    out.set(r.item_id, { total: Number(r.total), open: Number(r.open) });
  }
  return out;
}

export interface AddNoteInput {
  packId: string;
  itemId: string;
  author: string;
  body: string;
  slot?: string | null;
  source?: ReviewNoteSource;
}

/**
 * Append a note. Truncates rather than rejecting — a reviewer who wrote too
 * much should not lose their note to a validation error.
 *
 * Returns null when the note did NOT persist (no tenant, or the write failed).
 * The caller must tell the reviewer; see the module note.
 */
export async function addNote(input: AddNoteInput): Promise<ReviewNote | null> {
  const t = await tid();
  if (!t) return null;
  const author = input.author.trim().slice(0, MAX_AUTHOR_LENGTH) || "anonymous";
  const body = input.body.trim().slice(0, MAX_NOTE_LENGTH);
  if (!body) return null;
  const rows = await safeQuery<NoteRow>(
    "review notes: add",
    `INSERT INTO mos_review_notes (tenant_id, pack_id, item_id, slot, author, body, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [t, input.packId, input.itemId, input.slot ?? null, author, body, input.source ?? "link"],
  );
  const row = rows?.[0];
  return row ? toNote(row) : null;
}

/** Mark notes handled, so a session can ask for what is still open. Returns
 * how many actually changed (already-resolved ids are not re-resolved). */
export async function resolveNotes(noteIds: string[]): Promise<number> {
  if (noteIds.length === 0) return 0;
  const t = await tid();
  if (!t) return 0;
  const rows = await safeQuery<{ id: string }>(
    "review notes: resolve",
    `UPDATE mos_review_notes SET resolved_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND resolved_at IS NULL
      RETURNING id`,
    [t, noteIds],
  );
  return rows?.length ?? 0;
}
