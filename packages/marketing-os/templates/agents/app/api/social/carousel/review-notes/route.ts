/** Append a note to one repo-bound carousel parent; no child or approval writes. */
import { NextRequest, NextResponse } from "next/server";
import { verifyCarouselReviewLink } from "../../../../../lib/social/review-links";
import { loadGenerationCarousel } from "../../../../../lib/social/generation-carousel";
import { socialRepo } from "../../../../../lib/social/repo";
import { addNote } from "../../../../../lib/review/notes";
import { MAX_NOTE_LENGTH } from "../../../../../lib/review/note-shape";
import { runWithTenant } from "../../../../../lib/tenant-context";

export const runtime = "nodejs";
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const field = (v: unknown) => typeof v === "string" ? v : "";

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 12_000) return NextResponse.json({ error: "note request too large" }, { status: 413 });
  const text = await req.text().catch(() => "");
  if (text.length > 12_000) return NextResponse.json({ error: "note request too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); if (!body || typeof body !== "object" || Array.isArray(body)) throw Error(); }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const groupKey = field(body.groupKey), shop = field(body.shop), repo = field(body.repo);
  const author = field(body.author), noteBody = field(body.body), slot = field(body.slot) || null;
  if (!POST_ID.test(groupKey) || !SHOP.test(shop) || !REPO.test(repo) ||
      (process.env.MARKETING_OS_MODE !== "hosted" && shop !== process.env.SHOPIFY_STORE_URL))
    return NextResponse.json({ error: "invalid carousel note target" }, { status: 400 });
  if (!noteBody.trim()) return NextResponse.json({ error: "a note needs something in it" }, { status: 400 });
  if (noteBody.length > MAX_NOTE_LENGTH) return NextResponse.json({ error: "note too long" }, { status: 413 });
  const verdict = verifyCarouselReviewLink(shop, groupKey, repo, field(body.t) || null, field(body.e) || null);
  if (verdict === "expired") return NextResponse.json({ error: "This review link expired — your note was not saved. Ask for a fresh link." }, { status: 410 });
  if (verdict !== "ok") return NextResponse.json({ error: "invalid review token" }, { status: 403 });
  try {
    return await runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, ""), githubRepo: repo }, async () => {
      const manifest = await loadGenerationCarousel(socialRepo, groupKey);
      if (!manifest) return NextResponse.json({ error: "carousel unavailable" }, { status: 404 });
      if (slot && !manifest.slides.some((slide) => slide.postId === slot))
        return NextResponse.json({ error: "invalid carousel slide" }, { status: 400 });
      const note = await addNote({ packId: "social-media", itemId: groupKey, author, body: noteBody, slot, source: "link" });
      return note ? NextResponse.json({ note })
        : NextResponse.json({ error: "Your note could not be saved. Copy your text and try again." }, { status: 503 });
    });
  } catch { return NextResponse.json({ error: "carousel unavailable" }, { status: 404 }); }
}
