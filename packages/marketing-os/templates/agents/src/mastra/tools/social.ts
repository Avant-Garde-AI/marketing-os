// Social planning read tools (spec 24 SM0 — "reads compose freely", spec 20
// §3). Wraps the canonical skill pack's runtime-agnostic tool definitions
// (packages/skills/social-media, vendored at lib/social) in Mastra createTool,
// bound to the tenant's SocialRepo.
//
// UNGATED reads: social_plan_propose returns a proposal (structure + the
// serialized calendar draft) without persisting anything; the calendar/post
// reads answer over what exists. Approve/schedule/publish are SM2 Actions on
// the spec 20 framework.
//
// The one write here is social_link_design (SM1 design-link glue, spec 24
// §3): it records which composed Design Surface a planned post's creative
// lives on. Drafts are free by construction (spec 23 §2) — binding a draft to
// a post is bookkeeping, not a store-facing Action, so it stays ungated.
//
// Unlike the design-surface tools these keep the canonical throw-on-missing
// behavior: the error text ("social/strategy.md not found — co-create the
// social strategy first") is the message the agent needs to relay.

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createSocialTools } from "../../../lib/social/tools";
import {
  linkDesignToPost,
  parsePost,
  postPath,
  serializePost,
} from "../../../lib/social/artifacts";
import { socialRepo } from "../../../lib/social/repo";
import type { SkillToolDefinition } from "../../../lib/social/types";

const defs = createSocialTools(socialRepo);

/** SkillToolDefinition → Mastra tool (the wrap the pack's types.ts describes). */
function toMastraTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: SkillToolDefinition<I, O>
) {
  return createTool({
    id: def.id,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    execute: (input: z.infer<I>) => def.execute(input),
  });
}

/** Console-relative Design Studio path — same construction as
 * design-surfaces.ts studioPath (spec 23 DS4: the console owns the Studio
 * URL; /studio embeds the canvas next to chat). */
function studioPath(teamId: string, fileId: string, pageId?: string): string {
  const qs = new URLSearchParams({ "team-id": teamId, "file-id": fileId });
  if (pageId) qs.set("page-id", pageId);
  return `/studio?${qs.toString()}`;
}

const socialLinkDesign = createTool({
  id: "social_link_design",
  description:
    "Attach a composed Design Surface to a planned social post: records designSurface {teamId, fileId, pageId} " +
    "in social/posts/{id}/post.md so the post's console calendar entry links to the draft ('Open in Studio'). " +
    "Call this right after compose_design_surface whenever the draft is FOR a planned post (compose with kind " +
    "'social.post' and boundToId = the post id), completing the plan → compose → calendar loop. " +
    "Relinking replaces any previous binding. Returns the console-relative studioPath for the draft.",
  inputSchema: z.object({
    postId: z.string().min(1).describe("The planned post's id (social/posts/{id}/post.md)"),
    teamId: z.string().min(1).describe("Design Studio team id, as returned by compose_design_surface"),
    fileId: z.string().min(1).describe("Design file id, as returned by compose_design_surface"),
    pageId: z
      .string()
      .min(1)
      .optional()
      .describe("Page id, as returned by compose_design_surface (defaults to the file's first page)"),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    postId: z.string(),
    studioPath: z
      .string()
      .describe("Console-relative Design Studio link for the post's draft — prefer this when linking the user"),
  }),
  execute: async (input: { postId: string; teamId: string; fileId: string; pageId?: string }) => {
    const path = postPath(input.postId);
    const raw = await socialRepo.readFile(path);
    if (raw === null) {
      throw new Error(
        `social_link_design: post "${input.postId}" not found (${path}) — check the id against the month's calendar with social_calendar_read`
      );
    }
    const linked = linkDesignToPost(parsePost(raw), {
      teamId: input.teamId,
      fileId: input.fileId,
      ...(input.pageId !== undefined ? { pageId: input.pageId } : {}),
    });
    await socialRepo.writeFile(path, serializePost(linked));
    return {
      ok: true as const,
      postId: input.postId,
      studioPath: studioPath(input.teamId, input.fileId, input.pageId),
    };
  },
});

export const socialTools = {
  social_plan_propose: toMastraTool(defs.social_plan_propose),
  social_calendar_read: toMastraTool(defs.social_calendar_read),
  social_post_read: toMastraTool(defs.social_post_read),
  social_link_design: socialLinkDesign,
};
