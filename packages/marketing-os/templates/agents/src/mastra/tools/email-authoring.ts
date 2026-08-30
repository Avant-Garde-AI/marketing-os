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
import { syncCampaignIndex } from "../../../lib/email/index-sync";
import { getTenant } from "../../../lib/tenant-context";
import { campaignPath, parseCampaign, serializeCampaign, parseStrategy, strategyPathFor, resolveEmailRoot } from "../../../lib/email/artifacts";
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

    // Write THROUGH to the index. Files stay truth (spec 22 D1) and the email
    // cron still rebuilds the whole projection from them, but without this the
    // campaign is invisible everywhere the console and calendar look — they
    // read mos_email_campaigns / mos_calendar_items, not the artifact store.
    // A campaign that renders perfectly at its preview URL and appears nowhere
    // in the UI is the worst kind of half-built: it looks like it worked.
    // Failures inside syncCampaignIndex are already swallowed and logged there,
    // because a broken index must never fail an authoring write.
    await syncCampaignIndex(getTenant().shop, next);

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



/**
 * Strategy authoring.
 *
 * The pack's own instructions tell the agent to "co-create email/strategy.md
 * with the owner from brand.md" — but there was no tool to write one, so the
 * standing strategy could only ever be seeded by hand. Every planning call
 * depends on it (`email_plan_propose` derives the whole calendar from it), so
 * a store with no strategy had no path to one from inside the product.
 *
 * VALIDATE-BEFORE-WRITE is the point: the content is parsed with the same
 * parser the planner uses, and a document that would not parse is rejected
 * with the parser's own error rather than saved. A malformed strategy is worse
 * than no strategy — it fails later, further from the cause.
 *
 * Repo artifact only: no external state, nothing sends. Like campaign content,
 * it is human-reviewable in the store repo and every campaign it produces
 * still goes through the Action gate.
 */
export const emailStrategyUpsert = createTool({
  id: "email_strategy_upsert",
  description:
    "Write the store's standing email strategy (strategy.md): the audiences, the weighted archetype rotation, cadence and send days, seasonal arcs and guardrails. Pass the COMPLETE markdown document — YAML front matter plus the prose body — and it is validated with the planner's own parser before saving, so a malformed strategy is rejected rather than stored. Read the current one with email_strategy_read first if you are revising. Every calendar email_plan_propose produces derives from this, so it should be co-created with the owner from brand.md, not invented.",
  inputSchema: z.object({
    content: z
      .string()
      .min(1)
      .describe(
        "The full strategy.md: YAML front matter (audiences[], archetypes[] with weights, campaignsPerMonth, sendDays[], sendTime HH:MM, optional seasonalArcs/guardrails) then --- then the markdown body.",
      ),
  }),
  execute: async ({ content }: { content: string }) => {
    // Parse FIRST. The planner will use exactly this parser, so anything it
    // rejects must never reach the store.
    let parsed;
    try {
      parsed = parseStrategy(content);
    } catch (e) {
      throw new Error(
        `strategy rejected — it would not parse, so it was NOT saved: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const root = await resolveEmailRoot(emailRepo);
    const path = strategyPathFor(root);
    const previous = await emailRepo.readFile(path);
    await emailRepo.writeFile(path, content);

    return {
      repoPath: path,
      created: previous === null,
      audiences: parsed.audiences.map((a) => ({ key: a.key, cadenceCap: a.cadenceCap })),
      archetypes: parsed.archetypes.map((a) => ({ name: a.name, weight: a.weight })),
      campaignsPerMonth: parsed.campaignsPerMonth,
      sendDays: parsed.sendDays,
      sendTime: parsed.sendTime,
      next: "Call email_plan_propose { month } to see the calendar this produces.",
    };
  },
});

export const emailStrategyRead = createTool({
  id: "email_strategy_read",
  description:
    "Read the store's current email strategy document verbatim, so it can be revised rather than rewritten from scratch. Returns null content when the store has no strategy yet.",
  inputSchema: z.object({}),
  execute: async () => {
    const root = await resolveEmailRoot(emailRepo);
    const path = strategyPathFor(root);
    const content = await emailRepo.readFile(path);
    return { repoPath: path, exists: content !== null, content };
  },
});


/**
 * Design-system seeding.
 *
 * The frame an email is assembled on comes from the store's partials (head,
 * header, footer, divider, product-card…). Those live in the store's git repo,
 * but the artifact store the runtime reads is DB-backed (see lib/email/repo.ts
 * — the git lane is deferred), so a store whose design system has never been
 * seeded cannot assemble anything: `email_render_preview` fails with "no
 * partials", and so does every draft Action.
 *
 * This is the bridge until the git write path lands. It is deliberately
 * scoped to partials rather than being a general file-write: the assembly
 * frame is the one thing that must exist before anything else works, and a
 * general "write any path" tool over the artifact store is a much wider
 * surface than this problem needs.
 */
export const emailPartialsUpsert = createTool({
  id: "email_partials_upsert",
  description:
    "Seed or update the store's email design-system partials — the shared HTML fragments (head, header, footer, divider, button, product-card) that every campaign's frame is composed from. Required before any email can be assembled or previewed. Pass a map of partial name → HTML. Klaviyo template tags are preserved verbatim; the composer only substitutes <!--PARTIAL:name--> markers.",
  inputSchema: z.object({
    partials: z
      .record(z.string(), z.string())
      .describe('Map of name → HTML, e.g. { "head": "<!DOCTYPE html>…", "header": "<table>…" }. Names match the <!--PARTIAL:name--> markers.'),
  }),
  execute: async ({ partials }: { partials: Record<string, string> }) => {
    const names = Object.keys(partials);
    if (!names.length) throw new Error("no partials supplied");
    const root = await resolveEmailRoot(emailRepo);
    const written: string[] = [];
    for (const [name, html] of Object.entries(partials)) {
      if (!/^[\w-]+$/.test(name)) throw new Error(`invalid partial name "${name}" — use letters, digits, dashes`);
      const path = `${root}/partials/${name}.html`;
      await emailRepo.writeFile(path, html);
      written.push(path);
    }
    // The frame needs these three at minimum; say so rather than letting
    // assembly fail later with a less obvious message.
    const required = ["head", "header", "footer"];
    const present = new Set(names);
    const missing = required.filter((r) => !present.has(r));
    return {
      written,
      root,
      complete: missing.length === 0,
      ...(missing.length ? { stillMissing: missing, note: `The default frame composes head + header + footer; without ${missing.join(", ")} assembly will still fail.` } : {}),
    };
  },
});

export const emailAuthoringTools = {
  email_campaign_upsert: emailCampaignUpsert,
  email_strategy_upsert: emailStrategyUpsert,
  email_strategy_read: emailStrategyRead,
  email_partials_upsert: emailPartialsUpsert,
};
