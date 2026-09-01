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

import type { CampaignAudience, CampaignAudienceRef } from "./types";
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

/**
 * Fill in `name`, `estimatedSize` and `sizeAsOf` on every audience reference.
 * Ids the store doesn't recognise pass through untouched — inventing a name for
 * an id Klaviyo has never heard of would be worse than showing the id.
 */
export async function resolveAudienceRefs(audience: CampaignAudience): Promise<CampaignAudience> {
  const index = await audienceIndex();
  if (index.size === 0) return audience;
  // Quoted on write elsewhere; kept as a plain ISO date string here. YAML would
  // otherwise round-trip an unquoted 2026-09-01 back as a Date, which is not a
  // renderable value — see asAudienceRefs in console-data.ts.
  const asOf = new Date().toISOString().slice(0, 10);
  return {
    included: audience.included.map((r) => resolveOne(r, index, asOf)),
    ...(audience.excluded
      ? { excluded: audience.excluded.map((r) => resolveOne(r, index, asOf)) }
      : {}),
  };
}
