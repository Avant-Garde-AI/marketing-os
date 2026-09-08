/**
 * Leaning-frame mockups, and getting the frame colour right.
 *
 * The store's mockup engine renders each artwork leaning against a wall in
 * several frame colourways — black, oak, walnut, white — and publishes them as
 * Shopify files named:
 *
 *   mockup-{id}-{handle}-leaning-leaning--{frame}--{orientation}-{ts}.jpg
 *
 * The WHITE colourway is currently broken: the frame disappears against the
 * wall, so the artwork reads as floating in a blank panel and looks like a
 * printing fault. One shipped in the Labor Day callout beside a walnut and a
 * black frame and was the only thing anyone noticed about the email.
 *
 * Leaning mockups stay the default for campaign imagery — they are the best
 * thing the store has, and the format was never the problem. So rather than
 * avoid them, this finds the same artwork in a frame that renders, and only
 * gives up when the library genuinely has nothing else.
 *
 * ## Why this reads Shopify files rather than product media
 *
 * These mockups are store FILES, not product media: they do not appear on the
 * product's `media` connection, and the filename is the only place the frame
 * colour is recorded. A sample of the library found ~24% of leaning mockups are
 * white, and about a quarter of artworks have no non-white leaning render at
 * all — so a correction has to be able to fail, and say so.
 */

import { getShopifyClient } from "../shopify";

/** Preference order. Black and walnut sit closest to the store's own art
 *  direction; oak is lighter but still reads as a frame. White is excluded
 *  entirely — it is the defect this module exists for. */
const FRAME_PREFERENCE = ["black", "walnut", "oak"] as const;

const MOCKUP_RE = /mockup-\d+-(.+?)-leaning-leaning--([a-z]+)--([a-z]+)-/i;

export interface MockupSwap {
  from: string;
  to?: string;
  handle: string;
  fromFrame: string;
  toFrame?: string;
}

/** True when this URL is a leaning mockup in the broken white colourway. */
export function isWhiteLeaningMockup(url: string): boolean {
  return /leaning/i.test(url) && /--white--/i.test(url);
}

function parse(url: string): { handle: string; frame: string; orientation: string } | null {
  const m = MOCKUP_RE.exec(url);
  if (!m) return null;
  return { handle: m[1]!.toLowerCase(), frame: m[2]!.toLowerCase(), orientation: m[3]!.toLowerCase() };
}

const FILES_QUERY = `
  query LeaningMockups($q: String!) {
    files(first: 60, query: $q) {
      nodes { ... on MediaImage { image { url } } }
    }
  }
`;

/** Cache per process: a campaign often repeats the same piece across blocks. */
const cache = new Map<string, string[]>();

async function mockupsFor(handle: string): Promise<string[]> {
  const hit = cache.get(handle);
  if (hit) return hit;
  let urls: string[] = [];
  try {
    const res = await getShopifyClient().graphql<{
      files: { nodes: Array<{ image?: { url?: string } }> };
    }>(FILES_QUERY, { q: `${handle}-leaning` });
    if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
    urls = (res?.data?.files?.nodes ?? [])
      .map((n) => n.image?.url ?? "")
      .filter((u) => {
        const p = parse(u);
        // Shopify's file search is fuzzy: "alien-1-leaning" also returns
        // "alien-10-leaning". Match the handle exactly or a swap silently
        // shows a different artwork.
        return p !== null && p.handle === handle;
      });
  } catch (e) {
    console.error(`[leaning-mockups] could not list mockups for "${handle}":`, e instanceof Error ? e.message : e);
  }
  cache.set(handle, urls);
  return urls;
}

/**
 * Given a white leaning mockup, find the same artwork in a frame that renders.
 * Returns undefined when the library has no non-white render — the caller
 * should then warn rather than silently ship the white one.
 */
export async function betterFrame(url: string): Promise<MockupSwap | undefined> {
  const parsed = parse(url);
  if (!parsed || parsed.frame !== "white") return undefined;
  const all = await mockupsFor(parsed.handle);
  const byFrame = new Map<string, string[]>();
  for (const u of all) {
    const p = parse(u);
    if (!p) continue;
    const list = byFrame.get(p.frame) ?? [];
    list.push(u);
    byFrame.set(p.frame, list);
  }
  for (const frame of FRAME_PREFERENCE) {
    const options = byFrame.get(frame);
    if (!options?.length) continue;
    // Prefer the same orientation, so a portrait card does not become landscape
    // and change the row's rhythm.
    const sameShape = options.find((u) => parse(u)?.orientation === parsed.orientation);
    return {
      from: url,
      to: sameShape ?? options[0]!,
      handle: parsed.handle,
      fromFrame: "white",
      toFrame: frame,
    };
  }
  return { from: url, handle: parsed.handle, fromFrame: "white" };
}
