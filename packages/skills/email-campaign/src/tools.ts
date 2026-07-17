/**
 * The pack's read tools (02 §1 — "reads compose freely", spec 20 §3).
 *
 * All UNGATED. Nothing here mutates Klaviyo or writes the repo — plan
 * proposals are returned to the agent (structure + serialized markdown);
 * persisting/approving them is an Action on the spec 20 framework.
 *
 * Two seams (02 §1, factories over bindings): `EmailRepo` (the store repo)
 * and `KlaviyoClient` (the pack-owned interface; broker-backed impl in the
 * hosted runtime, fakes in tests). The pack never sees a credential.
 */

import { z } from "zod";
import type {
  EmailRepo,
  EmailStrategy,
  KlaviyoClient,
  SkillToolDefinition,
} from "./types";
import {
  STRATEGY_PATH,
  calendarPath,
  campaignPath,
  parseCalendar,
  parseCampaign,
  parseStrategy,
} from "./artifacts";
import { analyzeEmailCalendarGaps, proposeEmailPlan } from "./plan";

// ---------------------------------------------------------------------------
// Universal-content inlining (03 §3: blocks cannot be referenced in API
// payloads — they must be fetched and inlined before a template's HTML is
// reused). The exact in-HTML reference syntax is a documented uncertainty
// (03 §12); this matches the Django-style tag form and is deliberately
// centralized so a build-time finding updates one place.
// ---------------------------------------------------------------------------

const UNIVERSAL_CONTENT_RE = /\{%\s*universal_content\s+id=["']([^"']+)["']\s*%\}/g;

export function inlineUniversalContent(
  html: string,
  blocks: Map<string, string>,
): { html: string; inlined: string[]; unresolved: string[] } {
  const inlined: string[] = [];
  const unresolved: string[] = [];
  const out = html.replace(UNIVERSAL_CONTENT_RE, (match, id: string) => {
    const block = blocks.get(id);
    if (block === undefined) {
      unresolved.push(id);
      return match; // leave the tag; the caller decides how loud to be
    }
    inlined.push(id);
    return block;
  });
  return { html: out, inlined, unresolved };
}

// ---------------------------------------------------------------------------
// Zod schemas (tool I/O)
// ---------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthSchema = z.string().regex(MONTH_RE, "YYYY-MM").describe("Calendar month, YYYY-MM");

const slotSchema = z.object({
  slot: z.string().describe("ISO date (YYYY-MM-DD)"),
  audience: z.string().nullable(),
  archetype: z.string(),
  intent: z.string(),
  campaignId: z.string().nullable(),
  status: z.string(),
});

const planProposeInput = z.object({
  month: monthSchema,
  campaignsOverride: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Override strategy.campaignsPerMonth for this proposal"),
  context: z
    .object({
      topMovers: z
        .array(z.string())
        .optional()
        .describe("Top-moving products/collections from the semantic layer"),
      seasonal: z.string().optional().describe("Seasonal context to weave into slot rationales"),
      readback: z
        .array(z.string())
        .optional()
        .describe("Readback highlights from prior campaigns, cited in rationales"),
    })
    .optional(),
});

const planProposeOutput = z.object({
  month: monthSchema,
  status: z.literal("proposed"),
  slots: z.array(slotSchema.extend({ rationale: z.string().describe("Why this slot exists") })),
  calendarMarkdown: z
    .string()
    .describe("The draft serialized as email/calendar/{month}.md, ready to propose"),
  summary: z.string(),
  warnings: z.array(z.string()).describe("Guardrail-driven drops/unassignments, stated honestly"),
});

const calendarReadInput = z.object({ month: monthSchema });

const gapSchema = z.object({
  unassignedSlots: z.array(slotSchema),
  audiencelessSlots: z.array(slotSchema),
  archetypeBalance: z.array(
    z.object({
      archetype: z.string(),
      weight: z.number(),
      expectedCount: z.number(),
      actualCount: z.number(),
      underRepresented: z.boolean(),
    }),
  ),
  missingArchetypes: z.array(z.string()),
  audienceContact: z.array(
    z.object({
      audience: z.string(),
      cadenceCap: z.number(),
      plannedCount: z.number(),
      overCap: z.boolean(),
    }),
  ),
  quietPeriodViolations: z.array(slotSchema),
});

const calendarReadOutput = z.object({
  month: monthSchema,
  status: z.string(),
  slots: z.array(slotSchema),
  notes: z.string().optional(),
  gaps: gapSchema,
});

const campaignReadInput = z.object({ id: z.string().min(1).describe("Campaign id") });

const audienceRefSchema = z.object({
  key: z.string().optional(),
  type: z.enum(["list", "segment"]),
  id: z.string(),
  name: z.string().optional(),
  estimatedSize: z.number().optional(),
});

const campaignReadOutput = z.object({
  id: z.string(),
  archetype: z.string(),
  audience: z.object({
    included: z.array(audienceRefSchema),
    excluded: z.array(audienceRefSchema).optional(),
  }),
  subjectCandidates: z.array(z.string()),
  subject: z.string().optional(),
  previewText: z.string().optional(),
  copyFormulaRef: z.string().optional(),
  skeletonRef: z.string(),
  sections: z.array(z.record(z.string(), z.unknown())),
  scheduledAt: z.string().optional(),
  utm: z.object({ campaign: z.string(), source: z.string(), medium: z.string() }),
  klaviyo: z
    .object({
      templateId: z.string().optional(),
      campaignId: z.string().optional(),
      messageId: z.string().optional(),
      sendJobStatus: z.string().optional(),
    })
    .optional(),
  provenance: z.array(z.object({ claim: z.string(), origin: z.enum(["owner", "agent", "data"]) })),
  status: z.string(),
  body: z.string().describe("The agent's rationale prose"),
});

const audiencesReadInput = z.object({});

const audiencesReadOutput = z.object({
  audiences: z.array(
    z.object({
      type: z.enum(["list", "segment"]),
      id: z.string(),
      name: z.string(),
      profileCount: z.number().optional(),
    }),
  ),
  strategyRoster: z
    .array(
      z.object({
        key: z.string(),
        klaviyoRef: z.object({ type: z.enum(["list", "segment"]), id: z.string() }),
        matched: z.boolean().describe("Whether the roster ref resolves to a live audience"),
      }),
    )
    .describe("email/strategy.md audiences cross-checked against live Klaviyo audiences"),
});

const templatesReadInput = z.object({
  id: z
    .string()
    .optional()
    .describe("Fetch one template with full HTML (universal blocks inlined); omit to list all"),
});

const templatesReadOutput = z.object({
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      editorType: z.string().describe("CODE | USER_DRAGGABLE | SYSTEM_DRAGGABLE"),
      updated: z.string().optional(),
      html: z.string().optional(),
      inlinedBlocks: z.array(z.string()).optional(),
      unresolvedBlocks: z.array(z.string()).optional(),
    }),
  ),
});

const performanceReadInput = z.object({
  campaignIds: z.array(z.string()).optional().describe("Klaviyo campaign ids; omit for timeframe-wide"),
  timeframe: z.object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  }),
  conversionMetricId: z
    .string()
    .min(1)
    .describe("REQUIRED by Klaviyo reporting — the tenant's conversion metric (Shopify Placed Order)"),
});

const performanceReadOutput = z.object({
  rows: z.array(
    z.object({
      campaignId: z.string(),
      delivered: z.number().optional(),
      bounced: z.number().optional(),
      deliveryRate: z.number().optional(),
      opens: z.number().optional(),
      opensUnique: z.number().optional(),
      openRate: z.number().optional(),
      clicks: z.number().optional(),
      clicksUnique: z.number().optional(),
      clickRate: z.number().optional(),
      clickToOpenRate: z.number().optional(),
      unsubscribes: z.number().optional(),
      unsubscribeRate: z.number().optional(),
      spamComplaints: z.number().optional(),
      conversions: z.number().optional(),
      conversionUniques: z.number().optional(),
      conversionValue: z.number().optional(),
      revenuePerRecipient: z.number().optional(),
      averageOrderValue: z.number().optional(),
    }),
  ),
  conversionMetricId: z.string(),
  attributionBasis: z
    .string()
    .describe("Which counting system these numbers use — always state it (spec 12 glossary discipline)"),
});

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export interface EmailTools {
  email_plan_propose: SkillToolDefinition<typeof planProposeInput, typeof planProposeOutput>;
  email_calendar_read: SkillToolDefinition<typeof calendarReadInput, typeof calendarReadOutput>;
  email_campaign_read: SkillToolDefinition<typeof campaignReadInput, typeof campaignReadOutput>;
  klaviyo_audiences_read: SkillToolDefinition<typeof audiencesReadInput, typeof audiencesReadOutput>;
  klaviyo_templates_read: SkillToolDefinition<typeof templatesReadInput, typeof templatesReadOutput>;
  klaviyo_performance_read: SkillToolDefinition<
    typeof performanceReadInput,
    typeof performanceReadOutput
  >;
}

/** Max reporting window Klaviyo accepts (03 §8) — enforced client-side with a
 * clear error rather than a cryptic API 400. */
const MAX_TIMEFRAME_MS = 366 * 24 * 60 * 60 * 1000;

export function createEmailTools(repo: EmailRepo, klaviyo: KlaviyoClient): EmailTools {
  async function loadStrategy(): Promise<EmailStrategy | null> {
    const raw = await repo.readFile(STRATEGY_PATH);
    return raw === null ? null : parseStrategy(raw);
  }

  return {
    email_plan_propose: {
      id: "email_plan_propose",
      description:
        "Propose a month's email campaign calendar scaffold from email/strategy.md: send slots laid out by cadence and preferred send days, archetypes rotated by weight, audiences rotated under their cadence caps, every slot carrying its rationale. Deterministic — the agent fills in creative content on top. Read-only: saving/approving the plan is the email.approve_plan Action.",
      inputSchema: planProposeInput,
      outputSchema: planProposeOutput,
      execute: async (input) => {
        const strategy = await loadStrategy();
        if (!strategy) {
          throw new Error(
            `email_plan_propose: ${STRATEGY_PATH} not found — co-create the email strategy first (it derives from brand.md §5 tone table's email register + §11 Channel Guidelines)`,
          );
        }
        return proposeEmailPlan(strategy, input);
      },
    },

    email_calendar_read: {
      id: "email_calendar_read",
      description:
        "Read a month's email calendar (email/calendar/{YYYY-MM}.md) with gap analysis: slots without campaigns or audiences, archetype balance vs strategy weights, audience contact pressure vs cadence caps, quiet-period violations.",
      inputSchema: calendarReadInput,
      outputSchema: calendarReadOutput,
      execute: async ({ month }) => {
        const raw = await repo.readFile(calendarPath(month));
        if (raw === null) {
          throw new Error(
            `email_calendar_read: no calendar for ${month} (${calendarPath(month)}) — use email_plan_propose to draft one`,
          );
        }
        const calendar = parseCalendar(raw);
        const strategy = await loadStrategy();
        const gaps = analyzeEmailCalendarGaps(calendar, strategy);
        return {
          month: calendar.month,
          status: calendar.status,
          slots: calendar.slots,
          ...(calendar.notes !== undefined ? { notes: calendar.notes } : {}),
          gaps,
        };
      },
    },

    email_campaign_read: {
      id: "email_campaign_read",
      description:
        "Read a campaign spec (email/campaigns/{id}/campaign.md): audience, subject candidates, sections, skeleton ref, Klaviyo ids, provenance, status trail, and the agent's rationale.",
      inputSchema: campaignReadInput,
      outputSchema: campaignReadOutput,
      execute: async ({ id }) => {
        const raw = await repo.readFile(campaignPath(id));
        if (raw === null) {
          throw new Error(`email_campaign_read: campaign "${id}" not found (${campaignPath(id)})`);
        }
        return parseCampaign(raw);
      },
    },

    klaviyo_audiences_read: {
      id: "klaviyo_audiences_read",
      description:
        "List the store's Klaviyo lists and segments with profile counts, cross-checked against email/strategy.md's audience roster (audience selection needs real sizes).",
      inputSchema: audiencesReadInput,
      outputSchema: audiencesReadOutput,
      execute: async () => {
        const audiences = await klaviyo.listAudiences();
        const strategy = await loadStrategy();
        const live = new Set(audiences.map((a) => `${a.type}:${a.id}`));
        const strategyRoster = (strategy?.audiences ?? []).map((a) => ({
          key: a.key,
          klaviyoRef: a.klaviyoRef,
          matched: live.has(`${a.klaviyoRef.type}:${a.klaviyoRef.id}`),
        }));
        return { audiences, strategyRoster };
      },
    },

    klaviyo_templates_read: {
      id: "klaviyo_templates_read",
      description:
        "Read the store's existing Klaviyo templates (id, name, editor type). Pass an id to fetch one template's full HTML with universal content blocks inlined — feeds skeleton/partial ingestion (04 §3, 06).",
      inputSchema: templatesReadInput,
      outputSchema: templatesReadOutput,
      execute: async ({ id }) => {
        if (id === undefined) {
          const templates = await klaviyo.listTemplates();
          return { templates };
        }
        const template = await klaviyo.getTemplate(id);
        if (template.html === undefined) {
          return { templates: [template] };
        }
        // Inline universal blocks (03 §3: references can't survive in API
        // payloads — and the extractor needs the real markup anyway).
        const blocks = await klaviyo.listUniversalContent();
        const map = new Map(blocks.filter((b) => b.html !== undefined).map((b) => [b.id, b.html!]));
        const { html, inlined, unresolved } = inlineUniversalContent(template.html, map);
        return {
          templates: [
            {
              ...template,
              html,
              ...(inlined.length ? { inlinedBlocks: inlined } : {}),
              ...(unresolved.length ? { unresolvedBlocks: unresolved } : {}),
            },
          ],
        };
      },
    },

    klaviyo_performance_read: {
      id: "klaviyo_performance_read",
      description:
        "Campaign performance readback via Klaviyo's campaign-values-report: delivery, engagement (opens/clicks/CTOR), compliance (unsubs/spam), conversion (count, revenue, revenue-per-recipient). Always states the attribution basis — Klaviyo campaign reports count BY SEND DATE, which differs from event-time aggregates and from semantic-layer joins (three counting systems; never mix silently).",
      inputSchema: performanceReadInput,
      outputSchema: performanceReadOutput,
      execute: async (input) => {
        const start = Date.parse(input.timeframe.start);
        const end = Date.parse(input.timeframe.end);
        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
          throw new Error("klaviyo_performance_read: timeframe.end must be after timeframe.start");
        }
        if (end - start > MAX_TIMEFRAME_MS) {
          throw new Error(
            "klaviyo_performance_read: timeframe exceeds Klaviyo's 1-year reporting limit — split the query",
          );
        }
        const rows = await klaviyo.campaignValuesReport({
          ...(input.campaignIds ? { campaignIds: input.campaignIds } : {}),
          timeframe: input.timeframe,
          conversionMetricId: input.conversionMetricId,
        });
        return {
          rows,
          conversionMetricId: input.conversionMetricId,
          attributionBasis:
            "klaviyo campaign-values-report: attributed by campaign SEND DATE (matches the Klaviyo UI). Not comparable 1:1 with event-time metric aggregates or GA4/Shopify semantic-layer joins.",
        };
      },
    },
  };
}
