import { it, expect } from "vitest";
import { parsePost, serializePost } from "../src/artifacts";
import { postCalendarProjection, postIndexRow } from "../src/projection";
import { approvalHash } from "../src/actions";
import type { SocialPost } from "../src/types";
it("shows the intended date without scheduling or granting consent", () => {
 const post: SocialPost = { id: "dated", channel: "instagram", copy: "Ready", assetRefs: [], targetLink: "https://example.com", status: "asset_ready", provenance: [], body: "", plannedAt: "2099-01-04T15:00:00Z" };
 expect(parsePost(serializePost(post))).toEqual(post);expect(postCalendarProjection(post).scheduledAt).toBe(post.plannedAt);expect(postIndexRow(post).scheduledAt).toBeNull();
 const hash=approvalHash(post);post.plannedAt="2099-01-05T15:00:00Z";expect(approvalHash(post)).toBe(hash);
 post.scheduledAt="2099-01-06T15:00:00Z";expect(postCalendarProjection(post).scheduledAt).toBe(post.scheduledAt);expect(approvalHash(post)).not.toBe(hash);
});
