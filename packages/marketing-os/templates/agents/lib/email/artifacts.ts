// VENDORED from packages/skills/email-campaign — do not edit here; swap for the
// published package on next touch (H8.3).

/**
 * Parse + serialize the `email/` repo artifacts (02 §3), mirroring the social
 * pack's discipline: YAML front matter + markdown body via skill-kit's
 * helpers, round-trip guarantee `parse(serialize(x))` deep-equals `x`,
 * document-name context on every error.
 */

import {
  frontMatterDocument as document,
  splitFrontMatter,
  validateFrontMatter as validate,
} from "../skill-kit";
import { z } from "zod";
import type {
  CampaignSection,
  EmailCalendar,
  EmailCalendarSlot,
  EmailCampaign,
  EmailSkeleton,
  EmailStrategy,
} from "./types";
import { CAMPAIGN_STATUSES } from "./types";

// ---------------------------------------------------------------------------
// Canonical repo paths
// ---------------------------------------------------------------------------

export const STRATEGY_PATH = "email/strategy.md";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9._-]+$/;

export function calendarPath(month: string): string {
  if (!MONTH_RE.test(month)) throw new Error(`calendarPath: month must be YYYY-MM, got "${month}"`);
  return `email/calendar/${month}.md`;
}

export function campaignPath(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`campaignPath: invalid campaign id "${id}"`);
  return `email/campaigns/${id}/campaign.md`;
}

export function campaignHtmlPath(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`campaignHtmlPath: invalid campaign id "${id}"`);
  return `email/campaigns/${id}/email.html`;
}

export function campaignAssetsPrefix(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`campaignAssetsPrefix: invalid campaign id "${id}"`);
  return `email/campaigns/${id}/assets/`;
}

export const REGISTRY_PATH = "email/registry.json";

/** Parse email/registry.json (slug → Klaviyo template id). Tolerates an
 * absent file at the caller (readFile returns null); this parses content. */
export function parseRegistry(raw: string): import("./types").EmailTemplateRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${REGISTRY_PATH}: invalid JSON: ${e instanceof Error ? e.message : e}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${REGISTRY_PATH}: expected an object of slug → template id`);
  }
  for (const [slug, id] of Object.entries(parsed)) {
    if (typeof id !== "string" || !id) {
      throw new Error(`${REGISTRY_PATH}: slug "${slug}" maps to a non-string id`);
    }
  }
  return parsed as import("./types").EmailTemplateRegistry;
}

/** Serialize the registry deterministically (sorted slugs, 2-space indent —
 * diffable, matches the Arthaus file's committed shape). */
export function serializeRegistry(registry: import("./types").EmailTemplateRegistry): string {
  const sorted = Object.fromEntries(Object.entries(registry).sort(([a], [b]) => (a < b ? -1 : 1)));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function skeletonPath(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`skeletonPath: invalid skeleton id "${id}"`);
  return `email/templates/skeletons/${id}/skeleton.md`;
}

export function skeletonHtmlPath(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`skeletonHtmlPath: invalid skeleton id "${id}"`);
  return `email/templates/skeletons/${id}/skeleton.html`;
}

// ---------------------------------------------------------------------------
// email/strategy.md
// ---------------------------------------------------------------------------

const strategyFrontMatterSchema = z.object({
  audiences: z
    .array(
      z.object({
        key: z.string().min(1).describe("Stable roster key, e.g. engaged-30d"),
        klaviyoRef: z.object({
          type: z.enum(["list", "segment"]),
          id: z.string().min(1),
        }),
        description: z.string().min(1),
        cadenceCap: z.number().int().positive().describe("Max campaigns/month targeting this audience"),
      }),
    )
    .min(1),
  archetypes: z
    .array(
      z.object({
        name: z.string().min(1),
        messagingRef: z.string().min(1).describe("brand.md messaging framework ref"),
        weight: z.number().positive(),
      }),
    )
    .min(1),
  campaignsPerMonth: z.number().int().positive(),
  sendDays: z
    .array(z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]))
    .min(1),
  sendTime: z.string().regex(/^\d{2}:\d{2}$/, "must be HH:MM"),
  seasonalArcs: z
    .array(
      z.object({
        name: z.string().min(1),
        months: z.array(z.string().regex(MONTH_RE, "must be YYYY-MM")).optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  guardrails: z
    .object({
      maxCampaignsPerWeek: z.number().int().positive().optional(),
      quietPeriods: z
        .array(
          z.object({
            start: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD"),
            end: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD"),
            reason: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export function parseStrategy(raw: string): EmailStrategy {
  const { frontMatter, body } = splitFrontMatter(raw, STRATEGY_PATH);
  const fm = validate(strategyFrontMatterSchema, frontMatter, STRATEGY_PATH);
  const strategy: EmailStrategy = {
    audiences: fm.audiences,
    archetypes: fm.archetypes,
    campaignsPerMonth: fm.campaignsPerMonth,
    sendDays: fm.sendDays,
    sendTime: fm.sendTime,
    body: body.trim(),
  };
  if (fm.seasonalArcs) strategy.seasonalArcs = fm.seasonalArcs;
  if (fm.guardrails) strategy.guardrails = fm.guardrails;
  return strategy;
}

export function serializeStrategy(strategy: EmailStrategy): string {
  const fm: Record<string, unknown> = {
    audiences: strategy.audiences,
    archetypes: strategy.archetypes,
    campaignsPerMonth: strategy.campaignsPerMonth,
    sendDays: strategy.sendDays,
    sendTime: strategy.sendTime,
  };
  if (strategy.seasonalArcs) fm.seasonalArcs = strategy.seasonalArcs;
  if (strategy.guardrails) fm.guardrails = strategy.guardrails;
  return document(fm, strategy.body);
}

// ---------------------------------------------------------------------------
// email/calendar/{YYYY-MM}.md — markdown table body, one row per slot
// ---------------------------------------------------------------------------

const calendarFrontMatterSchema = z.object({
  month: z.string().regex(MONTH_RE, "must be YYYY-MM"),
  status: z.string().min(1),
});

const TABLE_COLUMNS = ["slot", "audience", "archetype", "intent", "campaignId", "status"] as const;

/** Empty-cell marker for unassigned audience/campaignId cells. */
const EMPTY_CELL = "—";

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|");
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function splitRow(line: string): string[] {
  const t = line.trim();
  return t
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

export function parseCalendar(raw: string): EmailCalendar {
  const { frontMatter, body } = splitFrontMatter(raw, "email/calendar");
  const fm = validate(calendarFrontMatterSchema, frontMatter, "email/calendar");

  const lines = body.split(/\r?\n/);
  const slots: EmailCalendarSlot[] = [];
  const noteLines: string[] = [];
  let headerSeen = false;

  for (const line of lines) {
    if (!isTableRow(line)) {
      noteLines.push(line);
      continue;
    }
    if (isSeparatorRow(line)) continue;
    const cells = splitRow(line);
    if (!headerSeen) {
      const got = cells.map((c) => c.toLowerCase());
      const want = TABLE_COLUMNS.map((c) => c.toLowerCase());
      if (got.length !== want.length || got.some((c, i) => c !== want[i])) {
        throw new Error(
          `email/calendar/${fm.month}.md: unexpected table header [${cells.join(", ")}] — expected [${TABLE_COLUMNS.join(", ")}]`,
        );
      }
      headerSeen = true;
      continue;
    }
    if (cells.length !== TABLE_COLUMNS.length) {
      throw new Error(
        `email/calendar/${fm.month}.md: table row has ${cells.length} cells, expected ${TABLE_COLUMNS.length}: "${line.trim()}"`,
      );
    }
    const [slot, audience, archetype, intent, campaignId, status] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!ISO_DATE_RE.test(slot)) {
      throw new Error(`email/calendar/${fm.month}.md: slot "${slot}" is not an ISO date (YYYY-MM-DD)`);
    }
    slots.push({
      slot,
      audience: audience === EMPTY_CELL || audience === "-" || audience === "" ? null : audience,
      archetype,
      intent,
      campaignId: campaignId === EMPTY_CELL || campaignId === "-" || campaignId === "" ? null : campaignId,
      status,
    });
  }

  const notes = noteLines.join("\n").trim();
  const calendar: EmailCalendar = { month: fm.month, status: fm.status, slots };
  if (notes) calendar.notes = notes;
  return calendar;
}

export function serializeCalendar(calendar: EmailCalendar): string {
  const fm = { month: calendar.month, status: calendar.status };
  const rows: string[] = [
    `| ${TABLE_COLUMNS.join(" | ")} |`,
    `|${TABLE_COLUMNS.map(() => " --- ").join("|")}|`,
    ...calendar.slots.map(
      (s) =>
        `| ${s.slot} | ${s.audience ?? EMPTY_CELL} | ${s.archetype} | ${s.intent} | ${s.campaignId ?? EMPTY_CELL} | ${s.status} |`,
    ),
  ];
  const parts: string[] = [];
  if (calendar.notes) parts.push(calendar.notes.trim(), "");
  parts.push(rows.join("\n"));
  return document(fm, parts.join("\n"));
}

// ---------------------------------------------------------------------------
// email/campaigns/{id}/campaign.md
// ---------------------------------------------------------------------------

const audienceRefSchema = z.object({
  key: z.string().optional(),
  type: z.enum(["list", "segment"]),
  id: z.string().min(1),
  name: z.string().optional(),
  estimatedSize: z.number().int().nonnegative().optional(),
});

const sectionSchema = z.discriminatedUnion("type", [
  z.object({
    slot: z.string().min(1),
    type: z.literal("surface"),
    alt: z.string().min(1).describe("Describes the message, not the pixels — mandatory (04 §5)"),
    surfaceId: z.string().optional(),
    boardName: z.string().optional(),
    assetPath: z.string().optional(),
    imageUrl: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    slot: z.string().min(1),
    type: z.literal("html"),
    blocks: z.array(z.record(z.string(), z.unknown())).min(1),
  }),
]);

const campaignFrontMatterSchema = z.object({
  id: z.string().regex(ID_RE),
  archetype: z.string().min(1),
  audience: z.object({
    included: z.array(audienceRefSchema).min(1),
    excluded: z.array(audienceRefSchema).optional(),
  }),
  subjectCandidates: z.array(z.string()),
  subject: z.string().optional(),
  previewText: z.string().optional(),
  copyFormulaRef: z.string().optional(),
  skeletonRef: z.string().min(1),
  sections: z.array(sectionSchema),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  utm: z.object({
    campaign: z.string().min(1),
    source: z.string().min(1),
    medium: z.string().min(1),
  }),
  klaviyo: z
    .object({
      templateId: z.string().optional(),
      campaignId: z.string().optional(),
      messageId: z.string().optional(),
      sendJobStatus: z.string().optional(),
    })
    .optional(),
  provenance: z.array(
    z.object({
      claim: z.string().min(1),
      origin: z.enum(["owner", "agent", "data"]),
    }),
  ),
  status: z.enum(CAMPAIGN_STATUSES),
});

export function parseCampaign(raw: string): EmailCampaign {
  const { frontMatter, body } = splitFrontMatter(raw, "email/campaigns/*/campaign.md");
  const fm = validate(campaignFrontMatterSchema, frontMatter, "email/campaigns/*/campaign.md");
  const campaign: EmailCampaign = {
    id: fm.id,
    archetype: fm.archetype,
    audience: fm.audience,
    subjectCandidates: fm.subjectCandidates,
    skeletonRef: fm.skeletonRef,
    sections: fm.sections as CampaignSection[],
    utm: fm.utm,
    provenance: fm.provenance,
    status: fm.status,
    body: body.trim(),
  };
  if (fm.subject !== undefined) campaign.subject = fm.subject;
  if (fm.previewText !== undefined) campaign.previewText = fm.previewText;
  if (fm.copyFormulaRef !== undefined) campaign.copyFormulaRef = fm.copyFormulaRef;
  if (fm.scheduledAt !== undefined) campaign.scheduledAt = fm.scheduledAt;
  if (fm.klaviyo !== undefined) campaign.klaviyo = fm.klaviyo;
  return campaign;
}

export function serializeCampaign(campaign: EmailCampaign): string {
  const fm: Record<string, unknown> = {
    id: campaign.id,
    archetype: campaign.archetype,
    audience: campaign.audience,
    subjectCandidates: campaign.subjectCandidates,
  };
  if (campaign.subject !== undefined) fm.subject = campaign.subject;
  if (campaign.previewText !== undefined) fm.previewText = campaign.previewText;
  if (campaign.copyFormulaRef !== undefined) fm.copyFormulaRef = campaign.copyFormulaRef;
  fm.skeletonRef = campaign.skeletonRef;
  fm.sections = campaign.sections;
  if (campaign.scheduledAt !== undefined) fm.scheduledAt = campaign.scheduledAt;
  fm.utm = campaign.utm;
  if (campaign.klaviyo !== undefined) fm.klaviyo = campaign.klaviyo;
  fm.provenance = campaign.provenance;
  fm.status = campaign.status;
  return document(fm, campaign.body);
}

// ---------------------------------------------------------------------------
// email/templates/skeletons/{id}/skeleton.md
// ---------------------------------------------------------------------------

const skeletonFrontMatterSchema = z.object({
  id: z.string().regex(ID_RE),
  sourceTemplateId: z.string().min(1),
  sourceTemplateName: z.string().optional(),
  ingestedAt: z.string().datetime({ offset: true }),
  transforms: z.array(z.string()),
  slots: z.array(
    z.object({
      name: z.string().min(1),
      maxWidth: z.number().int().positive().optional(),
      backgroundContext: z.string().optional(),
      paddingContext: z.string().optional(),
    }),
  ),
  version: z.number().int().positive(),
  approvedBy: z.string().optional(),
});

export function parseSkeleton(raw: string): EmailSkeleton {
  const { frontMatter, body } = splitFrontMatter(raw, "email/templates/skeletons/*/skeleton.md");
  const fm = validate(skeletonFrontMatterSchema, frontMatter, "email/templates/skeletons/*/skeleton.md");
  const skeleton: EmailSkeleton = {
    id: fm.id,
    sourceTemplateId: fm.sourceTemplateId,
    ingestedAt: fm.ingestedAt,
    transforms: fm.transforms,
    slots: fm.slots,
    version: fm.version,
    body: body.trim(),
  };
  if (fm.sourceTemplateName !== undefined) skeleton.sourceTemplateName = fm.sourceTemplateName;
  if (fm.approvedBy !== undefined) skeleton.approvedBy = fm.approvedBy;
  return skeleton;
}

export function serializeSkeleton(skeleton: EmailSkeleton): string {
  const fm: Record<string, unknown> = {
    id: skeleton.id,
    sourceTemplateId: skeleton.sourceTemplateId,
  };
  if (skeleton.sourceTemplateName !== undefined) fm.sourceTemplateName = skeleton.sourceTemplateName;
  fm.ingestedAt = skeleton.ingestedAt;
  fm.transforms = skeleton.transforms;
  fm.slots = skeleton.slots;
  fm.version = skeleton.version;
  if (skeleton.approvedBy !== undefined) fm.approvedBy = skeleton.approvedBy;
  return document(fm, skeleton.body);
}
