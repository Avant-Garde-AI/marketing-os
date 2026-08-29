/**
 * Campaign authoring — the missing write between "plan" and "stage".
 *
 * The pack could PLAN (email_plan_propose), PREVIEW (email_render_preview) and
 * STAGE to Klaviyo (the create_campaign_draft Action), but nothing let an agent
 * author a campaign's actual content: its subject, preview text, audience and
 * sections. That content was only ever written by hand or by a harness script,
 * which is why campaigns could not be driven end-to-end from a chat or an MCP
 * client. This closes it.
 *
 * ## Why this is not an Action
 *
 * Spec 20's line is that writes to EXTERNAL state are Actions. This writes a
 * campaign artifact into the store's own repo — it creates nothing in Klaviyo,
 * schedules nothing, and sends nothing. The gate stays exactly where it was: a
 * campaign only reaches Klaviyo through `klaviyo.create_campaign_draft`, and
 * only sends through `klaviyo.schedule_campaign`, both of which are proposed
 * for human approval. Authoring freely and publishing under approval is the
 * intended shape.
 *
 * Two guards keep that honest:
 *   - a campaign that has already been DRAFTED into Klaviyo or SCHEDULED is not
 *     editable here; re-drafting is what re-syncs it, and silently mutating the
 *     artifact under an approved send would make the approval nonce a lie.
 *   - `status` is never settable by the caller — it is derived from the
 *     lifecycle, so an agent cannot mark its own work approved.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { emailRepo } from "../../../lib/email/repo";
import { campaignPath, parseCampaign, serializeCampaign } from "../../../lib/email/artifacts";
import type { EmailCampaign } from "../../../lib/email/types";

const audienceRefSchema = z.object({
  type: z.enum(["list", "segment"]),
  id: z.string().min(1),
  label: z.string().optional(),
});

const sectionSchema = z.union([
  z.object({
    slot: z.string().min(1),
    type: z.literal("html"),
    blocks: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .describe("email-assembly blocks: heading, paragraph, button, productRow, eyebrow, callout, ctaBand, featuredCard, list, swatches, chips, trustBadges, divider, image, graphCallout."),
  }),
  z.object({
    slot: z.string().min(1),
    type: z.literal("surface"),
    alt: z.string().min(1).describe("Describes the MESSAGE, not the pixels. Mandatory — the invariant gate rejects an image without it."),
    imageUrl: z.string().optional().describe("A resolved image URL (e.g. from imagery_resolve). Signed URLs expire; the draft Action re-uploads to the ESP."),
    surfaceId: z.string().optional(),
    boardName: z.string().optional(),
    assetPath: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
]);

/** Statuses whose artifact must not be edited in place — see module doc. */
const FROZEN = new Set(["drafted", "scheduled", "sent", "measured"]);

export const emailCampaignUpsert = createTool({
  id: "email_campaign_upsert",
  description:
    "Create or update a campaign's CONTENT in the store repo: subject, preview text, audience, and the ordered sections that make up the email. Writes only the repo artifact — nothing is created in Klaviyo and nothing sends; staging to the ESP is a separate approved Action. Pass only the fields you want to change; omitted fields are preserved. Refuses to edit a campaign already drafted into Klaviyo or scheduled (re-draft it instead, so the approval and the artifact cannot drift apart). Use email_render_preview afterwards to see it and check the invariant report.",
  inputSchema: z.object({
    id: z.string().min(1).describe("Campaign id, e.g. 2026-09-01-artist-mirimo."),
    archetype: z.string().optional().describe("Required when creating: editorial, artist-drop, set-feature, room-recommendation, new-arrivals, seasonal…"),
    subject: z.string().optional(),
    subjectCandidates: z.array(z.string()).optional(),
    previewText: z.string().optional(),
    audienceIncluded: z.array(audienceRefSchema).optional().describe("Lists/segments to send to (see klaviyo_audiences_read)."),
    audienceExcluded: z.array(audienceRefSchema).optional(),
    sections: z.array(sectionSchema).optional().describe("The email body, in order. Replaces the existing sections wholesale when supplied."),
    skeletonRef: z.string().optional(),
    copyFormulaRef: z.string().optional().describe("The brand.md copy formula this instantiates."),
    body: z.string().optional().describe("Markdown rationale — why this campaign, why these pieces. Kept with the artifact."),
    scheduledAt: z.string().optional().describe("Intended send time (ISO). Recording it here does NOT schedule anything."),
  }),
  execute: async (input: {
    id: string;
    archetype?: string;
    subject?: string;
    subjectCandidates?: string[];
    previewText?: string;
    audienceIncluded?: Array<{ type: "list" | "segment"; id: string; label?: string }>;
    audienceExcluded?: Array<{ type: "list" | "segment"; id: string; label?: string }>;
    sections?: unknown[];
    skeletonRef?: string;
    copyFormulaRef?: string;
    body?: string;
    scheduledAt?: string;
  }) => {
    const path = campaignPath(input.id);
    const raw = await emailRepo.readFile(path);
    const existing = raw === null ? null : parseCampaign(raw);

    if (existing && FROZEN.has(existing.status)) {
      throw new Error(
        `campaign "${input.id}" is "${existing.status}" — its artifact is frozen so the approved draft and the file cannot drift. Re-run klaviyo.create_campaign_draft to re-sync after changes, or work on a new campaign id.`,
      );
    }
    if (!existing && !input.archetype) {
      throw new Error(`campaign "${input.id}" does not exist — pass archetype to create it.`);
    }

    const next: EmailCampaign = existing
      ? { ...existing }
      : {
          id: input.id,
          archetype: input.archetype!,
          audience: { included: [], excluded: [] },
          subjectCandidates: [],
          skeletonRef: input.skeletonRef ?? "emails-frame",
          sections: [],
          utm: { campaign: input.id, source: "klaviyo", medium: "email" },
          provenance: [],
          status: "proposed",
          body: "",
        };

    if (input.archetype !== undefined) next.archetype = input.archetype;
    if (input.subject !== undefined) next.subject = input.subject;
    if (input.subjectCandidates !== undefined) next.subjectCandidates = input.subjectCandidates;
    if (input.previewText !== undefined) next.previewText = input.previewText;
    if (input.skeletonRef !== undefined) next.skeletonRef = input.skeletonRef;
    if (input.copyFormulaRef !== undefined) next.copyFormulaRef = input.copyFormulaRef;
    if (input.body !== undefined) next.body = input.body;
    if (input.scheduledAt !== undefined) next.scheduledAt = input.scheduledAt;
    if (input.audienceIncluded !== undefined) next.audience = { ...next.audience, included: input.audienceIncluded };
    if (input.audienceExcluded !== undefined) next.audience = { ...next.audience, excluded: input.audienceExcluded };
    if (input.sections !== undefined) next.sections = input.sections as EmailCampaign["sections"];

    // Status is LIFECYCLE, never content-derived: a campaign becomes `approved`
    // via the email.approve_plan Action and `drafted` via create_campaign_draft.
    // Authoring content must not promote it, or an agent could approve its own
    // work by writing a section.

    await emailRepo.writeFile(path, serializeCampaign(next));

    const missing: string[] = [];
    // The draft Action refuses anything not yet approved (draftReadiness), so
    // an unapproved plan is a genuine blocker to staging, not a nicety.
    if (next.status !== "approved") missing.push(`plan approval (status is "${next.status}"; email.approve_plan promotes it)`);
    if (!next.subject) missing.push("subject");
    if (!next.previewText) missing.push("previewText");
    if (!next.sections.length) missing.push("sections");
    if (!next.audience.included.length) missing.push("audience");

    return {
      id: next.id,
      created: existing === null,
      status: next.status,
      repoPath: path,
      sectionCount: next.sections.length,
      readyToStage: missing.length === 0,
      missingForStaging: missing,
      next:
        missing.length === 0
          ? "Call email_render_preview to see it, then propose_action { kind: 'klaviyo.create_campaign_draft' } to stage it for approval."
          : `Still needed before staging: ${missing.join(", ")}.`,
    };
  },
});

export const emailAuthoringTools = { email_campaign_upsert: emailCampaignUpsert };
