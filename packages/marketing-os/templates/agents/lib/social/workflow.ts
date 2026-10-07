import type { SocialPost } from "./types";

export const SOCIAL_STAGES = ["draft", "ready", "scheduled", "published", "attention", "closed"] as const;
export type SocialStage = typeof SOCIAL_STAGES[number];
export const SOCIAL_STAGE_LABELS: Record<SocialStage, string> = {
  draft: "Draft proposals", ready: "Ready for review", scheduled: "Scheduled",
  published: "Published", attention: "Needs attention", closed: "Closed",
};

/** Display state only: never creates approval or advances a post lifecycle. */
export function socialWorkflow(post: SocialPost, now = Date.now()): {
  stage: SocialStage; label: string; explanation: string; variant: "filled" | "outline" | "attention";
} {
  if (post.status === "published" || post.status === "measured")
    return { stage: "published", label: "Published", explanation: "This post has been published. Open the live post below when its link is available.", variant: "filled" };
  if (post.publishAttempt?.state === "started" || post.publishAttempt?.state === "unknown")
    return { stage: "attention", label: "Delivery needs checking", explanation: "A publish attempt is unresolved. Check the delivery record and Instagram before retrying.", variant: "attention" };
  if (post.status === "failed")
    return { stage: "attention", label: "Failed", explanation: post.failure || "Publication failed. Review the record before trying again.", variant: "attention" };
  if (post.status === "scheduled") {
    const due = Date.parse(post.scheduledAt ?? "");
    if (!Number.isFinite(due))
      return { stage: "attention", label: "Schedule needs checking", explanation: "The post is marked scheduled but has no valid release time.", variant: "attention" };
    if (now > due + 15 * 60_000)
      return { stage: "attention", label: "Scheduled · overdue", explanation: "The release time has passed without a publication receipt. Check delivery; do not blindly retry.", variant: "attention" };
    return { stage: "scheduled", label: "Scheduled", explanation: "Approved for automatic publication at the release time below. No further approval is needed.", variant: "attention" };
  }
  if (post.status === "asset_ready")
    return { stage: "ready", label: "Ready for review", explanation: "Media and copy are prepared. Publishing or scheduling still needs your approval.", variant: "attention" };
  if (post.status === "declined" || post.status === "cancelled")
    return { stage: "closed", label: post.status === "declined" ? "Declined" : "Cancelled", explanation: "This post is not queued for publication.", variant: "outline" };
  return { stage: "draft", label: post.status === "approved" ? "Creative approved" : "Draft proposal",
    explanation: post.status === "approved" ? "The creative direction is approved. Final media and a publishing or scheduling approval are still needed." : "A proposed idea or copy draft. It is not approved or queued for publication.", variant: "outline" };
}

export function socialStoryPrompt(postId?: string): string {
  return `${postId ? `Help me improve the narrative for social post ${postId}. Preserve its current approved or published version and propose a revision.` : "Help me develop a new social story from our catalog and social concepts."} Ask me for the reader payoff, mood, format, reference examples, and what must stay true to the artwork. Propose three distinct storyboard directions, explain what each beat adds, and compare their strengths and weaknesses before any new imagery generation.`;
}
