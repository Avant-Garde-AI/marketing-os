/**
 * "Which image IS this campaign?" — one answer, shared by the calendar
 * projection and the contact sheet so a campaign looks the same wherever it's
 * thumbnailed.
 *
 * We take the first image the email actually shows, top-down. That is the hero
 * in every skeleton we ship, and when a skeleton has no hero it is still the
 * first thing a reader sees — which is exactly what a thumbnail is for. No
 * screenshotting: rendering a miniature of the whole email would need headless
 * Chrome in the deployment and a render per campaign, to produce something
 * less recognisable at 200px than the hero already is.
 *
 * Structural on purpose (a bare shape, not an imported type) — the canonical
 * Campaign in packages/skills and the console's lenient CampaignArtifact are
 * different types that both satisfy it.
 */

export interface HeroSectionLike {
  imageUrl?: string;
  blocks?: Array<Record<string, unknown>>;
}

/** Block keys that carry an image, in the renderer vocabulary. */
const IMAGE_KEYS = ["imageUrl", "src", "url"];

function imageFromBlock(block: Record<string, unknown>): string | null {
  for (const k of IMAGE_KEYS) {
    const v = block[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  // Composite blocks (productRow, graphCallout, swatches) carry their images
  // one level down in an items array.
  const items = block.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (item && typeof item === "object") {
        const found = imageFromBlock(item as Record<string, unknown>);
        if (found) return found;
      }
    }
  }
  return null;
}

/** First image the email shows, or null when it is all type. */
export function heroImageUrl(sections: HeroSectionLike[] | undefined): string | null {
  for (const s of sections ?? []) {
    if (typeof s.imageUrl === "string" && /^https?:\/\//i.test(s.imageUrl)) return s.imageUrl;
    for (const b of s.blocks ?? []) {
      const found = imageFromBlock(b);
      if (found) return found;
    }
  }
  return null;
}
