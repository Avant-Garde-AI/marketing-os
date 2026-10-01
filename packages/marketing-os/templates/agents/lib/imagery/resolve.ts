/**
 * Imagery resolution — a declarative request for a shot, satisfied from the
 * store's mockup pipeline.
 *
 * Callers (an email hero block, a social post, a design surface) describe what
 * they NEED — a role, an orientation, a mood — and never a URL. This module
 * gathers candidates, applies the house rules, and returns a winner plus the
 * runners-up so a vision pass or a human can override.
 *
 * ## Tiers
 *
 *   1. `given`   — an image the caller already holds (the art graph's stored
 *                  image, say). Free, but INCONSISTENT: the graph keeps one
 *                  image per artwork and it may be a flat scan, or a mockup in
 *                  a frame the brand doesn't use.
 *   2. `compose` — AMS `/external/compose`: composites the artwork into the
 *                  built room-template library. ~$0, ~8s, 5 slides (a leaning
 *                  hero + 4 room scenes across frames). This is the workhorse
 *                  and it uses NO image generation, so it is unaffected by the
 *                  Gemini spend cap that blocks tier 3.
 *   3. `scene`   — AMS `/external/scene`: a novel scene generated from prose
 *                  for a campaign's specific premise. Costs a pro image
 *                  generation; deliberately NOT called from here (a caller that
 *                  wants it should ask for it explicitly and carry the budget).
 *
 * ## House rules (why the winner is the winner)
 *
 * - **Oak first.** Oak reads warmest against Arthaus parchment and is the house
 *   frame; black and walnut are the alternates.
 * - **Never white.** A white frame with a white mat on a parchment wall makes
 *   the artwork read as a small island in an oversized white slab. AMS's own
 *   template library flags white as a blend risk; we simply don't ship it.
 * - **Square art never gets a room.** The template library has ZERO square room
 *   templates (0 of 187) and the compositor is `fit: cover`, so a square piece
 *   is silently centre-cropped into a portrait room. Square → leaning only.
 * - **Role picks the treatment.** Editorial and room-recommendation want the
 *   work living in a space; an artist drop and a product feature want the work
 *   itself, so they get the leaning shot. Leaning is also the universal
 *   fallback when nothing better resolves.
 *
 * ## Freshness
 *
 * Composed URLs are SIGNED and expire (24h by default). They are fine for a
 * preview; anything that will be SENT must upload the winner to the ESP first
 * — the email draft Action already does this for surface sections. Callers get
 * `expiresInMinutes` so they cannot accidentally treat one as durable.
 */

import { getShopifyClient } from "../shopify";

const AMS_BASE = process.env.AMS_MOCKUP_URL ?? "https://artwork-ms-spfdrt2aha-uc.a.run.app/artwork-ms";
const AMS_KEY = process.env.AMS_MOCKUP_SERVICE_KEY ?? "";
const COMPOSE_TIMEOUT_MS = 60_000;

/** Frames we will ship, best first. White is excluded by policy (see module doc). */
const FRAME_RANK: Record<string, number> = { oak: 0, black: 1, walnut: 2 };
const BANNED_FRAMES = new Set(["white"]);

export type ImageryRole =
  | "hero-editorial"
  | "hero-room"
  | "hero-artist"
  | "hero-product"
  | "thumbnail";

/** Roles whose treatment is the work in a space rather than the work alone. */
const ROOM_ROLES = new Set<ImageryRole>(["hero-editorial", "hero-room"]);

export interface ImageryRequest {
  /** Public https URL of the artwork master/preview to composite. */
  artworkUrl: string;
  /** Stable key for this artwork — seeds template selection so the same piece
   * resolves to the same imagery across campaigns (and makes results cacheable). */
  artworkKey: string;
  role: ImageryRole;
  /** Artwork orientation, when known. "square" suppresses room scenes. */
  orientation?: "portrait" | "landscape" | "square";
  /** Preferred room ids (from AMS `/external/rooms`), e.g. seasonal mood. */
  rooms?: string[];
  title?: string;
}

export interface ImageryCandidate {
  url: string;
  kind: "leaning" | "scene" | "given";
  frame: string | null;
  room: string | null;
  width?: number;
  height?: number;
  /** Why this ranked where it did — surfaced so a pick is reviewable. */
  rationale: string;
}

export interface ImageryResult {
  chosen: ImageryCandidate | null;
  candidates: ImageryCandidate[];
  source: "compose" | "given" | "none";
  expiresInMinutes: number | null;
  /** Human-readable account of the decision, for the campaign artifact. */
  provenance: string;
  warnings: string[];
}

interface ComposeSlide {
  kind?: string;
  url?: string;
  frame?: string | null;
  room?: string | null;
  width?: number;
  height?: number;
}

async function composeSlides(req: ImageryRequest): Promise<{ slides: ComposeSlide[]; ttl: number | null }> {
  if (!AMS_KEY) throw new Error("AMS_MOCKUP_SERVICE_KEY not configured — imagery cannot be composed");
  const res = await fetch(`${AMS_BASE}/api/content/mockup/external/compose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AMS-Service-Key": AMS_KEY },
    body: JSON.stringify({
      externalRef: req.artworkKey,
      artworkUrl: req.artworkUrl,
      scenes: 4,
      ...(req.rooms?.length ? { rooms: req.rooms } : {}),
      ...(req.title ? { title: req.title } : {}),
    }),
    signal: AbortSignal.timeout(COMPOSE_TIMEOUT_MS),
  });
  const body = (await res.json()) as { slides?: ComposeSlide[]; urlsExpireInMinutes?: number; message?: string };
  if (!res.ok) throw new Error(`compose ${res.status}: ${body?.message ?? "failed"}`);
  return { slides: body.slides ?? [], ttl: body.urlsExpireInMinutes ?? null };
}

/** Rank a slide for this request. Lower is better; null means disqualified. */
function score(slide: ComposeSlide, req: ImageryRequest): { score: number; rationale: string } | null {
  const frame = (slide.frame ?? "").toLowerCase();
  if (BANNED_FRAMES.has(frame)) return null; // white: blends on parchment
  const isRoom = slide.kind === "scene";
  if (isRoom && req.orientation === "square") return null; // no square room templates

  const wantsRoom = ROOM_ROLES.has(req.role);
  const treatmentPenalty = isRoom === wantsRoom ? 0 : 10;
  const framePenalty = FRAME_RANK[frame] ?? 5;
  const roomBonus = req.rooms?.length && slide.room && req.rooms.includes(slide.room) ? -2 : 0;

  const parts = [
    isRoom ? `room scene${slide.room ? ` (${slide.room})` : ""}` : "leaning shot",
    `${frame || "unframed"} frame`,
    treatmentPenalty === 0 ? `matches the ${req.role} treatment` : `treatment mismatch for ${req.role}`,
  ];
  return { score: treatmentPenalty + framePenalty + roomBonus, rationale: parts.join(", ") };
}


/** Artwork CDN that serves RAW, unframed art keyed by `{id}-{handle}`. */
const RAW_ARTWORK_CDN = "https://picasso.arthaus.cloud/cache/artworks";

/**
 * Is this URL already a rendered mockup rather than raw artwork?
 *
 * Some catalogue products carry a styled leaning shot as their product image.
 * Compositing one into a room frame produces a framed photograph OF a framed
 * print — a picture of a picture, which reads as a mistake to anyone who sees
 * it and did, in a shipped campaign.
 */
export function isRenderedMockup(url: string): boolean {
  return /\/mockup-|--(black|oak|white|natural)--|-leaning-leaning-/i.test(url);
}

/**
 * Recover the raw artwork behind a rendered mockup.
 *
 * Mockup filenames embed the artwork they were made from —
 * `mockup-29405-botanical-life-leaning-leaning--black--portrait-…` — so the raw
 * image is reachable at `{id}-{handle}` on the artwork CDN. Returns null when
 * the name doesn't carry that shape; guessing a URL is worse than declining.
 */
export function rawArtworkUrlFrom(url: string): string | null {
  const m = url.match(/\/mockup-(\d+)-([a-z0-9-]+?)-(?:leaning|room|scene)\b/i);
  if (!m) return null;
  return `${RAW_ARTWORK_CDN}/${m[1]}-${m[2]}.webp`;
}

/**
 * Catalogue product photos on this store are FRAMED variant shots (frame + mat
 * on white), whether served from Shopify's product CDN or re-hosted by Klaviyo.
 * The filename says nothing, which is how they slipped past isRenderedMockup
 * and shipped frame-within-a-frame heroes onto a whole month of review cards.
 */
export function isCatalogueProductPhoto(url: string): boolean {
  return /cdn\.shopify\.com\/s\/files\/[^?]*\/products\/|d3k81ch9hvuctc\.cloudfront\.net\//i.test(url);
}

/** Candidate artwork slugs: the handle minus Shopify's `-1` dedupe suffix, then the title. */
export function artworkSlugCandidates(handle: string, title?: string): string[] {
  const slugs = [handle.replace(/-\d+$/, "")];
  if (title) {
    slugs.push(
      title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    );
  }
  return [...new Set(slugs.filter(Boolean))];
}

/**
 * Recover raw artwork from a Shopify handle. Variant SKUs are
 * `{productId}-{artworkId}-…`, and the raw CDN is keyed `{artworkId}-{slug}`.
 * Returns null — never a guess — when the handle isn't a product or no
 * candidate URL actually serves an image.
 */
async function rawArtworkFromHandle(handle: string, title?: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/i.test(handle)) return null;
  try {
    const res = await getShopifyClient().graphql<{
      productByHandle: { title: string; variants: { nodes: Array<{ sku: string | null }> } } | null;
    }>(
      `query($h: String!) { productByHandle(handle: $h) { title variants(first: 5) { nodes { sku } } } }`,
      { h: handle },
    );
    const product = res.data?.productByHandle;
    if (!product) return null;
    const artworkId = product.variants.nodes
      .map((v) => v.sku?.split("-")[1])
      .find((id): id is string => !!id && /^\d+$/.test(id));
    if (!artworkId) return null;
    for (const slug of artworkSlugCandidates(handle, title ?? product.title)) {
      const url = `${RAW_ARTWORK_CDN}/${artworkId}-${slug}.webp`;
      if (await servesImage(url)) return url;
    }
  } catch {
    // A lookup failure falls through to the host check, which declines framed sources.
  }
  return null;
}

/** Does a candidate raw-artwork URL actually serve an image? */
async function servesImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
  }
}

/**
 * Resolve imagery for one request. Never throws for "nothing good found" — an
 * empty `chosen` with warnings is a legitimate answer the caller can degrade on.
 */
export async function resolveImagery(req: ImageryRequest): Promise<ImageryResult> {
  const warnings: string[] = [];

  // Only raw art gets composited. Anything else — a mockup, or a catalogue
  // photo that is framed but says nothing in its name — is swapped for the raw
  // artwork (via the filename, then the product handle), or declined when it is
  // known to be framed, because no hero is better than a picture of a picture.
  if (!req.artworkUrl.startsWith(RAW_ARTWORK_CDN)) {
    let raw: string | null = null;
    if (isRenderedMockup(req.artworkUrl)) {
      const fromName = rawArtworkUrlFrom(req.artworkUrl);
      if (fromName && (await servesImage(fromName))) raw = fromName;
    }
    if (!raw) raw = await rawArtworkFromHandle(req.artworkKey, req.title);
    if (raw) {
      warnings.push(
        `source was not raw artwork; composited the raw artwork instead (${raw.split("/").pop()})`,
      );
      req = { ...req, artworkUrl: raw };
    } else if (isRenderedMockup(req.artworkUrl) || isCatalogueProductPhoto(req.artworkUrl)) {
      return {
        chosen: null,
        candidates: [],
        source: "none",
        expiresInMinutes: null,
        provenance: "declined: source image is already framed",
        warnings: [
          ...warnings,
          "the supplied image is already framed (a mockup or a catalogue product photo) and no raw artwork could be recovered from its name or the product handle. Compositing it would produce a framed photo of a framed print. Pass the Shopify handle as artworkKey, or the raw artwork URL.",
        ],
      };
    }
  }

  if (req.orientation === "square") {
    warnings.push("square artwork: room scenes suppressed (the template library has no square rooms; a room composite would silently centre-crop)");
  }

  let slides: ComposeSlide[] = [];
  let ttl: number | null = null;
  try {
    const out = await composeSlides(req);
    slides = out.slides;
    ttl = out.ttl;
  } catch (e) {
    warnings.push(`compose failed: ${e instanceof Error ? e.message : String(e)}`);
    return { chosen: null, candidates: [], source: "none", expiresInMinutes: null, provenance: "compose unavailable", warnings };
  }

  const ranked = slides
    .map((s) => {
      const sc = score(s, req);
      return sc && s.url ? { slide: s, ...sc } : null;
    })
    .filter((x): x is { slide: ComposeSlide; score: number; rationale: string } => x !== null)
    .sort((a, b) => a.score - b.score);

  const candidates: ImageryCandidate[] = ranked.map((r) => ({
    url: r.slide.url!,
    kind: (r.slide.kind === "scene" ? "scene" : "leaning") as "scene" | "leaning",
    frame: r.slide.frame ?? null,
    room: r.slide.room ?? null,
    ...(r.slide.width ? { width: r.slide.width } : {}),
    ...(r.slide.height ? { height: r.slide.height } : {}),
    rationale: r.rationale,
  }));

  if (!candidates.length) {
    warnings.push("every composed slide was disqualified by the frame/orientation rules");
    return { chosen: null, candidates: [], source: "none", expiresInMinutes: ttl, provenance: "no eligible slide", warnings };
  }

  const chosen = candidates[0];
  return {
    chosen,
    candidates,
    source: "compose",
    expiresInMinutes: ttl,
    provenance:
      `compose/${req.artworkKey} → ${chosen.kind}` +
      `${chosen.room ? ` in ${chosen.room}` : ""} with ${chosen.frame} frame — ${chosen.rationale}`,
    warnings,
  };
}

/** The rooms a caller can actually request (built templates only). */
export async function listRooms(): Promise<Array<{ id: string; name: string; mood: string; primaryRoom: string }>> {
  if (!AMS_KEY) throw new Error("AMS_MOCKUP_SERVICE_KEY not configured");
  const res = await fetch(`${AMS_BASE}/api/content/mockup/external/rooms`, {
    headers: { "X-AMS-Service-Key": AMS_KEY },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`rooms ${res.status}`);
  const body = (await res.json()) as { rooms?: Array<{ id: string; name: string; mood: string; primaryRoom: string }> };
  return body.rooms ?? [];
}
