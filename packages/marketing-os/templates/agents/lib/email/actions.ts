// VENDORED from packages/skills/email-campaign — do not edit here; swap for the
// published package on next touch (H8.3).

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
import { checkDiscounts } from "./discount-refs";
import { syncCampaignIndex } from "./index-sync";
import { getTenant } from "../tenant-context";
import { DEFAULT_ALLOWED_IMAGE_HOSTS, hostAllowed } from "../email-assembly/invariants";
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
  strategyPathFor,
  calendarPath,
  campaignPath,
  campaignTemplatePath,
  registryPathFor,
  resolveEmailRoot,
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

/**
 * Write the artifact AND the projection the console reads.
 *
 * Files are truth, but the console and calendar read mos_email_campaigns /
 * mos_calendar_items, so an Action that only wrote the file left the UI
 * showing the previous status. Five campaigns sat at "proposed" on the
 * dashboard for an hour after being approved, and one showed "approved"
 * while it was already scheduled to send — the operator's own screen
 * disagreeing with the system about what had been authorised.
 *
 * Every Action mutates through here, so this is the one place that closes
 * it. Index failures are swallowed and logged inside syncCampaignIndex: a
 * stale projection is bad, but failing an approved Action because a cache
 * write hiccuped is worse — the file has already been written by then.
 */
async function saveCampaign(repo: EmailRepo, campaign: EmailCampaign): Promise<void> {
  await repo.writeFile(campaignPath(campaign.id), serializeCampaign(campaign));
  await syncCampaignIndex(getTenant().shop, campaign);
}

async function loadStrategy(repo: EmailRepo): Promise<EmailStrategy> {
  const root = await resolveEmailRoot(repo);
  const raw = await repo.readFile(strategyPathFor(root));
  if (raw === null) throw new Error(`${strategyPathFor(root)} not found — co-create the strategy first`);
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
        // One roster key can name several Klaviyo audiences (see
        // StrategyAudience.alsoInclude): the planner rotates KEYS, so a store
        // whose "full list" is spread across a newsletter list, an imported
        // list and a customers segment expresses that as one key, not three.
        const included: CampaignAudienceRef[] = roster
          ? [
              { key: roster.key, type: roster.klaviyoRef.type, id: roster.klaviyoRef.id, name: roster.description },
              ...(roster.alsoInclude ?? []).map((r) => ({
                key: roster.key,
                type: r.type,
                id: r.id,
                ...(r.name ? { name: r.name } : {}),
              })),
            ]
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

/**
 * Re-host every image the campaign references onto Klaviyo, in place.
 *
 * The draft step used to upload only design-surface board exports, because when
 * it was written a campaign's imagery WAS its boards. That stopped being true
 * the moment campaigns began pulling product shots from Shopify's CDN, artist
 * portraits from collections and graph tiles from picasso.arthaus.cloud — none
 * of them Klaviyo hosts, so assembly failed `img-host-untrusted` and the Labor
 * Day campaign could not be drafted at all.
 *
 * Uploading rather than widening the allowlist is the right way round. A sent
 * email outlives the page that referenced its images: Shopify can rotate a CDN
 * path, our own asset links are HMAC-signed and expire by design, and either
 * failure surfaces as a broken image in an inbox weeks later, where nobody is
 * looking. Klaviyo-hosted copies are immutable, which is what the invariant was
 * asking for.
 *
 * Deduplicated by source URL — the same piece routinely appears in a product
 * row and again in a graph callout — and the campaign is saved after each
 * upload so a partial run resumes rather than re-uploading.
 */
async function hostImagesOnKlaviyo(
  deps: EmailActionDeps,
  campaign: EmailCampaign,
  save: () => Promise<void>,
): Promise<string[]> {
  const setters = new Map<string, Array<(url: string) => void>>();
  const add = (url: unknown, set: (u: string) => void) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    if (hostAllowed(host, DEFAULT_ALLOWED_IMAGE_HOSTS)) return;
    const list = setters.get(url) ?? [];
    list.push(set);
    setters.set(url, list);
  };

  for (const section of campaign.sections) {
    if (section.type === "surface") {
      add((section as { imageUrl?: string }).imageUrl, (u) => {
        (section as { imageUrl?: string }).imageUrl = u;
      });
      continue;
    }
    for (const block of (section as { blocks?: Array<Record<string, unknown>> }).blocks ?? []) {
      add(block.imageUrl, (u) => { block.imageUrl = u; });
      add(block.portraitUrl, (u) => { block.portraitUrl = u; });
      for (const key of ["products", "pieces", "items"]) {
        for (const item of (block[key] as Array<Record<string, unknown>>) ?? []) {
          add(item.imageUrl, (u) => { item.imageUrl = u; });
        }
      }
    }
  }
  if (setters.size === 0) return [];

  /**
   * Klaviyo's image upload accepts jpeg, png and gif only. The art graph serves
   * `.webp`, which re-hosting passed straight through, and three of five drafts
   * died on `unsupported media type "image/webp"` after a human had already
   * approved them.
   *
   * Rather than add an image-processing dependency to convert bytes we do not
   * need to decode, ask the origin for a format it already has: the graph
   * serves the same artwork at the same path with a `.jpg` extension. Verified
   * against picasso.arthaus.cloud — same path, `image/jpeg`, 200.
   *
   * Falls back to the original URL when the jpeg twin is not there, so a host
   * without that convention degrades to the old behaviour and the upload's own
   * error still names the type.
   */
  const jpegTwin = async (url: string): Promise<string> => {
    if (!/\.webp(\?|$)/i.test(url)) return url;
    const twin = url.replace(/\.webp(?=\?|$)/i, ".jpg");
    try {
      const head = await fetch(twin, { method: "HEAD" });
      const type = (head.headers.get("content-type") ?? "").toLowerCase();
      if (head.ok && type.startsWith("image/") && !type.includes("webp")) return twin;
    } catch {
      /* fall through to the original */
    }
    return url;
  };

  const done: string[] = [];
  for (const [rawUrl, apply] of setters) {
    const url = await jpegTwin(rawUrl);
    // fetch() throws for DNS and transport failures, and undici's message for
    // all of them is the bare string "fetch failed" — no URL, no cause. That
    // reached the approval audit verbatim and cost two approval cycles before
    // anyone could see that ONE artifact held a typo'd host, `cdn..shopify.com`.
    // Whatever goes wrong here, the URL goes with it.
    let res: Response;
    try {
      res = await fetch(url);
    } catch (cause) {
      throw new Error(
        `could not reach ${url} to re-host it on Klaviyo ` +
          `(${cause instanceof Error ? cause.message : String(cause)}). ` +
          `Check the URL is well-formed and the host is reachable.`,
        { cause },
      );
    }
    if (!res.ok) {
      throw new Error(
        `could not fetch ${url} to re-host it on Klaviyo (HTTP ${res.status}). ` +
          `A campaign cannot be drafted while one of its images is unreachable.`,
      );
    }
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const mediaType = type.startsWith("image/") ? (type === "image/jpg" ? "image/jpeg" : type) : "image/jpeg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    const uploaded = await deps.klaviyo.uploadImage({
      name: `${campaign.id}-${sha256(url).slice(0, 12)}`,
      data: bytes,
      mediaType,
    });
    for (const set of apply) set(uploaded.imageUrl);
    done.push(uploaded.imageUrl);
  }
  // Saved ONCE, not per upload. The store repo is git-backed, so every save is
  // a commit: the first real draft made eight of them in 27 seconds, a fifth of
  // the route's 120s budget spent on version control rather than work, and it
  // scales with the number of images.
  //
  // The cost is coarser resume — a run that dies mid-loop re-uploads the images
  // it had already done, making orphan copies in Klaviyo's library. That is
  // cheap and invisible; burning the request budget is neither.
  if (done.length > 0) await save();
  return done;
}

/**
 * `imagesWillBeRehosted` is for PREVIEW only. The card is shown before execute
 * has uploaded anything, so a campaign carrying Shopify or Picasso image URLs
 * fails `img-host-untrusted` at exactly the moment a human is deciding — for a
 * problem execute is about to fix on its own. Preview forgives that one code
 * and nothing else; execute runs strict, after the upload, where the invariant
 * is telling the truth about what ships.
 */
async function draftReadiness(
  deps: EmailActionDeps,
  campaign: EmailCampaign,
  opts?: { imagesWillBeRehosted?: boolean },
): Promise<AssembledEmail> {
  if (campaign.status !== "approved" && campaign.status !== "drafted") {
    throw new Error(
      `campaign "${campaign.id}" is "${campaign.status}" — only approved campaigns draft (approve the plan first)`,
    );
  }
  if (!campaign.subject) throw new Error(`campaign "${campaign.id}" has no chosen subject — pick one of the candidates`);
  if (!campaign.previewText) throw new Error(`campaign "${campaign.id}" has no previewText`);
  if (campaign.sections.length === 0) throw new Error(`campaign "${campaign.id}" has no sections — draft the content first`);
  if (campaign.audience.included.length === 0) throw new Error(`campaign "${campaign.id}" has no audience`);
  // Checked again here, not only at approval. Approval and drafting are
  // separated by a human and by time, and a code can be deleted or an approved
  // campaign edited in between — the last gate before the ESP should not
  // inherit an older gate's answer.
  const discounts = await checkDiscounts(campaign);
  if (discounts.errors.length > 0) throw new Error(discounts.errors.join(" "));
  for (const w of discounts.warnings) console.warn(`[email/draft] ${campaign.id}: ${w}`);
  const assembled = await deps.assemble(campaign);
  const blocking = opts?.imagesWillBeRehosted
    ? assembled.report.errors.filter((e) => !e.includes("img-host-untrusted"))
    : assembled.report.errors;
  if (blocking.length > 0) {
    throw new Error(
      `assembly invariants failed for "${campaign.id}": ${blocking.join("; ")} — fix before drafting (04 §6)`,
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
      const assembled = await draftReadiness(deps, campaign, { imagesWillBeRehosted: true });
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

      // Step 1b — every OTHER image the campaign points at (product shots, wall
      // rooms, artist portraits, graph tiles) onto Klaviyo too. Without this the
      // assembly invariant below rejects the campaign outright.
      const hosted = await hostImagesOnKlaviyo(deps, campaign, () => saveCampaign(deps.repo, campaign));
      if (hosted.length > 0) steps.push(`images:${hosted.length}`);

      // Step 2 — assemble the final HTML (now with Klaviyo-hosted image URLs)
      // and persist it: email.html is EXACTLY what lands in Klaviyo.
      const assembled = await deps.assemble(campaign);
      if (!assembled.report.ok) {
        throw new Error(`assembly failed post-upload: ${assembled.report.errors.join("; ")}`);
      }
      // The rendered template lands in the store's email root — for an
      // `emails/` store that's the real Klaviyo templates dir, pushable/
      // triggerable through the existing tooling.
      const root = await resolveEmailRoot(deps.repo);
      await deps.repo.writeFile(campaignTemplatePath(campaign.id, root), assembled.html);

      // Step 3 — template via the registry (PATCH-not-duplicate, 06 §4).
      const registryPath = registryPathFor(root);
      const registryRaw = await deps.repo.readFile(registryPath);
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
        await deps.repo.writeFile(registryPath, serializeRegistry(registry));
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
      const root = await resolveEmailRoot(deps.repo);
      const draftedHtml = await deps.repo.readFile(campaignTemplatePath(campaign.id, root));
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
// email.approve_campaign (medium) — one existing campaign → approved
// ---------------------------------------------------------------------------

const approveCampaignParams = z.object({
  campaignId: z.string().min(1),
});
export type ApproveCampaignParams = z.infer<typeof approveCampaignParams>;

/**
 * Approve ONE campaign that already exists.
 *
 * `email.approve_plan` was the only route to `approved`, and it walks a month's
 * calendar and CREATES campaigns from its slots. A campaign authored directly —
 * which is how every Arthaus September campaign was written, from a chat prompt
 * rather than from an approved plan — has no calendar slot to be walked, so it
 * could never be approved, and `createCampaignDraft` refuses anything that is
 * not approved. The result was a campaign that could be written, rendered,
 * reviewed and committed, and then had no path to the ESP at all.
 *
 * Approving still authorises DRAFTING only. Sending remains its own approval,
 * as it does through the plan route — this closes a hole in the path, it does
 * not shorten it.
 */
function approveCampaign(deps: EmailActionDeps): Action<ApproveCampaignParams> {
  return {
    kind: "email.approve_campaign",
    title: "Approve a campaign for drafting",
    paramsSchema: approveCampaignParams,
    summary: (p) => `Approve campaign ${p.campaignId} (authorizes drafting only — sending approves separately)`,
    scopes: ["email:write_plan"],
    risk: "medium",
    async preview(p) {
      const campaign = await loadCampaign(deps.repo, p.campaignId);
      if (campaign.status !== "proposed") {
        throw new Error(
          `campaign "${p.campaignId}" is "${campaign.status}", not "proposed" — nothing to approve`,
        );
      }
      const warnings: string[] = [];
      if (!campaign.subject) warnings.push("No subject line.");
      if (!campaign.previewText) warnings.push("No preview text.");
      if (!campaign.sections.length) warnings.push("No sections — this campaign has no body.");
      if (!campaign.audience.included.length) warnings.push("No audience — it can be drafted but never sent.");
      const when = campaign.scheduledAt ? new Date(campaign.scheduledAt) : null;
      if (when && when.getTime() < Date.now()) {
        warnings.push(
          `Its send date (${campaign.scheduledAt}) has already passed. Reschedule before staging, or it will draft against a date in the past.`,
        );
      }
      // A campaign that promises a code the store does not have must not be
      // approvable. Everything softer than that is a warning.
      const discounts = await checkDiscounts(campaign);
      if (discounts.errors.length > 0) throw new Error(discounts.errors.join(" "));
      warnings.push(...discounts.warnings);

      const audience = campaign.audience.included
        .map((a) => `${a.name ?? a.key ?? a.id}${a.estimatedSize ? ` (~${a.estimatedSize.toLocaleString()})` : ""}`)
        .join(", ");
      return {
        summary: `Approve "${campaign.subject ?? p.campaignId}" for drafting — nothing is created in Klaviyo and nothing sends`,
        rows: [
          { label: "Campaign", value: campaign.id },
          { label: "Archetype", value: campaign.archetype },
          { label: "Subject", value: campaign.subject ?? "—" },
          { label: "Audience", value: audience || "—" },
          { label: "Scheduled", value: campaign.scheduledAt ?? "—" },
          { label: "Sections", value: String(campaign.sections.length) },
          ...(campaign.discountCode
            ? [{
                label: "Discount code",
                value: `${campaign.discountCode} — ${discounts.checks[0]?.verdict === "exists" ? "confirmed in Shopify" : "unconfirmed"}`,
              }]
            : []),
        ],
        ...(warnings.length ? { warnings } : {}),
        previewHash: hashMaterial({
          kind: "email.approve_campaign",
          id: campaign.id,
          // The whole artifact: approving content that then changes would make
          // the approval a statement about something that no longer exists.
          artifact: serializeCampaign(campaign),
        }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const campaign = await loadCampaign(deps.repo, p.campaignId);
      if (campaign.status === "approved") {
        // Idempotent: a retried approval is not an error.
        return { ok: true, summary: `Campaign ${p.campaignId} was already approved`, detail: { id: p.campaignId } };
      }
      if (campaign.status !== "proposed") {
        throw new Error(`campaign "${p.campaignId}" is "${campaign.status}" — only a proposed campaign can be approved`);
      }
      const next: EmailCampaign = {
        ...campaign,
        status: "approved",
        provenance: [
          ...campaign.provenance,
          { claim: "approved for drafting by an owner through the Action gate", origin: "owner" },
        ],
      };
      await deps.repo.writeFile(campaignPath(next.id), serializeCampaign(next));
      return {
        ok: true,
        summary: `Campaign ${next.id} approved — ready for klaviyo.create_campaign_draft`,
        detail: { id: next.id, status: "approved" },
      };
    },
  };
}

// ---------------------------------------------------------------------------

export function createEmailActions(deps: EmailActionDeps): {
  approvePlan: Action<ApprovePlanParams>;
  approveCampaign: Action<ApproveCampaignParams>;
  createCampaignDraft: Action<CreateDraftParams>;
  scheduleCampaign: Action<ScheduleParams>;
  cancelSend: Action<CancelParams>;
} {
  return {
    approvePlan: approvePlan(deps),
    approveCampaign: approveCampaign(deps),
    createCampaignDraft: createCampaignDraft(deps),
    scheduleCampaign: scheduleCampaign(deps),
    cancelSend: cancelSend(deps),
  };
}
