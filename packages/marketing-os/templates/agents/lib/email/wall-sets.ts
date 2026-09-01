/**
 * Gallery wall sets — reading the store's own curated arrangements and picking
 * the ones a campaign should show.
 *
 * The data already exists and is good: `assets/gallery-wall-sets.json` in the
 * store repo carries ~86 sets across ~30 rooms, each with a rationale, a
 * narrative, palette, tags, piece list with artists, room photography, pricing
 * and savings. Nothing here generates a set; it selects among sets a curator
 * already composed, which is the right division — a wall that hangs together is
 * a judgement, not a query result.
 *
 * WHY IT READS FROM THE REPO ROOT. The file sits at `assets/…`, outside the
 * `STORE_REPO_PREFIX` that scopes the email pack's artifacts. Rather than widen
 * that prefix — which would let campaign writes escape their directory — this
 * module reads the one path it needs directly, read-only.
 */

import { gitBindingFor } from "../store-repo";

export interface WallSetPiece {
  handle: string;
  title: string;
  artist?: string;
  image_url?: string;
  price?: number;
}

export interface WallSet {
  id: string;
  name: string;
  room_name?: string;
  room_handle?: string;
  rationale?: string;
  narrative?: string;
  piece_count?: number;
  price?: string;
  savings?: number;
  tags?: string[];
  palette?: { primary?: string; secondary?: string; accent?: string };
  image_url?: string;
  lifestyle_image_url?: string;
  url?: string;
  deep_dive_url?: string;
  pieces?: WallSetPiece[];
  artists?: Array<{ name: string; handle?: string }>;
}

const SETS_PATH = "assets/gallery-wall-sets.json";
let cache: { at: number; sets: WallSet[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** All sets, flattened out of the room-keyed file. */
export async function loadWallSets(tenantRepo?: string | null): Promise<WallSet[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.sets;
  const binding = await gitBindingFor(tenantRepo);
  if (!binding) return [];
  const url =
    `https://api.github.com/repos/${binding.repo}/contents/${encodeURI(SETS_PATH)}` +
    (binding.branch ? `?ref=${encodeURIComponent(binding.branch)}` : "");
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${binding.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      // Say which failure this is. "No sets" and "could not read the sets file"
      // look identical downstream, and that ambiguity has cost this codebase
      // real time before.
      console.error(`[wall-sets] could not read ${SETS_PATH} from ${binding.repo}: HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as { content?: string };
    const raw = Buffer.from((json.content ?? "").replace(/\n/g, ""), "base64").toString("utf-8");
    const byRoom = JSON.parse(raw) as Record<string, WallSet[]>;
    const sets = Object.values(byRoom).flat().filter((s) => s && s.id && s.name);
    cache = { at: Date.now(), sets };
    return sets;
  } catch (e) {
    console.error("[wall-sets] parse/read failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

export interface WallSetQuery {
  /** Campaign theme, e.g. "autumn ochre rust and sage". Matched against tags,
   *  room name, rationale and narrative. */
  concept?: string;
  /** Prefer sets featuring this artist — the artist-drop case. */
  artist?: string;
  limit?: number;
}

const STOP = new Set([
  "and","the","a","an","of","in","for","with","to","our","this","that","from","into","on",
]);

function terms(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Rank sets against a campaign.
 *
 * Scoring is deliberately transparent — an artist match dominates, then tags,
 * then prose — so a human reading `why` can tell whether the pick was earned or
 * incidental. Sets with no room photography are dropped: a wall set that cannot
 * show the wall has nothing to say in an email.
 */
export function rankWallSets(sets: WallSet[], q: WallSetQuery): Array<WallSet & { why: string }> {
  const wanted = q.concept ? terms(q.concept) : [];
  const artist = q.artist?.toLowerCase().trim();

  const scored = sets
    .filter((s) => (s.image_url ?? s.lifestyle_image_url ?? "").startsWith("http"))
    .map((s) => {
      const reasons: string[] = [];
      let score = 0;

      if (artist && (s.artists ?? []).some((a) => a.name?.toLowerCase() === artist)) {
        score += 100;
        reasons.push(`features ${q.artist}`);
      }
      const tagHits = (s.tags ?? []).filter((t) => wanted.some((w) => t.toLowerCase().includes(w)));
      if (tagHits.length) {
        score += 10 * tagHits.length;
        reasons.push(`tagged ${tagHits.join(", ")}`);
      }
      const prose = `${s.room_name ?? ""} ${s.rationale ?? ""} ${s.narrative ?? ""}`.toLowerCase();
      const proseHits = wanted.filter((w) => prose.includes(w));
      if (proseHits.length) {
        score += proseHits.length;
        reasons.push(`echoes ${proseHits.slice(0, 3).join(", ")}`);
      }
      return { ...s, score, why: reasons.join("; ") || "no thematic overlap" };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, q.limit ?? 3).map(({ score: _score, ...rest }) => rest);
}

/** Shape a set into the email-assembly `wallSet` block. */
export function toWallSetBlock(s: WallSet): Record<string, unknown> {
  const artists = [...new Set((s.artists ?? []).map((a) => a.name).filter(Boolean))];
  return {
    kind: "wallSet",
    name: s.name,
    // deep_dive_url is the editorial page; url is a prefilled cart. An email
    // should open the story, not silently fill a basket.
    href: absolute(s.deep_dive_url ?? s.url ?? "/collections/all"),
    imageUrl: s.image_url ?? s.lifestyle_image_url ?? "",
    ...(s.room_name ? { room: s.room_name } : {}),
    ...(s.rationale ? { rationale: s.rationale.slice(0, 300) } : {}),
    ...(s.piece_count ? { pieceCount: s.piece_count } : {}),
    ...(s.price ? { price: s.price } : {}),
    ...(artists.length ? { artists } : {}),
  };
}

function absolute(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `https://shop.myarthaus.com${path.startsWith("/") ? "" : "/"}${path}`;
}
