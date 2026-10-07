import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../templates/agents/lib/tenant-context", () => ({ getTenant: () => ({ githubRepo: "store/repo" }) }));
vi.mock("../templates/agents/lib/social/review-links", () => ({
  socialReviewLink: (_shop: string, id: string) => ({ url: `generic:${id}` }),
  socialCarouselReviewLink: (_shop: string, id: string) => ({ url: `carousel:${id}` }),
}));
vi.mock("../templates/agents/lib/email/review-links", () => ({ emailReviewLink: (_shop: string, id: string) => ({ url: `email:${id}` }) }));
import { calendarHrefFor, socialPostReviewHref } from "../templates/agents/lib/calendar/review-routes";
import type { SocialPost } from "../templates/agents/lib/social/types";
const post: SocialPost = { id: "post", groupId: "group", channel: "instagram", copy: "caption", assetRefs: [], targetLink: "https://store.example", provenance: [], status: "asset_ready", body: "" };
describe("social review routing", () => {
  it("opens the record from a calendar without assuming a carousel manifest", () => {
    expect(calendarHrefFor("social", post.id, "store.myshopify.com")).toBe("/social/posts/post");
    expect(calendarHrefFor("email", "campaign", "store.myshopify.com")).toBe("email:campaign");
  });
  it("uses generic group review for legacy creative and loops", () => {
    expect(socialPostReviewHref(post, "store.myshopify.com")).toBe("generic:group");
    expect(socialPostReviewHref({ ...post, renderedVideo: { origin: "generation-delivery" } as SocialPost["renderedVideo"] }, "store.myshopify.com")).toBe("generic:group");
  });
  it("uses the manifest-bound review only for a generation carousel receipt", () => {
    expect(socialPostReviewHref({ ...post, renderedSequence: { origin: "generation-delivery" } as SocialPost["renderedSequence"] }, "store.myshopify.com")).toBe("carousel:post");
  });
});
