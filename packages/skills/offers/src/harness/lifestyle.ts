/**
 * Lifestyle-image selection for the harness brief — the pure half. A host
 * reads the store's collections (Shopify Admin) and runs the vision pass
 * with its own model client; which images qualify, in what order, and what
 * the vision model is asked are decided here.
 */

import type { HarnessLifestyle } from "./core";

/** A collection as read from the Admin API: its own image plus metafields. */
export interface LifestyleCollection {
  title: string;
  image: { url: string; altText: string | null } | null;
  metafields: { nodes: { key: string; value: string }[] };
}

const CDN = "https://cdn.shopify.com/";

/**
 * Lifestyle room shots the store already owns: each collection's hero — a
 * metafield whose key names a hero/lifestyle image and holds a Shopify CDN
 * URL (e.g. a `hero_image_url` metafield), else the collection's own image.
 * Curated collections come first; collections named after a vendor are
 * artist/brand pages whose rooms show one maker, so they rank after. A hero
 * metafield beats the collection image. Store-hosted only — the runtime
 * refuses any other origin. Deduped by URL (query stripped); ties keep the
 * input order.
 */
export function rankLifestyleCandidates(collections: LifestyleCollection[], vendors: Iterable<string>, limit = 96): HarnessLifestyle[] {
  const vendorSet = new Set([...vendors].map((v) => v.trim().toLowerCase()));
  const rank = (n: LifestyleCollection, hero: boolean) => (vendorSet.has(n.title.trim().toLowerCase()) ? 2 : 0) + (hero ? 0 : 1);
  const seen = new Set<string>();
  const out: (HarnessLifestyle & { r: number; i: number })[] = [];
  collections.forEach((c, i) => {
    const hero = c.metafields.nodes.find((m) => /hero|lifestyle|room/i.test(m.key) && /^https:\/\/cdn\.shopify\.com\//.test(m.value.trim()));
    const src = (hero ? hero.value.trim() : c.image?.url)?.split("?")[0];
    if (!src || !src.startsWith(CDN) || seen.has(src)) return;
    seen.add(src);
    out.push({ title: c.title, imageSrc: src, imageAlt: c.image?.altText || `${c.title} — art in a room`, r: rank(c, !!hero), i });
  });
  return out
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map(({ title, imageSrc, imageAlt }) => ({ title, imageSrc, imageAlt }));
}

// ---------------------------------------------------------------------------
// Room-shot vision pass: which candidates are real room shots, and how well
// each would lead a premium welcome offer. The host sends each batch (label +
// thumbnail per image) with ROOM_SHOT_SYSTEM / ROOM_SHOT_INSTRUCTION under
// ROOM_SHOT_OUTPUT_SCHEMA; roomShotFits reads one answer; rankRoomShots
// orders the pooled results.
// ---------------------------------------------------------------------------

/** Images per vision call. */
export const ROOM_SHOT_BATCH = 12;

export const ROOM_SHOT_SYSTEM =
  "You sort a store's images for a first-visit welcome offer. A ROOM SHOT is a photograph or photoreal render of a furnished interior (living room, bedroom, dining, office, entry) with art on the wall. Not a room shot: flat artwork or product on plain ground, a portrait, a logo, text, a texture, an outdoor scene. For each room shot rate FIT 1–5 as the lead image of a premium welcome offer: 5 = calm, beautifully styled, art clearly the hero (a considered set or a statement piece), subject matter any shopper would welcome; 1 = cluttered, dim, or art whose subject could put a first-time visitor off (nudity, crude humour, violence).";

export const ROOM_SHOT_INSTRUCTION = 'Return {"rooms": [{"n": image number, "fit": 1-5}]} listing room shots only.';

export const ROOM_SHOT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    rooms: {
      type: "array",
      items: { type: "object", properties: { n: { type: "integer" }, fit: { type: "integer" } }, required: ["n", "fit"], additionalProperties: false },
    },
  },
  required: ["rooms"],
  additionalProperties: false,
};

/** The text label that precedes image `n` of a batch. */
export const roomShotLabel = (n: number, c: HarnessLifestyle) => `Image ${n}: ${c.title}`;

/** A small CDN thumbnail — the vision pass never needs the full image. */
export const roomShotThumbnail = (c: HarnessLifestyle) => `${c.imageSrc}?width=400`;

/** One batch's answer → the candidates that are room shots with fit ≥ 3.
 * Unknown indexes and malformed answers contribute nothing. */
export function roomShotFits(batch: HarnessLifestyle[], data: unknown): { c: HarnessLifestyle; fit: number }[] {
  const out: { c: HarnessLifestyle; fit: number }[] = [];
  for (const r of (data as { rooms?: { n: number; fit: number }[] } | null)?.rooms ?? []) {
    const c = Number.isInteger(r.n) ? batch[r.n] : undefined;
    if (c && r.fit >= 3) out.push({ c, fit: r.fit });
  }
  return out;
}

/** Best fit first; ties keep the candidate order (hero metafields first). */
export function rankRoomShots(scored: { c: HarnessLifestyle; fit: number }[], keep = 16): HarnessLifestyle[] {
  return scored
    .map((s, idx) => ({ ...s, idx }))
    .sort((a, b) => b.fit - a.fit || a.idx - b.idx)
    .slice(0, keep)
    .map((s) => s.c);
}
