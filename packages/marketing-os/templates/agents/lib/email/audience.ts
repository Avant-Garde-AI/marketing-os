/**
 * Turning an audience id into something a human can review.
 *
 * A campaign artifact used to record its audience as `{ type: list, id: HRSdjT }`
 * and nothing more. The review room dutifully rendered `HRSdjT` and a dash for
 * the size, which is unreviewable: nobody can judge whether a campaign should
 * send without knowing who receives it and roughly how many. The data was
 * always one API call away; the authoring path simply never asked.
 *
 * Resolution happens at WRITE time, not at render time, for two reasons:
 *
 *   - The artifact lives in the store repo. Someone reading `campaign.md` in a
 *     pull request should understand the audience without Klaviyo credentials.
 *     A file that needs an API call to be legible isn't really a file.
 *   - Rendering is a hot path with a strict deadline; a Klaviyo round-trip per
 *     page view would make the review room slow and rate-limit-prone for a
 *     value that barely changes.
 *
 * The cost is staleness, which is why the size travels with the date it was
 * true. A count with no date is its own small lie — it invites a reader to
 * believe a number that may be months old.
 */

import type { CampaignAudience, CampaignAudienceRef, StrategyAudience } from "./types";
import { createKlaviyoClient } from "./klaviyo-client";

/** Audience list is small and changes slowly; one fetch per process is plenty. */
let cache: { at: number; byId: Map<string, { name: string; count?: number }> } | null = null;
const TTL_MS = 5 * 60 * 1000;

async function audienceIndex(): Promise<Map<string, { name: string; count?: number }>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byId;
  const byId = new Map<string, { name: string; count?: number }>();
  try {
    const audiences = await createKlaviyoClient().listAudiences();
    for (const a of audiences) {
      byId.set(a.id, { name: a.name, ...(a.profileCount != null ? { count: a.profileCount } : {}) });
    }
    cache = { at: Date.now(), byId };
  } catch (e) {
    // Degrade to unresolved rather than failing the write — but SAY SO, because
    // an unresolved audience silently looks identical to one that was never
    // resolvable, and that ambiguity is what made this bug survive.
    console.error(
      "[email/audience] could not reach Klaviyo to resolve audience names; " +
        "artifact will keep bare ids:",
      e instanceof Error ? e.message : e,
    );
  }
  return byId;
}

function resolveOne(
  ref: CampaignAudienceRef,
  index: Map<string, { name: string; count?: number }>,
  asOf: string,
): CampaignAudienceRef {
  const hit = index.get(ref.id);
  if (!hit) return ref; // unknown id: leave it exactly as the caller gave it
  return {
    ...ref,
    name: hit.name,
    ...(hit.count != null ? { estimatedSize: hit.count } : {}),
    ...(hit.count != null ? { sizeAsOf: asOf } : {}),
  } as CampaignAudienceRef;
}

export interface ResolveResult {
  audience: CampaignAudience;
  /** False when Klaviyo could not be reached — every id is then unverifiable,
   *  which is NOT the same as every id being wrong. */
  reachedKlaviyo: boolean;
  /** Ids Klaviyo does not know, when Klaviyo WAS reached. */
  unknown: string[];
}

/**
 * Fill in `name`, `estimatedSize` and `sizeAsOf` on every audience reference.
 * Ids the store doesn't recognise pass through untouched — inventing a name for
 * an id Klaviyo has never heard of would be worse than showing the id — but
 * they are reported, because passing one through silently is how a made-up
 * audience reached a committed artifact (see reconcileWithStrategy).
 */
export async function resolveAudienceRefs(audience: CampaignAudience): Promise<ResolveResult> {
  const index = await audienceIndex();
  if (index.size === 0) return { audience, reachedKlaviyo: false, unknown: [] };
  // Quoted on write elsewhere; kept as a plain ISO date string here. YAML would
  // otherwise round-trip an unquoted 2026-09-01 back as a Date, which is not a
  // renderable value — see asAudienceRefs in console-data.ts.
  const asOf = new Date().toISOString().slice(0, 10);
  const all = [...audience.included, ...(audience.excluded ?? [])];
  return {
    audience: {
      included: audience.included.map((r) => resolveOne(r, index, asOf)),
      ...(audience.excluded
        ? { excluded: audience.excluded.map((r) => resolveOne(r, index, asOf)) }
        : {}),
    },
    reachedKlaviyo: true,
    unknown: [...new Set(all.filter((r) => !index.has(r.id)).map((r) => r.id))],
  };
}

/**
 * Correct audience references against the store's own strategy roster.
 *
 * A model asked to write a campaign knows the audience it wants by NAME — the
 * strategy describes "Campaign - Full Reach — every reachable contact" in prose
 * — and the id is an opaque six-character Klaviyo code it has no way to recall.
 * The first end-to-end console run wrote `{ type: list, id: XyZ123 }` with the
 * right label attached: it had read the roster, understood which audience the
 * campaign wanted, and filled the one field it could not know with a plausible
 * shape. Nothing downstream objected, so a placeholder id was committed to git
 * inside an otherwise correct campaign.
 *
 * The roster is the authority, so this matches on what the model CAN get right
 * — the key, or the label against the roster's key and description — and takes
 * the id and type from the strategy. Matching by id also runs, because a right
 * id paired with the wrong type (`list` where the store has a `segment`) sends
 * to nothing and is the same class of near-miss.
 *
 * Refs that match no roster entry are returned untouched. This corrects; it
 * does not judge. Whether an unrecognised id may be written is the caller's
 * decision, made with `resolveAudienceRefs`'s report in hand.
 */
export function reconcileWithStrategy(
  audience: CampaignAudience,
  roster: StrategyAudience[],
): { audience: CampaignAudience; corrections: string[] } {
  if (roster.length === 0) return { audience, corrections: [] };
  const corrections: string[] = [];

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // `label` is the agent's own words for the audience, accepted by the upsert
  // tool's schema and serialised onto the artifact, but deliberately not part of
  // CampaignAudienceRef — `name` is reserved for the name Klaviyo returns, and
  // conflating what a model called something with what the ESP calls it is how
  // an unresolved audience starts looking resolved.
  const labelOf = (ref: CampaignAudienceRef): string | undefined => {
    const v = (ref as { label?: unknown }).label;
    return typeof v === "string" ? v : undefined;
  };

  const fix = (ref: CampaignAudienceRef): CampaignAudienceRef => {
    const label = norm(labelOf(ref) ?? ref.name ?? "");
    const key = norm(ref.key ?? "");
    const match = roster.find((a) => {
      if (a.klaviyoRef.id === ref.id) return true;
      const aKey = norm(a.key);
      if (aKey && (aKey === key || aKey === label)) return true;
      // The description opens with the audience's Klaviyo name, before the em
      // dash that starts the prose — "Campaign - Full Reach — every reachable…".
      const aName = norm((a.description ?? "").split("—")[0] ?? "");
      return Boolean(aName && label && aName === label);
    });
    if (!match) return ref;

    if (!ref.id) {
      // A key-only ref, which is the shape the planner hands over. Nothing was
      // wrong with it, so this is not a correction.
    } else if (match.klaviyoRef.id !== ref.id) {
      corrections.push(
        `audience "${labelOf(ref) ?? ref.name ?? ref.key ?? ref.id}": id ${ref.id} is not in the store's strategy; used ${match.klaviyoRef.id} (roster key "${match.key}")`,
      );
    } else if (match.klaviyoRef.type !== ref.type) {
      corrections.push(
        `audience ${ref.id}: strategy declares it a ${match.klaviyoRef.type}, not a ${ref.type}`,
      );
    }
    return { ...ref, type: match.klaviyoRef.type, id: match.klaviyoRef.id, key: match.key };
  };

  return {
    audience: {
      included: audience.included.map(fix),
      ...(audience.excluded ? { excluded: audience.excluded.map(fix) } : {}),
    },
    corrections,
  };
}
