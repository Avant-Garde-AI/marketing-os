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
import { upsertPost } from "../../../lib/social/authoring";
import { syncPostIndex } from "../../../lib/social/index-sync";
import { getTenant } from "../../../lib/tenant-context";
import type { SkillToolDefinition } from "../../../lib/social/types";
// Importing this module also registers the pack's three publish Actions with
// the propose_action registry (SM2 — same pattern as tools/email.ts).
import "../../../lib/social/register-actions";

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
    // Binding a creative changes the post's calendar thumbnail, so the index
    // must follow the write or the grid keeps rendering a text card for a post
    // that now has art (spec 26 failure mode 2).
    await syncPostIndex(getTenant().shop, linked);
    return {
      ok: true as const,
      postId: input.postId,
      studioPath: studioPath(input.teamId, input.fileId, input.pageId),
    };
  },
});

const socialPostUpsert = createTool({
  id: "social_post_upsert",
  description:
    "CREATE or UPDATE a planned post's artifact (social/posts/{id}/post.md) — the authoring write for social. " +
    "Use it to turn a calendar slot into a real post (pass channel, copy and targetLink to create), and to revise copy, link, schedule or provenance afterwards. " +
    "Writing content NEVER changes a post's lifecycle status: a new post is 'proposed', and only the Actions advance it — you cannot approve your own work by writing a caption. " +
    "Editing what would actually ship (copy, channel, link, assets, time) on an already-approved post VOIDS that approval and drops it back to asset_ready, so the approval card re-arms — that is expected, and the response says when it happened. " +
    "Published and cancelled posts are frozen; work on a new id instead. " +
    "Returns what still blocks scheduling. The post is indexed for the console and calendar as part of this write.",
  inputSchema: z.object({
    id: z.string().min(1).describe("Post id — prefer the calendar slot's `{YYYY-MM-DD}-{slug}` form"),
    channel: z.string().min(1).optional().describe("Required to create, e.g. 'instagram'"),
    copy: z.string().optional().describe("The caption text (required to create)"),
    targetLink: z.string().optional().describe("Product/collection/editorial URL (required to create)"),
    scheduledAt: z.string().optional().describe("ISO datetime with offset"),
    copyFormulaRef: z.string().optional().describe("brand.md copy formula this instantiates"),
    assetRefs: z.array(z.string()).optional().describe("Repo-relative asset paths"),
    provenance: z
      .array(z.object({ claim: z.string().min(1), origin: z.enum(["owner", "agent", "data"]) }))
      .optional()
      .describe("Every data claim carries its origin"),
    body: z.string().optional().describe("Markdown rationale — why this post, in this slot"),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    id: z.string(),
    status: z.string(),
    created: z.boolean(),
    consentCleared: z.boolean().describe("True when this edit voided an existing approval (D2)"),
    missing: z.array(z.string()).describe("What still blocks scheduling"),
    indexed: z.boolean().describe("False when the console/calendar index could not be reached"),
    indexNote: z.string().optional(),
  }),
  execute: async (input: {
    id: string;
    channel?: string;
    copy?: string;
    targetLink?: string;
    scheduledAt?: string;
    copyFormulaRef?: string;
    assetRefs?: string[];
    provenance?: { claim: string; origin: "owner" | "agent" | "data" }[];
    body?: string;
  }) => {
    const result = await upsertPost(socialRepo, input);
    // Write THROUGH to the index at the authoring write (spec 26 failure mode
    // 2). Never allowed to fail the write — files are truth — but the outcome
    // is reported rather than swallowed, so "saved but invisible" is
    // diagnosable instead of silent.
    const outcome = await syncPostIndex(getTenant().shop, result.post);
    return {
      ok: true as const,
      id: result.post.id,
      status: result.post.status,
      created: result.created,
      consentCleared: result.consentCleared,
      missing: result.missing,
      indexed: outcome.ok,
      ...(outcome.ok ? {} : { indexNote: outcome.message }),
    };
  },
});

export const socialTools = {
  social_post_upsert: socialPostUpsert,
  social_plan_propose: toMastraTool(defs.social_plan_propose),
  social_calendar_read: toMastraTool(defs.social_calendar_read),
  social_post_read: toMastraTool(defs.social_post_read),
  // Domain reference (spec 24 §6). Bound to the repo-backed corpus by
  // createSocialTools' default, so a store enables it purely by committing
  // social/reference/genome.md — no wiring. Stores without one are
  // unaffected: the tool answers available:false and compose stays brand-only.
  social_genome_read: toMastraTool(defs.social_genome_read),
  social_link_design: socialLinkDesign,
};
