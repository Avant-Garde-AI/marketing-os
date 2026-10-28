/**
 * Email autopilot, runtime half (docs/plans/EMAIL-AUTOPILOT.md).
 *
 * The platform owns the standing grant and decides every release. This file
 * only (a) reads the store's REQUESTED policy so an owner can ask for a grant,
 * and (b) stages a window deterministically: for each campaign in the window it
 * checks the granted policy and raises the next lifecycle Action through the
 * gate with `delegation` attached. The gate re-verifies all of it; anything it
 * refuses is left for a person, with the reason. No model is involved here.
 */
import { z } from "zod";
import { splitFrontMatter, validateFrontMatter } from "../skill-kit/front-matter";
import { proposeDelegated, type DelegatedOutcome } from "../actions/propose";
import { emailReviewLink } from "./review-links";
import { campaignPath, parseCampaign, parseStrategy, resolveEmailRoot, strategyPathFor } from "./artifacts";
import type { EmailCampaign, EmailRepo, EmailStrategy } from "./types";

export const AUTOPILOT_POLICY_PATH = "email/autopilot.md";

/** Mirrors marketing-os-app's autopilot-policy.ts; the platform's copy is authoritative. */
export const emailAutopilotPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    timeZone: z.string().min(1),
    firstWindowStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    batchDays: z.literal(14),
    leadDays: z.number().int().min(3).max(14),
    holdHours: z.number().int().min(24).max(96),
    sendDays: z.array(z.enum(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"])).min(1),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    archetypes: z.array(z.string()).min(1),
    audiences: z.array(z.string()).min(1),
    maxCampaignsPerWindow: z.number().int().min(1).max(14),
    // Weekly programmes (marketing-os-app autopilot-policy.ts). Parsed here so
    // the owner can request a grant that carries them; the stager itself is
    // always sent a narrowed, programme-free policy by the platform.
    programmes: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
            archetype: z.string().min(1),
            audience: z.string().min(1),
            sendDay: z.enum(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]),
            localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            prepareDaysBefore: z.number().int().min(2).max(6),
          })
          .strict(),
      )
      .max(4)
      .optional(),
  })
  .strict();
export type EmailAutopilotPolicy = z.infer<typeof emailAutopilotPolicySchema>;

export function parseAutopilotPolicy(raw: string): EmailAutopilotPolicy {
  return validateFrontMatter(emailAutopilotPolicySchema, splitFrontMatter(raw, AUTOPILOT_POLICY_PATH).frontMatter, AUTOPILOT_POLICY_PATH);
}

/**
 * What a connector token scoped `autopilot:author` may call: reads, campaign
 * upserts and renders. Approving, drafting, scheduling, strategy and anything
 * social or design-library are deliberately absent — the author writes, the
 * stager stages, a person or the grant decides.
 */
export const AUTOPILOT_AUTHOR_TOOLS: ReadonlySet<string> = new Set([
  "email_strategy_read", "email_campaigns_list", "email_campaign_read", "email_calendar_read", "email_plan_propose",
  "email_campaign_upsert", "email_render_preview", "email_review_notes", "email_review_sheet",
  "email_campaign_retrospective", "artist_profile_read", "imagery_resolve", "imagery_rooms", "gallery_wall_sets_read",
  "check_design_library", "list_design_surfaces", "klaviyo_audiences_read", "klaviyo_audience_explain",
  "klaviyo_performance_read", "explore_schema", "describe_field", "query", "explain_query", "social_calendar_read",
  "catalog_new_artists", "catalog_handle_artists", "artwork_image_read",
]);

export interface StageWindow {
  from: string;
  through: string;
  slots: string[];
  /** A programme week stages only its own archetype… */
  onlyArchetypes?: string[];
  /** …and a fortnight leaves programme archetypes to their own weeks. */
  skipArchetypes?: string[];
}

export interface StagedItem {
  campaignId: string;
  subject?: string;
  archetype?: string;
  scheduledAt?: string;
  reviewUrl?: string;
  state: "held" | "manual" | "scheduled";
  reason?: string;
  scheduleProposalId?: string;
}

/** Strategy audience keys a campaign's audience resolves to, or null if any ref is unknown. */
export function audienceKeysFor(campaign: EmailCampaign, strategy: EmailStrategy): string[] | null {
  const keys = new Set<string>();
  for (const ref of campaign.audience.included) {
    const match = strategy.audiences.find(
      (a) =>
        (ref.key && a.key === ref.key) ||
        (a.klaviyoRef.type === ref.type && a.klaviyoRef.id === ref.id) ||
        (a.alsoInclude ?? []).some((x) => x.type === ref.type && x.id === ref.id),
    );
    if (!match) return null;
    keys.add(match.key);
  }
  return keys.size ? [...keys] : null;
}

/** Campaigns whose send time falls inside the window, oldest first. */
export async function windowCampaigns(repo: EmailRepo, window: StageWindow): Promise<EmailCampaign[]> {
  const from = Date.parse(`${window.from}T00:00:00Z`) - 86_400_000; // local-day slack either side
  const through = Date.parse(`${window.through}T00:00:00Z`) + 2 * 86_400_000;
  const files = (await repo.list("email/campaigns/")).filter((f) => f.endsWith("/campaign.md"));
  const out: EmailCampaign[] = [];
  for (const file of files) {
    const raw = await repo.readFile(file);
    if (!raw) continue;
    let campaign: EmailCampaign;
    try {
      campaign = parseCampaign(raw);
    } catch {
      continue; // a malformed artifact is never staged; the author's render step reports it
    }
    const at = Date.parse(campaign.scheduledAt ?? "");
    if (Number.isFinite(at) && at >= from && at < through) out.push(campaign);
  }
  return out.sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
}

/**
 * Pre-check one campaign against the granted policy. Returns the claims to
 * attach, or why it is left for a person. The gate repeats these checks.
 */
export function eligibility(
  campaign: EmailCampaign,
  strategy: EmailStrategy,
  policy: EmailAutopilotPolicy,
  window: StageWindow,
): { claims: { campaignId: string; archetype: string; audienceKeys: string[]; scheduledAt: string } } | { reason: string } {
  const at = Date.parse(campaign.scheduledAt ?? "");
  if (!window.slots.some((s) => Date.parse(s) === at)) return { reason: "not on a send slot" };
  if (!policy.archetypes.includes(campaign.archetype)) return { reason: `${campaign.archetype} is not covered by the grant` };
  const keys = audienceKeysFor(campaign, strategy);
  if (!keys) return { reason: "audience is not a strategy audience" };
  const outside = keys.filter((k) => !policy.audiences.includes(k));
  if (outside.length) return { reason: `audience ${outside.join(", ")} is not covered by the grant` };
  return {
    claims: { campaignId: campaign.id, archetype: campaign.archetype, audienceKeys: keys, scheduledAt: campaign.scheduledAt! },
  };
}

type Propose = (input: {
  kind: string;
  params: Record<string, unknown>;
  delegation: { grantId: string; batchId: string; claims: unknown };
}) => Promise<DelegatedOutcome>;

/**
 * Advance every campaign in the window as far as the grant allows, within a
 * time budget. Re-entrant: each call re-reads campaign status, and the gate
 * returns the pending schedule proposal rather than raising a second one.
 */
export async function stageWindow(input: {
  repo: EmailRepo;
  shop: string;
  grantId: string;
  batchId: string;
  policy: EmailAutopilotPolicy;
  window: StageWindow;
  deadline: number;
  propose?: Propose;
  now?: () => number;
}): Promise<{ done: boolean; items: StagedItem[] }> {
  const propose = input.propose ?? proposeDelegated;
  const now = input.now ?? Date.now;
  const root = await resolveEmailRoot(input.repo);
  const strategyRaw = await input.repo.readFile(strategyPathFor(root));
  if (!strategyRaw) throw new Error("the store has no email strategy to stage against");
  const strategy = parseStrategy(strategyRaw);
  const delegation = { grantId: input.grantId, batchId: input.batchId };
  const items: StagedItem[] = [];
  let done = true;

  for (const listed of await windowCampaigns(input.repo, input.window)) {
    // Campaigns a day either side of the window are listed; another batch's
    // archetypes are that batch's business, not a "needs a person" line here.
    if (input.window.onlyArchetypes && !input.window.onlyArchetypes.includes(listed.archetype)) continue;
    if (input.window.skipArchetypes?.includes(listed.archetype)) continue;
    const base = {
      campaignId: listed.id,
      subject: listed.subject,
      archetype: listed.archetype,
      scheduledAt: listed.scheduledAt,
      reviewUrl: emailReviewLink(input.shop, listed.id).url,
    };
    if (["sent", "measured", "declined", "cancelled", "failed"].includes(listed.status)) continue;
    if (listed.status === "scheduled") {
      items.push({ ...base, state: "scheduled" });
      continue;
    }
    if (now() > input.deadline) {
      done = false;
      continue;
    }
    const check = eligibility(listed, strategy, input.policy, input.window);
    if ("reason" in check) {
      items.push({ ...base, state: "manual", reason: check.reason });
      continue;
    }
    const step = async (kind: string, params: Record<string, unknown>) =>
      propose({ kind, params, delegation: { ...delegation, claims: check.claims } });
    const reread = async () => parseCampaign((await input.repo.readFile(campaignPath(listed.id)))!);

    try {
      let campaign = listed;
      if (campaign.status === "proposed") {
        const r = await step("email.approve_campaign", { campaignId: campaign.id });
        if (r.refused || r.released?.status !== "executed") {
          items.push({ ...base, state: "manual", reason: r.refused ?? r.released?.message ?? "approval did not run" });
          continue;
        }
        campaign = await reread();
      }
      const schedule = () => step("klaviyo.schedule_campaign", { campaignId: campaign.id, sendAt: campaign.scheduledAt });
      // Not drafted yet, or changed since it was drafted: schedule's preview
      // refuses, so (re-)draft first, then schedule.
      let scheduled: DelegatedOutcome | null = campaign.status === "drafted" ? await schedule().catch(() => null) : null;
      if (!scheduled) {
        const drafted = await step("klaviyo.create_campaign_draft", { campaignId: campaign.id });
        if (drafted.refused || drafted.released?.status !== "executed") {
          items.push({ ...base, state: "manual", reason: drafted.refused ?? drafted.released?.message ?? "draft did not run" });
          continue;
        }
        scheduled = await schedule();
      }
      if (scheduled.refused) {
        items.push({ ...base, state: "manual", reason: scheduled.refused });
        continue;
      }
      items.push({ ...base, state: "held", scheduleProposalId: scheduled.proposalId });
    } catch (e) {
      items.push({ ...base, state: "manual", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    }
  }
  return { done, items };
}
