/**
 * Artist profiles, read from the store's own artist collection.
 *
 * An artist drop that opens with a room shot and no artist is a product email
 * wearing an editorial hat. The store already publishes everything needed — the
 * artist collection page (sections/artist-hero.liquid) composes a portrait, a
 * location, an italic pull-quote, a works count and the collections an artist
 * appears in — so the email should show the same person the site does, from the
 * same source, rather than a second version that drifts.
 *
 * WHERE THE FIELDS COME FROM (mirroring artist-hero.liquid exactly):
 *   portrait          collection.image
 *   worksCount        collection.products_count
 *   location          metafields.arthaus.location
 *   pullQuote         metafields.arthaus.pull_quote
 *   headline          metafields.arthaus.headline
 *   curatorialNote    metafields.arthaus.curatorial_note
 *   heroImageUrl      metafields.arthaus.hero_image_url   (best-seller-in-room)
 *   collectionsCount  metafields.arthaus.appears_in.length
 *
 * Everything is optional. A store that has not filled these in gets a thinner
 * card, not a broken one — and the caller is told which fields were missing so
 * "the artist has no bio" is distinguishable from "we could not reach Shopify".
 */

import { getShopifyClient } from "../shopify";

export interface ArtistProfile {
  handle: string;
  name: string;
  portraitUrl?: string;
  heroImageUrl?: string;
  location?: string;
  pullQuote?: string;
  headline?: string;
  curatorialNote?: string;
  worksCount?: number;
  collectionsCount?: number;
  url: string;
  /** Fields the store has not filled in — so a thin card is legible as a
   *  content gap rather than a bug. */
  missing: string[];
}

const QUERY = `
  query ArtistCollection($handle: String!) {
    collectionByHandle(handle: $handle) {
      id
      title
      handle
      productsCount { count }
      image { url altText }
      location:       metafield(namespace: "arthaus", key: "location")        { value }
      pullQuote:      metafield(namespace: "arthaus", key: "pull_quote")      { value }
      headline:       metafield(namespace: "arthaus", key: "headline")        { value }
      curatorialNote: metafield(namespace: "arthaus", key: "curatorial_note") { value }
      heroImageUrl:   metafield(namespace: "arthaus", key: "hero_image_url")  { value }
      appearsIn:      metafield(namespace: "arthaus", key: "appears_in")      { value }
    }
  }
`;

interface MetafieldNode {
  value?: string | null;
}
interface CollectionNode {
  title?: string;
  handle?: string;
  productsCount?: { count?: number } | null;
  image?: { url?: string } | null;
  location?: MetafieldNode | null;
  pullQuote?: MetafieldNode | null;
  headline?: MetafieldNode | null;
  curatorialNote?: MetafieldNode | null;
  heroImageUrl?: MetafieldNode | null;
  appearsIn?: MetafieldNode | null;
}

/** `appears_in` is a JSON list metafield; tolerate both a list and a scalar. */
function countAppearsIn(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
  } catch {
    /* not JSON — fall through */
  }
  return undefined;
}

/** Artist name → collection handle, matching how the store slugs them. */
export function artistHandle(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function readArtistProfile(nameOrHandle: string): Promise<ArtistProfile | null> {
  const handle = /^[a-z0-9-]+$/.test(nameOrHandle) ? nameOrHandle : artistHandle(nameOrHandle);
  let node: CollectionNode | null = null;
  try {
    const res = await getShopifyClient().graphql<{ collectionByHandle: CollectionNode | null }>(
      QUERY,
      { handle },
    );
    // GraphQL 200s carry errors in the body; surfacing them as "no such artist"
    // would report a permissions or schema problem as missing content.
    if (res?.errors?.length) {
      throw new Error(res.errors.map((e) => e.message).join("; "));
    }
    node = res?.data?.collectionByHandle ?? null;
  } catch (e) {
    // Reaching Shopify failed. That is NOT the same as "no such artist", and
    // conflating them is how a content gap gets misdiagnosed as a data gap.
    console.error(
      `[artist-profile] Shopify read failed for "${handle}":`,
      e instanceof Error ? e.message : e,
    );
    throw new Error(`could not reach Shopify to read artist "${handle}"`);
  }
  if (!node) return null;

  const missing: string[] = [];
  const pick = (v: string | null | undefined, label: string): string | undefined => {
    const t = (v ?? "").trim();
    if (!t) {
      missing.push(label);
      return undefined;
    }
    return t;
  };

  const profile: ArtistProfile = {
    handle: node.handle ?? handle,
    name: node.title ?? nameOrHandle,
    url: `https://shop.myarthaus.com/collections/${node.handle ?? handle}`,
    missing,
  };
  const portrait = pick(node.image?.url, "portrait");
  if (portrait) profile.portraitUrl = portrait;
  const hero = pick(node.heroImageUrl?.value, "heroImage");
  if (hero) profile.heroImageUrl = hero;
  const loc = pick(node.location?.value, "location");
  if (loc) profile.location = loc;
  const quote = pick(node.pullQuote?.value, "pullQuote");
  if (quote) profile.pullQuote = quote;
  const head = pick(node.headline?.value, "headline");
  if (head) profile.headline = head;
  const note = pick(node.curatorialNote?.value, "curatorialNote");
  if (note) profile.curatorialNote = note;

  const works = node.productsCount?.count;
  if (typeof works === "number") profile.worksCount = works;
  const collections = countAppearsIn(node.appearsIn?.value);
  if (collections !== undefined) profile.collectionsCount = collections;

  return profile;
}

/** Shape a profile into the email-assembly `artistCard` block. */
export function toArtistCardBlock(p: ArtistProfile): Record<string, unknown> {
  return {
    kind: "artistCard",
    name: p.name,
    href: p.url,
    ...(p.portraitUrl ? { portraitUrl: p.portraitUrl } : {}),
    ...(p.location ? { location: p.location } : {}),
    // The pull-quote is the artist's own editorial line on the site; prefer it
    // over the curatorial note, which is written about them rather than for
    // them, and reads oddly in the artist's own card.
    ...(p.pullQuote ? { quote: p.pullQuote } : p.headline ? { quote: p.headline } : {}),
    ...(p.worksCount ? { worksCount: p.worksCount } : {}),
    ...(p.collectionsCount ? { collectionsCount: p.collectionsCount } : {}),
  };
}
