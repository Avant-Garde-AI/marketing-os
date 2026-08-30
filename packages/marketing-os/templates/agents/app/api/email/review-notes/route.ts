/**
 * Review notes — the one WRITE a shared review link is allowed to make.
 *
 * Everything else about a review link reads. This accepts a note because the
 * loop only closes if a reviewer can say something the agent will see: build →
 * share link → notes → agent revises → Slack approves.
 *
 * WHAT THIS IS NOT: an identity. The token proves possession of a link, so
 * `author` is a courtesy label, stored as 'link'-sourced and treated as a
 * request rather than an authorisation everywhere downstream. Nothing here
 * touches campaign state — a note cannot approve, schedule, or send.
 *
 * The blast radius of a leaked link is therefore: read the campaign, and add
 * rows to a notes table that a human reads. Bounded on purpose.
 */

import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../lib/tenant-context";
import { verifyLink } from "../../../../lib/email/review-links";
import { addNote, MAX_NOTE_LENGTH } from "../../../../lib/email/review-notes";

export const runtime = "nodejs";

const ID_RE = /^[A-Za-z0-9._-]+$/;

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const campaignId = typeof payload.campaignId === "string" ? payload.campaignId : "";
  const shop = typeof payload.shop === "string" ? payload.shop : "";
  const t = typeof payload.t === "string" ? payload.t : null;
  const e = typeof payload.e === "string" ? payload.e : null;
  const author = typeof payload.author === "string" ? payload.author : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  const slot = typeof payload.slot === "string" ? payload.slot : null;

  if (!campaignId || !ID_RE.test(campaignId) || !shop) {
    return NextResponse.json({ error: "campaignId and shop required" }, { status: 400 });
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

  // The SAME scope the review room was opened with: a preview token (which
  // only ever bought raw HTML) must not become a write credential.
  const verdict = verifyLink("review", shop, campaignId, t, e);
  if (verdict !== "ok") {
    return NextResponse.json(
      {
        error:
          verdict === "expired"
            ? "This review link expired — your note was not saved. Ask for a fresh link."
            : "invalid review token",
      },
      { status: verdict === "expired" ? 410 : 403 },
    );
  }

  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  const note = await runWithTenant({ shop, storeSlug }, () =>
    addNote({ campaignId, author, body, slot, source: "link" }),
  );

  if (!note) {
    // addNote answers null when the write could not land. Do not pretend.
    return NextResponse.json(
      { error: "Your note could not be saved. Copy your text and try again." },
      { status: 503 },
    );
  }

  return NextResponse.json({ note });
}
