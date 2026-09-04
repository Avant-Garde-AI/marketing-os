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
import { upsertCalendar, upsertPost } from "../../../lib/social/authoring";
import { scaffoldSocialSystem } from "../../../lib/social/scaffold";
import { syncPostIndex } from "../../../lib/social/index-sync";
import { socialReviewLink, socialSheetLink } from "../../../lib/social/review-links";
import { listNotes, listOpenNotes, resolveNotes } from "../../../lib/review/notes";
import { IDENTITY_CAVEAT } from "../../../lib/review/note-shape";
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

const socialCalendarUpsert = createTool({
  id: "social_calendar_upsert",
  description:
    "PERSIST a proposed month plan to social/calendar/{month}.md — the write half of planning. " +
    "social_plan_propose only DRAFTS: it returns calendarMarkdown and writes nothing, so without this call the plan lives in the conversation, the console still shows 'Nothing planned yet', and social_calendar_read reports no calendar. " +
    "Pass the proposal's calendarMarkdown through verbatim; it is already in the artifact's format. " +
    "An approved month is protected — re-planning over it fails unless you pass replaceApproved, because someone signed off on that month and losing it quietly is worse than an error. Re-proposing over a still-proposed month is normal iteration.",
  inputSchema: z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("YYYY-MM"),
    calendarMarkdown: z.string().min(1).describe("PlanProposal.calendarMarkdown, verbatim"),
    replaceApproved: z
      .boolean()
      .optional()
      .describe("Discard an existing APPROVED calendar for this month. Default false."),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    path: z.string(),
    month: z.string(),
    slotCount: z.number(),
    status: z.string(),
    created: z.boolean(),
  }),
  execute: async (input: { month: string; calendarMarkdown: string; replaceApproved?: boolean }) => {
    const result = await upsertCalendar(socialRepo, input);
    return { ok: true as const, ...result };
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
    groupId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Post GROUP (spec 26 D3). Give every variant of one creative idea the same groupId — the review room shows a group side by side, which is how register drift between platforms gets caught. Omit for a standalone post.",
      ),
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
    groupId?: string;
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

const socialScaffold = createTool({
  id: "social_scaffold",
  description:
    "Create the store's social/ tree when it does not exist yet — the authoring guide (social/README.md), a starter strategy, and the domain-reference lane (seeds, a starter genome, a gitignored corpus folder). " +
    "Run this the FIRST time a store does social, or when social_plan_propose reports that social/strategy.md is missing: it turns that dead end into a starting point. " +
    "IDEMPOTENT AND NON-DESTRUCTIVE — it never overwrites a file that already exists, so re-running it only fills gaps, and existing work is always safe. The response lists what was created versus skipped. " +
    "What it writes is a SCAFFOLD, not a finished setup: the strategy is full of TODOs naming which brand.md section each decision comes from, and the starter genome's archetypes declare evidence.n = 0 because no corpus produced them. After running it, walk the owner through finishing strategy.md from brand.md — that conversation is the point, not the file.",
  inputSchema: z.object({
    channels: z
      .array(z.string().min(1))
      .optional()
      .describe("Channels this store publishes to, e.g. ['instagram','threads']. Defaults to instagram."),
    domain: z
      .string()
      .optional()
      .describe("Opaque domain key for the genome, e.g. 'framed-art-retail'"),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    created: z.array(z.string()).describe("Paths written"),
    skipped: z.array(z.string()).describe("Paths left untouched because they already existed"),
    nextSteps: z.array(z.string()),
  }),
  execute: async (input: { channels?: string[]; domain?: string }) => {
    const files = scaffoldSocialSystem({
      storeName: getTenant().storeSlug,
      storeUrl: `https://${getTenant().shop}`,
      ...(input.channels ? { channels: input.channels } : {}),
      ...(input.domain ? { domain: input.domain } : {}),
      // The generator reads no clock; the runtime supplies the stamp.
      stampedAt: new Date().toISOString(),
    });

    const created: string[] = [];
    const skipped: string[] = [];
    for (const [path, content] of Object.entries(files)) {
      // Never overwrite. A store's real strategy must survive a re-run, and
      // "scaffold clobbered my work" is unrecoverable through a chat tool.
      if ((await socialRepo.readFile(path)) !== null) {
        skipped.push(path);
        continue;
      }
      await socialRepo.writeFile(path, content);
      created.push(path);
    }

    return {
      ok: true as const,
      created,
      skipped,
      nextSteps: [
        "Read social/README.md — it is the authoring guide for this store.",
        "Finish social/strategy.md with the owner: every TODO names the brand.md section its answer comes from.",
        "social/reference/genome.md is a platform default (evidence.n = 0). Replace it by running the acquisition lane in social/reference/README.md.",
      ],
    };
  },
});


const SOCIAL_PACK_ID = "social-media";

const socialReviewShare = createTool({
  id: "social_review_share",
  description:
    "Mint a shareable review link so teammates WITHOUT a console account can look at planned social and leave notes. " +
    "Pass groupKey for one post group (every platform variant side by side — the unit worth reviewing), or month for the whole month's contact sheet. " +
    "Links expire (30 days by default) and the expiry is inside the signature, so it cannot be edited. " +
    "A review link is for FEEDBACK ONLY: it can never approve or publish anything, because possessing a link proves possession of a link, not identity. Approval happens in Slack. Say that when you share it.",
  inputSchema: z.object({
    groupKey: z.string().min(1).optional().describe("Post group key (a post id, or the shared groupId)"),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("YYYY-MM for the month sheet"),
    ttlDays: z.number().int().positive().max(90).optional().describe("Link lifetime in days (default 30)"),
  }),
  outputSchema: z.object({
    url: z.string(),
    expiresAt: z.string(),
    kind: z.enum(["group", "month"]),
    caveat: z.string(),
  }),
  execute: async (input: { groupKey?: string; month?: string; ttlDays?: number }) => {
    const shop = getTenant().shop;
    if (!input.groupKey && !input.month) {
      throw new Error("social_review_share: pass groupKey (one group) or month (the whole month sheet)");
    }
    const link = input.groupKey
      ? socialReviewLink(shop, input.groupKey, input.ttlDays ?? 30)
      : socialSheetLink(shop, input.month!, input.ttlDays ?? 30);
    return {
      url: link.url,
      expiresAt: link.expiresAt,
      kind: input.groupKey ? ("group" as const) : ("month" as const),
      caveat: IDENTITY_CAVEAT,
    };
  },
});

const socialReviewNotes = createTool({
  id: "social_review_notes",
  description:
    "Read the notes teammates left on shared social review links, so you can act on them in-session. " +
    "Pass groupKey for one group's thread; omit it for everything still open across social. " +
    "Notes are REQUESTS, never approvals: the author is self-declared and unverified, so treat a note as input to a revision, never as permission to publish. " +
    "After acting on notes, call social_review_notes_resolve so they leave the open list.",
  inputSchema: z.object({
    groupKey: z.string().min(1).optional().describe("Group key; omit for all open notes"),
  }),
  outputSchema: z.object({
    notes: z.array(
      z.object({
        id: z.string(),
        itemId: z.string(),
        slot: z.string().nullable(),
        author: z.string(),
        body: z.string(),
        resolvedAt: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
    identityCaveat: z.string(),
  }),
  execute: async (input: { groupKey?: string }) => {
    const notes = input.groupKey
      ? await listNotes(SOCIAL_PACK_ID, input.groupKey)
      : await listOpenNotes(SOCIAL_PACK_ID);
    return {
      notes: notes.map((n) => ({
        id: n.id,
        itemId: n.itemId,
        slot: n.slot,
        author: n.author,
        body: n.body,
        resolvedAt: n.resolvedAt,
        createdAt: n.createdAt,
      })),
      identityCaveat: IDENTITY_CAVEAT,
    };
  },
});

const socialReviewNotesResolve = createTool({
  id: "social_review_notes_resolve",
  description:
    "Mark review notes as handled once you have acted on them (or a human waved them off), so the open list stays meaningful. Resolving a note changes nothing about the post — it is bookkeeping on the conversation.",
  inputSchema: z.object({ noteIds: z.array(z.string().min(1)).min(1) }),
  outputSchema: z.object({ resolved: z.number() }),
  execute: async (input: { noteIds: string[] }) => ({ resolved: await resolveNotes(input.noteIds) }),
});

export const socialTools = {
  social_scaffold: socialScaffold,
  social_review_share: socialReviewShare,
  social_review_notes: socialReviewNotes,
  social_review_notes_resolve: socialReviewNotesResolve,
  social_calendar_upsert: socialCalendarUpsert,
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
