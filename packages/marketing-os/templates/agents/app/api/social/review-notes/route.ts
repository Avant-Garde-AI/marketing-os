/**
 * The ONE write a social review link may make (spec 26 §0.1): append a note.
 *
 * It re-verifies the token in-route — the middleware allowlist only makes the
 * path reachable, it grants nothing — caps the body, appends a row, and
 * touches no post state. Nothing here can advance a lifecycle, approve, or
 * publish. Blast radius of a leaked link stays "read the group, add rows to a
 * notes table a human reads".
 *
 * The token is re-verified at `review` scope specifically. A `sheet` token
 * opens the month view and must not become a write credential for a group it
 * merely listed.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyLink } from "../../../../lib/social/review-links";
import { addNote } from "../../../../lib/review/notes";
import { MAX_NOTE_LENGTH } from "../../../../lib/review/note-shape";
import { runWithTenant } from "../../../../lib/tenant-context";

export const runtime = "nodejs";

const SOCIAL_PACK_ID = "social-media";
/** Group keys are post ids or author-chosen slugs; same charset as postPath. */
const ID_RE = /^[A-Za-z0-9._-]+$/;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function nullableStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const b = raw as Record<string, unknown>;
  const groupKey = str(b.groupKey);
  const shop = str(b.shop);
  const author = str(b.author);
  const body = str(b.body);
  const slot = nullableStr(b.slot);
  const token = nullableStr(b.t);
  const exp = nullableStr(b.e);

  if (!groupKey || !ID_RE.test(groupKey) || !shop) {
    return NextResponse.json({ error: "groupKey and shop required" }, { status: 400 });
  }
  if (!body.trim()) {
    return NextResponse.json({ error: "a note needs something in it" }, { status: 400 });
  }
  if (body.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { error: `notes are capped at ${MAX_NOTE_LENGTH} characters` },
      { status: 413 },
    );
  }

  const verdict = verifyLink("review", shop, groupKey, token, exp);
  if (verdict === "expired") {
    return NextResponse.json(
      { error: "This review link expired — your note was not saved. Ask for a fresh link." },
      { status: 410 },
    );
  }
  if (verdict !== "ok") {
    return NextResponse.json({ error: "invalid review token" }, { status: 403 });
  }

  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  const note = await runWithTenant({ shop, storeSlug }, () =>
    addNote({ packId: SOCIAL_PACK_ID, itemId: groupKey, author, body, slot, source: "link" }),
  );

  // addNote returns null when the row did not land. Telling the reviewer their
  // note vanished is the whole point — a silent success here means someone
  // believes they were heard and nobody ever sees it.
  if (!note) {
    return NextResponse.json(
      { error: "Your note could not be saved. Copy your text and try again." },
      { status: 503 },
    );
  }
  return NextResponse.json({ note });
}
