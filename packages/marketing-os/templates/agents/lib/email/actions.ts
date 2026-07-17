/**
 * VENDORED from packages/skills/email-campaign — do not edit here; swap for
 * the published package on next touch (H8.3).
 */
/**
 * The four email Actions (02 §1, WS3-R5) — spec 20 Action<P> declarations.
 *
 * DECLARED here (the pack owns the semantics), EXECUTED by the platform gate:
 * the hosted runtime registers these factories; marketing-os-app's gate calls
 * preview() at propose time and execute() only after a human approval claims
 * the proposal's nonce. The pack never sees a credential and never decides —
 * it defines what "draft this campaign in Klaviyo" precisely means.
 *
 * Nonce discipline (spec 24 D2, mirrored): every preview()'s previewHash is
 * deterministic over exactly the material that will mutate — assembled HTML
 * bytes, subject/preview text, audience refs, send time, skeleton version.
 * Any change to any of them produces a different hash, so the gate's stored
 * hash no longer matches and the approval re-arms. What was approved is
 * exactly what sends.
 *
 * Idempotency: klaviyo.create_campaign_draft's execute is a multi-step
 * sequence (images → template → campaign → assignment); each landed id is
 * written back to campaign.md IMMEDIATELY (03 §4), so a retry resumes from
 * what exists instead of duplicating.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Action, ActionPreview, ActionResult } from "../skill-kit";
import type {
  CampaignAudienceRef,
  EmailCampaign,
  EmailRepo,
  EmailStrategy,
  KlaviyoClient,
} from "./types";
import {
  REGISTRY_PATH,
  STRATEGY_PATH,
  calendarPath,
  campaignHtmlPath,
  campaignPath,
  parseCalendar,
  parseCampaign,
  parseRegistry,
  parseSkeleton,
  parseStrategy,
  serializeCalendar,
  serializeCampaign,
  serializeRegistry,
  skeletonPath,
} from "./artifacts";

// ---------------------------------------------------------------------------
// Dependencies — the runtime binds these; tests bind fakes
// ---------------------------------------------------------------------------

export interface AssembledEmail {
  html: string;
  /** sha256 of the assembled bytes — the determinism anchor. */
  htmlSha256: string;
  report: { ok: boolean; errors: string[]; warnings: string[] };
}

export interface EmailActionDeps {
  repo: EmailRepo;
  klaviyo: KlaviyoClient;
  /**
   * Assemble the campaign's CURRENT state into inbox HTML (the runtime wires
   * @avant-garde/email-assembly + the skeleton + section content). MUST be
   * deterministic — byte-identical html for identical campaign state.
   */
  assemble: (campaign: EmailCampaign) => Promise<AssembledEmail>;
  /** Read a binary asset (board export) from the store repo, for image upload. */
  readAsset: (path: string) => Promise<Uint8Array>;
  /** Absolute URL of the guarded assembled-HTML preview route (02 §7). */
  previewUrl?: (campaignId: string) => string;
  /** Default skeleton for plan-created campaign stubs (PRD §8 Q5 scaffold). */
  defaultSkeletonRef?: string;
}

function sha256(s: string | Uint8Array): string {
  return createHash("sha256").update(s).digest("hex");
}

function hashMaterial(material: unknown): string {
  return sha256(JSON.stringify(material));
}

async function loadCampaign(repo: EmailRepo, id: string): Promise<EmailCampaign> {
  const raw = await repo.readFile(campaignPath(id));
  if (raw === null) throw new Error(`campaign "${id}" not found (${campaignPath(id)})`);
  return parseCampaign(raw);
}

async function saveCampaign(repo: EmailRepo, campaign: EmailCampaign): Promise<void> {
  await repo.writeFile(campaignPath(campaign.id), serializeCampaign(campaign));
}

async function loadStrategy(repo: EmailRepo): Promise<EmailStrategy> {
  const raw = await repo.readFile(STRATEGY_PATH);
  if (raw === null) throw new Error(`${STRATEGY_PATH} not found — co-create the strategy first`);
  return parseStrategy(raw);
}

/** Skeleton version participates in every hash — re-ingestion re-arms cards. */
async function skeletonVersionOf(repo: EmailRepo, skeletonRef: string): Promise<number> {
  const raw = await repo.readFile(skeletonPath(skeletonRef));
  if (raw === null) return 0; // scaffold/default skeletons version as 0 until ingested
  return parseSkeleton(raw).version;
}

function audienceLabel(refs: CampaignAudienceRef[]): string {
  return refs
    .map((r) => `${r.name ?? r.key ?? r.id}${r.estimatedSize !== undefined ? ` (~${r.estimatedSize.toLocaleString("en-US")})` : ""}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// email.approve_plan (medium) — plan → approved; AUTHORIZES DRAFTING ONLY
// ---------------------------------------------------------------------------

const approvePlanParams = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM"),
});
export type ApprovePlanParams = z.infer<typeof approvePlanParams>;

/** Deterministic campaign id for a plan slot. */
export function slotCampaignId(month: string, slotDate: string, archetype: string, n: number): string {
  const day = slotDate.slice(8, 10);
  return `${month}-${day}-${archetype}${n > 0 ? `-${n + 1}` : ""}`.toLowerCase();
}

function approvePlan(deps: EmailActionDeps): Action<ApprovePlanParams> {
  return {
    kind: "email.approve_plan",
    title: "Approve email plan",
    paramsSchema: approvePlanParams,
    summary: (p) => `Approve the ${p.month} email campaign plan (authorizes drafting only)`,
    scopes: ["email:write_plan"],
    risk: "medium",
    async preview(p) {
      const raw = await deps.repo.readFile(calendarPath(p.month));
      if (raw === null) throw new Error(`no calendar proposal for ${p.month} — propose a plan first`);
      const calendar = parseCalendar(raw);
      if (calendar.status !== "proposed") {
        throw new Error(`calendar ${p.month} is "${calendar.status}", not "proposed" — nothing to approve`);
      }
      const audiences = [...new Set(calendar.slots.map((s) => s.audience).filter(Boolean))] as string[];
      const archetypes = [...new Set(calendar.slots.map((s) => s.archetype))];
      return {
        summary: `Approve ${calendar.slots.length} campaign slot(s) for ${p.month} — drafting authorized; every send still approves individually`,
        rows: [
          { label: "Slots", value: String(calendar.slots.length) },
          { label: "Audiences", value: audiences.join(", ") || "—" },
          { label: "Archetypes", value: archetypes.join(", ") },
          { label: "Sends gated", value: "each campaign approves individually" },
        ],
        previewHash: hashMaterial({ kind: "email.approve_plan", month: p.month, calendar: raw }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const raw = await deps.repo.readFile(calendarPath(p.month));
      if (raw === null) throw new Error(`no calendar for ${p.month}`);
      const calendar = parseCalendar(raw);
      const strategy = await loadStrategy(deps.repo);
      const created: string[] = [];
      const counts = new Map<string, number>();

      for (const slot of calendar.slots) {
        if (slot.campaignId) continue; // idempotent resume: already created
        const key = `${slot.slot}:${slot.archetype}`;
        const n = counts.get(key) ?? 0;
        counts.set(key, n + 1);
        const id = slotCampaignId(p.month, slot.slot, slot.archetype, n);

        const roster = slot.audience ? strategy.audiences.find((a) => a.key === slot.audience) : undefined;
        const included: CampaignAudienceRef[] = roster
          ? [{ key: roster.key, type: roster.klaviyoRef.type, id: roster.klaviyoRef.id, name: roster.description }]
          : [];

        const existing = await deps.repo.readFile(campaignPath(id));
        if (existing === null) {
          const campaign: EmailCampaign = {
            id,
            archetype: slot.archetype,
            audience: { included },
            subjectCandidates: [],
            skeletonRef: deps.defaultSkeletonRef ?? "default",
            sections: [],
            utm: { campaign: id, source: "klaviyo", medium: "email" },
            provenance: [
              { claim: `slot ${slot.slot} of the approved ${p.month} plan (${slot.intent})`, origin: "agent" },
            ],
            status: "approved",
            body: `Created by email.approve_plan from the ${p.month} calendar. Intent: ${slot.intent}.`,
          };
          await saveCampaign(deps.repo, campaign);
        }
        slot.campaignId = id;
        slot.status = "approved";
        created.push(id);
        // Write the calendar after each slot so a mid-run retry resumes.
        await deps.repo.writeFile(
          calendarPath(p.month),
          serializeCalendar({ ...calendar, status: "proposed" }),
        );
      }

      await deps.repo.writeFile(calendarPath(p.month), serializeCalendar({ ...calendar, status: "approved" }));
      return {
        ok: true,
        summary: `Plan ${p.month} approved — ${created.length} campaign(s) ready for drafting`,
        detail: { month: p.month, campaignIds: created },
      } satisfies ActionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// klaviyo.create_campaign_draft (medium) — the 3-step idempotent execute
// ---------------------------------------------------------------------------

const draftParams = z.object({
  campaignId: z.string().min(1),
});
export type CreateDraftParams = z.infer<typeof draftParams>;

/** Registry slug for a campaign's CODE template (06 §4). */
export function campaignTemplateSlug(campaignId: string): string {
  return `campaign-${campaignId}`;
}

async function draftReadiness(deps: EmailActionDeps, campaign: EmailCampaign): Promise<AssembledEmail> {
  if (campaign.status !== "approved" && campaign.status !== "drafted") {
    throw new Error(
      `campaign "${campaign.id}" is "${campaign.status}" — only approved campaigns draft (approve the plan first)`,
    );
  }
  if (!campaign.subject) throw new Error(`campaign "${campaign.id}" has no chosen subject — pick one of the candidates`);
  if (!campaign.previewText) throw new Error(`campaign "${campaign.id}" has no previewText`);
  if (campaign.sections.length === 0) throw new Error(`campaign "${campaign.id}" has no sections — draft the content first`);
  if (campaign.audience.included.length === 0) throw new Error(`campaign "${campaign.id}" has no audience`);
  const assembled = await deps.assemble(campaign);
  if (!assembled.report.ok) {
    throw new Error(
      `assembly invariants failed for "${campaign.id}": ${assembled.report.errors.join("; ")} — fix before drafting (04 §6)`,
    );
  }
  return assembled;
}

async function draftHash(deps: EmailActionDeps, campaign: EmailCampaign, assembled: AssembledEmail): Promise<string> {
  return hashMaterial({
    kind: "klaviyo.create_campaign_draft",
    campaignId: campaign.id,
    htmlSha256: assembled.htmlSha256,
    subject: campaign.subject,
    previewText: campaign.previewText,
    audience: campaign.audience,
    skeletonRef: campaign.skeletonRef,
    skeletonVersion: await skeletonVersionOf(deps.repo, campaign.skeletonRef),
  });
}

function createCampaignDraft(deps: EmailActionDeps): Action<CreateDraftParams> {
  return {
    kind: "klaviyo.create_campaign_draft",
    title: "Create campaign draft in Klaviyo",
    paramsSchema: draftParams,
    summary: (p) => `Create "${p.campaignId}" in Klaviyo as a draft (no send scheduled)`,
    scopes: ["klaviyo:write_campaigns", "klaviyo:write_templates", "klaviyo:write_images"],
    risk: "medium",
    async preview(p) {
      const campaign = await loadCampaign(deps.repo, p.campaignId);
      const assembled = await draftReadiness(deps, campaign);
      // Real audience sizes for the card (recipient estimation needs a Klaviyo
      // campaign to exist — that's the SCHEDULE preview's number; here we show
      // live profile counts for the selected lists/segments).
      const live = await deps.klaviyo.listAudiences();
      const withSizes = campaign.audience.included.map((ref) => ({
        ...ref,
        estimatedSize: live.find((a) => a.type === ref.type && a.id === ref.id)?.profileCount ?? ref.estimatedSize,
      }));
      return {
        summary: `Draft "${campaign.subject}" → Klaviyo (template + campaign + audience; nothing sends)`,
        rows: [
          { label: "Subject", value: campaign.subject!.slice(0, 60) },
          { label: "Preview text", value: campaign.previewText!.slice(0, 60) },
          { label: "Audience", value: audienceLabel(withSizes) },
          { label: "Sections", value: `${campaign.sections.length} (${campaign.sections.filter((s) => s.type === "surface").length} visual)` },
          { label: "Skeleton", value: campaign.skeletonRef },
        ],
        ...(deps.previewUrl ? { previewUrl: deps.previewUrl(campaign.id) } : {}),
        ...(assembled.report.warnings.length ? { warnings: assembled.report.warnings } : {}),
        previewHash: await draftHash(deps, campaign, assembled),
      } satisfies ActionPreview;
    },
    async execute(p) {
      let campaign = await loadCampaign(deps.repo, p.campaignId);
      const steps: string[] = [];

      // Step 1 — upload board exports to Klaviyo Images (03 §5: never hotlink
      // our own hosts in sent mail). Resume: sections with imageUrl skip.
      for (const section of campaign.sections) {
        if (section.type !== "surface" || section.imageUrl) continue;
        if (!section.assetPath) {
          throw new Error(`section "${section.slot}" has no assetPath — export its board first`);
        }
        const bytes = await deps.readAsset(section.assetPath);
        const uploaded = await deps.klaviyo.uploadImage({
          name: `${campaign.id}-${section.slot}`,
          data: bytes,
          mediaType: "image/png",
        });
        section.imageUrl = uploaded.imageUrl;
        await saveCampaign(deps.repo, campaign); // record immediately (resume point)
        steps.push(`image:${section.slot}`);
      }

      // Step 2 — assemble the final HTML (now with Klaviyo-hosted image URLs)
      // and persist it: email.html is EXACTLY what lands in Klaviyo.
      const assembled = await deps.assemble(campaign);
      if (!assembled.report.ok) {
        throw new Error(`assembly failed post-upload: ${assembled.report.errors.join("; ")}`);
      }
      await deps.repo.writeFile(campaignHtmlPath(campaign.id), assembled.html);

      // Step 3 — template via the registry (PATCH-not-duplicate, 06 §4).
      const registryRaw = await deps.repo.readFile(REGISTRY_PATH);
      const registry = registryRaw ? parseRegistry(registryRaw) : {};
      const slug = campaignTemplateSlug(campaign.id);
      let templateId = campaign.klaviyo?.templateId ?? registry[slug];
      if (templateId) {
        await deps.klaviyo.updateTemplate(templateId, { html: assembled.html });
        steps.push(`template:updated:${templateId}`);
      } else {
        const created = await deps.klaviyo.createTemplate({ name: `${campaign.id} (Marketing OS)`, html: assembled.html });
        templateId = created.id;
        registry[slug] = templateId;
        await deps.repo.writeFile(REGISTRY_PATH, serializeRegistry(registry));
        steps.push(`template:created:${templateId}`);
      }
      campaign.klaviyo = { ...campaign.klaviyo, templateId };
      await saveCampaign(deps.repo, campaign);

      // Step 4 — campaign + message (resume: skip when campaignId recorded).
      if (!campaign.klaviyo.campaignId) {
        const createdCampaign = await deps.klaviyo.createCampaign({
          name: campaign.id,
          audiences: {
            included: campaign.audience.included.map((r) => r.id),
            ...(campaign.audience.excluded?.length
              ? { excluded: campaign.audience.excluded.map((r) => r.id) }
              : {}),
          },
          subject: campaign.subject!,
          previewText: campaign.previewText!,
          utmParams: [
            { name: "utm_campaign", value: campaign.utm.campaign },
            { name: "utm_source", value: campaign.utm.source },
            { name: "utm_medium", value: campaign.utm.medium },
          ],
          useSmartSending: true,
        });
        campaign.klaviyo = { ...campaign.klaviyo, campaignId: createdCampaign.campaignId, messageId: createdCampaign.messageId };
        await saveCampaign(deps.repo, campaign);
        steps.push(`campaign:${createdCampaign.campaignId}`);
      }

      // Step 5 — assign the template to the message.
      await deps.klaviyo.assignTemplate(campaign.klaviyo.messageId!, templateId);
      steps.push("assigned");

      campaign = { ...campaign, status: "drafted" };
      await saveCampaign(deps.repo, campaign);

      return {
        ok: true,
        summary: `"${campaign.subject}" exists in Klaviyo as a draft`,
        detail: {
          campaignId: campaign.id,
          klaviyo: campaign.klaviyo as Record<string, unknown>,
          steps,
        },
      } satisfies ActionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// klaviyo.schedule_campaign (HIGH) — approval = consent to send at T
// ---------------------------------------------------------------------------

const scheduleParams = z.object({
  campaignId: z.string().min(1),
  sendAt: z.string().datetime({ offset: true }).describe("ISO datetime — approval is consent to send at this time"),
});
export type ScheduleParams = z.infer<typeof scheduleParams>;

function scheduleCampaign(deps: EmailActionDeps): Action<ScheduleParams> {
  return {
    kind: "klaviyo.schedule_campaign",
    title: "Schedule campaign send",
    paramsSchema: scheduleParams,
    summary: (p) => `Schedule "${p.campaignId}" to send at ${p.sendAt} — approval IS consent to send`,
    scopes: ["klaviyo:write_campaigns"],
    risk: "high",
    async preview(p) {
      const campaign = await loadCampaign(deps.repo, p.campaignId);
      if (campaign.status !== "drafted" && campaign.status !== "scheduled") {
        throw new Error(`campaign "${p.campaignId}" is "${campaign.status}" — draft it in Klaviyo first`);
      }
      if (!campaign.klaviyo?.campaignId) {
        throw new Error(`campaign "${p.campaignId}" has no Klaviyo campaign id — run klaviyo.create_campaign_draft`);
      }
      // Drift check (nonce honesty): what sends is the DRAFTED artifact. If
      // the campaign's current state no longer assembles to the same bytes as
      // email.html, the draft is stale — re-draft before scheduling.
      const assembled = await deps.assemble(campaign);
      const draftedHtml = await deps.repo.readFile(campaignHtmlPath(campaign.id));
      if (draftedHtml === null || sha256(draftedHtml) !== assembled.htmlSha256) {
        throw new Error(
          `campaign "${p.campaignId}" changed since it was drafted — re-run klaviyo.create_campaign_draft so what you approve is what sends`,
        );
      }
      // The real recipient number (03 §4: estimation job needs the campaign).
      const estimate = await deps.klaviyo.estimateRecipients(campaign.klaviyo.campaignId);
      return {
        summary: `Send "${campaign.subject}" to ~${estimate.estimatedCount.toLocaleString("en-US")} recipients at ${p.sendAt}. Approval is consent to send — no second touch.`,
        rows: [
          { label: "Subject", value: campaign.subject!.slice(0, 60) },
          { label: "Recipients", value: `~${estimate.estimatedCount.toLocaleString("en-US")}` },
          { label: "Audience", value: audienceLabel(campaign.audience.included) },
          { label: "Send time", value: p.sendAt },
          { label: "Undo", value: "cancel any time before send" },
        ],
        ...(deps.previewUrl ? { previewUrl: deps.previewUrl(campaign.id) } : {}),
        previewHash: hashMaterial({
          kind: "klaviyo.schedule_campaign",
          campaignId: campaign.id,
          htmlSha256: assembled.htmlSha256,
          subject: campaign.subject,
          audience: campaign.audience,
          sendAt: p.sendAt,
          templateId: campaign.klaviyo.templateId,
          skeletonVersion: await skeletonVersionOf(deps.repo, campaign.skeletonRef),
        }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const campaign = await loadCampaign(deps.repo, p.campaignId);
      if (!campaign.klaviyo?.campaignId) throw new Error(`campaign "${p.campaignId}" has no Klaviyo id`);
      // Idempotent: already scheduled at exactly this time → success.
      if (campaign.status === "scheduled" && campaign.scheduledAt === p.sendAt) {
        return { ok: true, summary: `already scheduled for ${p.sendAt}`, detail: { campaignId: campaign.id } };
      }
      await deps.klaviyo.updateCampaignSendStrategy(campaign.klaviyo.campaignId, { datetime: p.sendAt });
      const job = await deps.klaviyo.createSendJob(campaign.klaviyo.campaignId);
      const updated: EmailCampaign = {
        ...campaign,
        scheduledAt: p.sendAt,
        status: "scheduled",
        klaviyo: { ...campaign.klaviyo, sendJobStatus: job.status },
      };
      await saveCampaign(deps.repo, updated);
      return {
        ok: true,
        summary: `Scheduled — Klaviyo sends at ${p.sendAt}`,
        detail: { campaignId: campaign.id, sendAt: p.sendAt, sendJobStatus: job.status },
      } satisfies ActionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// klaviyo.cancel_send (low) — the undo lane
// ---------------------------------------------------------------------------

const cancelParams = z.object({
  campaignId: z.string().min(1),
  revertToDraft: z.boolean().optional().describe("true → back to drafted (default); false → cancelled"),
});
export type CancelParams = z.infer<typeof cancelParams>;

function cancelSend(deps: EmailActionDeps): Action<CancelParams> {
  return {
    kind: "klaviyo.cancel_send",
    title: "Cancel scheduled send",
    paramsSchema: cancelParams,
    summary: (p) => `Cancel the scheduled send of "${p.campaignId}"`,
    scopes: ["klaviyo:write_campaigns"],
    risk: "low",
    async preview(p) {
      const campaign = await loadCampaign(deps.repo, p.campaignId);
      if (campaign.status !== "scheduled") {
        throw new Error(`campaign "${p.campaignId}" is "${campaign.status}" — only scheduled sends cancel`);
      }
      return {
        summary: `Cancel "${campaign.subject}" (was sending ${campaign.scheduledAt})`,
        rows: [
          { label: "Subject", value: campaign.subject?.slice(0, 60) ?? "—" },
          { label: "Was sending", value: campaign.scheduledAt ?? "—" },
          { label: "After cancel", value: p.revertToDraft === false ? "cancelled" : "back to drafted" },
        ],
        previewHash: hashMaterial({
          kind: "klaviyo.cancel_send",
          campaignId: campaign.id,
          scheduledAt: campaign.scheduledAt,
        }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const campaign = await loadCampaign(deps.repo, p.campaignId);
      if (!campaign.klaviyo?.campaignId) throw new Error(`campaign "${p.campaignId}" has no Klaviyo id`);
      const revert = p.revertToDraft !== false;
      await deps.klaviyo.cancelSendJob(campaign.klaviyo.campaignId, { revertToDraft: revert });
      const updated: EmailCampaign = {
        ...campaign,
        status: revert ? "drafted" : "cancelled",
        klaviyo: { ...campaign.klaviyo, sendJobStatus: "cancelled" },
      };
      delete updated.scheduledAt;
      await saveCampaign(deps.repo, updated);
      return {
        ok: true,
        summary: revert ? "Send cancelled — campaign back to drafted" : "Send cancelled",
        detail: { campaignId: campaign.id },
      } satisfies ActionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// The factory (spec 20 §5 `actions` — bound per tenant by the runtime)
// ---------------------------------------------------------------------------

export function createEmailActions(deps: EmailActionDeps): {
  approvePlan: Action<ApprovePlanParams>;
  createCampaignDraft: Action<CreateDraftParams>;
  scheduleCampaign: Action<ScheduleParams>;
  cancelSend: Action<CancelParams>;
} {
  return {
    approvePlan: approvePlan(deps),
    createCampaignDraft: createCampaignDraft(deps),
    scheduleCampaign: scheduleCampaign(deps),
    cancelSend: cancelSend(deps),
  };
}
