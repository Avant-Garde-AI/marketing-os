import "server-only";

import { getTenant } from "../tenant-context";
import { detailRouteFor } from "./routes";
import { emailReviewLink } from "../email/review-links";
import { socialReviewLink, socialCarouselReviewLink } from "../social/review-links";
import type { SocialPost } from "../social/types";
import { groupKey } from "../social/projection";

/**
 * Where a calendar card clicks through to.
 *
 * A card's job is "let me look at this", and for planned work that means the
 * review room — the creative, the copy that would ship, and where notes get
 * left. Detail is the record; review is the verb, and detail stays reachable
 * from there.
 *
 * SERVER ONLY, and that is why this is not in routes.ts. Review links are
 * token-gated, so building one needs an HMAC secret — and routes.ts is imported
 * by calendar-view.tsx, a client component. Putting the minting there pulled
 * node:crypto into the browser bundle and broke the build, which is the correct
 * outcome: a client component must never be one import away from a signing key.
 * The page resolves hrefs and passes them down as data.
 */
export const channelReviewRoute: Record<string, (itemId: string, shop: string) => string> = {
  // A social review room is keyed by GROUP. For an ungrouped post the group key
  // IS the post id, and loadPostGroup resolves a member id to its group, so an
  // item id is always a valid key.
  // The index cannot distinguish carousel manifests, loops and legacy boards.
  // The authenticated post record shows final media and chooses its real review route.
  social: (itemId) => detailRouteFor("social", itemId)!,
  email: (itemId, shop) => emailReviewLink(shop, itemId).url,
};

/** Receipt-aware routing: a repo-scoped carousel link must never stand in for a generic/loop review. */
export function socialPostReviewHref(post: SocialPost, shop: string): string {
  const repo = getTenant().githubRepo ?? process.env.GITHUB_REPO;
  if (repo && post.renderedSequence && "origin" in post.renderedSequence && post.renderedSequence.origin === "generation-delivery")
    return socialCarouselReviewLink(shop, post.id, repo).url;
  return socialReviewLink(shop, groupKey(post)).url;
}

export function calendarHrefFor(channel: string, itemId: string, shop: string): string | null {
  const review = channelReviewRoute[channel];
  if (review && shop) {
    try {
      return review(itemId, shop);
    } catch {
      // A minting failure must not cost the card its link — fall through to the
      // detail route, which needs no secret.
    }
  }
  return detailRouteFor(channel, itemId);
}
