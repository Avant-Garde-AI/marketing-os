/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0 — its test suite lives there). Keep this file faithful below this
 * header; fix bugs upstream first, then re-vendor.
 *
 * SM0 planning read tools (spec 24 §2 — "reads compose freely", spec 20 §3).
 *
 * These are UNGATED reads. Nothing here mutates the store or the repo — plan
 * proposals are returned to the agent (structure + serialized markdown);
 * persisting/approving them is an Action and lands in SM2 on the spec 20
 * framework.
 *
 * `social_plan_propose` is deliberately a PURE scaffold generator: given the
 * strategy and a month it lays out slots by cadence and rotates pillars by
 * weight, deterministically. The LLM brings the creative content (copy,
 * specific products, final intents) on top of this scaffold. No clocks — the
 * month comes from the input.
 */

import { z } from "zod";
import type {
  CalendarSlot,
  SkillToolDefinition,
  SocialRepo,
  SocialStrategy,
  StrategyPillar,
} from "./types";
import {
  STRATEGY_PATH,
  calendarPath,
  parseCalendar,
  parseStrategy,
  postPath,
  parsePost,
  serializeCalendar,
} from "./artifacts";

// ---------------------------------------------------------------------------
// Deterministic layout helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthParts(month: string): { year: number; monthIndex: number } {
  if (!MONTH_RE.test(month)) throw new Error(`month must be YYYY-MM, got "${month}"`);
  const [y, m] = month.split("-");
  return { year: Number(y), monthIndex: Number(m) };
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days of the month grouped into Monday-start weeks (partial edge weeks kept). */
export function monthWeeks(month: string): string[][] {
  const { year, monthIndex } = monthParts(month);
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const weeks: string[][] = [];
  let current: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const weekday = new Date(Date.UTC(year, monthIndex - 1, day)).getUTCDay(); // 0 = Sunday
    if (weekday === 1 && current.length > 0) {
      weeks.push(current);
      current = [];
    }
    current.push(isoDate(year, monthIndex, day));
  }
  if (current.length > 0) weeks.push(current);
  return weeks;
}

/** Pick `count` items spread evenly across `items` (all of them if count >= length). */
export function pickEvenly<T>(items: T[], count: number): T[] {
  if (count >= items.length) return [...items];
  const picked: T[] = [];
  for (let i = 0; i < count; i++) {
    const item = items[Math.floor((i * items.length) / count)];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

/**
 * Deterministic weighted round-robin: assign a pillar to each of `count`
 * ordered slots so pillar counts track their weights (largest-deficit-first,
 * ties broken by declaration order).
 */
export function rotatePillars(pillars: StrategyPillar[], count: number): StrategyPillar[] {
  if (pillars.length === 0) throw new Error("rotatePillars: no pillars");
  const totalWeight = pillars.reduce((sum, p) => sum + p.weight, 0);
  const assigned = new Array<number>(pillars.length).fill(0);
  const out: StrategyPillar[] = [];
  for (let n = 0; n < count; n++) {
    let best = 0;
    let bestDeficit = -Infinity;
    for (let i = 0; i < pillars.length; i++) {
      const pillar = pillars[i]!;
      // Target share after this slot minus what the pillar already has.
      const deficit = (pillar.weight * (n + 1)) / totalWeight - assigned[i]!;
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit;
        best = i;
      }
    }
    assigned[best] = assigned[best]! + 1;
    out.push(pillars[best]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan proposal (pure core, exported for tests)
// ---------------------------------------------------------------------------

export interface PlanContext {
  topMovers?: string[];
  seasonal?: string;
}

export interface ProposedSlot extends CalendarSlot {
  /** Why this slot exists — every slot carries its why (spec 24 §2). */
  rationale: string;
}

export interface PlanProposal {
  month: string;
  status: "proposed";
  slots: ProposedSlot[];
  /** The draft serialized as social/calendar/{month}.md, ready to propose. */
  calendarMarkdown: string;
  summary: string;
}

export function proposePlan(
  strategy: SocialStrategy,
  input: {
    month: string;
    channels?: string[];
    cadenceOverride?: Record<string, number>;
    context?: PlanContext;
  },
): PlanProposal {
  const { month, channels: channelFilter, cadenceOverride, context } = input;
  const roster = channelFilter
    ? strategy.channels.filter((c) => channelFilter.includes(c.channel))
    : strategy.channels;
  if (roster.length === 0) {
    throw new Error(
      `social_plan_propose: no strategy channels match [${(channelFilter ?? []).join(", ")}] — roster is [${strategy.channels.map((c) => c.channel).join(", ")}]`,
    );
  }

  const weeks = monthWeeks(month);
  const seasonalArcs = (strategy.seasonalArcs ?? []).filter((a) => a.months?.includes(month));

  // Lay out slots per channel by cadence, then order globally by (date, roster order).
  const raw: { date: string; channelIndex: number; week: number }[] = [];
  roster.forEach((channel, channelIndex) => {
    const cadence = cadenceOverride?.[channel.channel] ?? channel.cadencePerWeek;
    weeks.forEach((weekDays, week) => {
      for (const date of pickEvenly(weekDays, cadence)) {
        raw.push({ date, channelIndex, week });
      }
    });
  });
  raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.channelIndex - b.channelIndex));

  const rotation = rotatePillars(strategy.pillars, raw.length);
  const topMovers = context?.topMovers ?? [];
  let moverCursor = 0;

  const slots: ProposedSlot[] = raw.map((entry, i) => {
    const channel = roster[entry.channelIndex]!;
    const pillar = rotation[i]!;
    // Every third slot (deterministic) becomes a commercial feature slot when
    // the semantic layer supplied top movers; the rest carry the pillar's
    // messaging intent.
    let intent = pillar.messagingRef;
    const why: string[] = [
      `${channel.channel} (${channel.register} register), week ${entry.week + 1} cadence slot`,
      `pillar "${pillar.name}" (weight ${pillar.weight}) → ${pillar.messagingRef}`,
    ];
    if (topMovers.length > 0 && i % 3 === 2) {
      const mover = topMovers[moverCursor % topMovers.length]!;
      moverCursor++;
      intent = `feature: ${mover}`;
      why.push(`commercial slot: top mover "${mover}" from the semantic layer`);
    }
    if (context?.seasonal) why.push(`seasonal context: ${context.seasonal}`);
    for (const arc of seasonalArcs) {
      why.push(`seasonal arc "${arc.name}" is active this month`);
    }
    return {
      slot: entry.date,
      channel: channel.channel,
      pillar: pillar.name,
      intent,
      postId: null,
      status: "planned",
      rationale: why.join("; "),
    };
  });

  const calendarMarkdown = serializeCalendar({
    month,
    status: "proposed",
    slots: slots.map(({ rationale: _rationale, ...slot }) => slot),
    notes: `Proposed by the social media agent from social/strategy.md (${roster
      .map((c) => `${c.channel}@${cadenceOverride?.[c.channel] ?? c.cadencePerWeek}/wk`)
      .join(", ")}). Every slot's rationale is in the proposal payload.`,
  });

  const summary = `${slots.length} slots across ${roster.length} channel(s) for ${month}: ${roster
    .map((c) => c.channel)
    .join(", ")}. Pillar rotation weighted over [${strategy.pillars.map((p) => `${p.name}:${p.weight}`).join(", ")}].`;

  return { month, status: "proposed", slots, calendarMarkdown, summary };
}

// ---------------------------------------------------------------------------
// Gap analysis (pure, exported for tests)
// ---------------------------------------------------------------------------

export interface PillarBalance {
  pillar: string;
  weight: number;
  expectedCount: number;
  actualCount: number;
  underRepresented: boolean;
}

export interface GapAnalysis {
  unassignedSlots: CalendarSlot[];
  pillarBalance: PillarBalance[];
  /** Strategy pillars that appear in no slot at all. */
  missingPillars: string[];
}

export function analyzeCalendarGaps(
  calendar: { slots: CalendarSlot[] },
  strategy: SocialStrategy | null,
): GapAnalysis {
  const unassignedSlots = calendar.slots.filter((s) => s.postId === null);
  const pillarBalance: PillarBalance[] = [];
  const missingPillars: string[] = [];
  if (strategy && strategy.pillars.length > 0) {
    const totalWeight = strategy.pillars.reduce((sum, p) => sum + p.weight, 0);
    const counts = new Map<string, number>();
    for (const slot of calendar.slots) {
      counts.set(slot.pillar, (counts.get(slot.pillar) ?? 0) + 1);
    }
    for (const pillar of strategy.pillars) {
      const actualCount = counts.get(pillar.name) ?? 0;
      const expectedCount = (pillar.weight / totalWeight) * calendar.slots.length;
      pillarBalance.push({
        pillar: pillar.name,
        weight: pillar.weight,
        expectedCount: Math.round(expectedCount * 100) / 100,
        actualCount,
        underRepresented: actualCount < Math.floor(expectedCount),
      });
      if (actualCount === 0 && calendar.slots.length > 0) missingPillars.push(pillar.name);
    }
  }
  return { unassignedSlots, pillarBalance, missingPillars };
}

// ---------------------------------------------------------------------------
// Zod schemas (tool I/O)
// ---------------------------------------------------------------------------

const monthSchema = z.string().regex(MONTH_RE, "YYYY-MM").describe("Calendar month, YYYY-MM");

const slotSchema = z.object({
  slot: z.string().describe("ISO date (YYYY-MM-DD)"),
  channel: z.string(),
  pillar: z.string(),
  intent: z.string(),
  postId: z.string().nullable(),
  status: z.string(),
});

const planProposeInput = z.object({
  month: monthSchema,
  channels: z
    .array(z.string())
    .optional()
    .describe("Restrict the plan to these channels (defaults to the full strategy roster)"),
  cadenceOverride: z
    .record(z.string(), z.number().int().positive())
    .optional()
    .describe("Per-channel posts-per-week override, e.g. { instagram: 4 }"),
  context: z
    .object({
      topMovers: z
        .array(z.string())
        .optional()
        .describe("Top-moving products/collections from the semantic layer"),
      seasonal: z.string().optional().describe("Seasonal context to weave into slot rationales"),
    })
    .optional(),
});

const planProposeOutput = z.object({
  month: monthSchema,
  status: z.literal("proposed"),
  slots: z.array(slotSchema.extend({ rationale: z.string().describe("Why this slot exists") })),
  calendarMarkdown: z
    .string()
    .describe("The draft serialized as social/calendar/{month}.md, ready to propose"),
  summary: z.string(),
});

const calendarReadInput = z.object({ month: monthSchema });

const calendarReadOutput = z.object({
  month: monthSchema,
  status: z.string(),
  slots: z.array(slotSchema),
  notes: z.string().optional(),
  gaps: z.object({
    unassignedSlots: z.array(slotSchema).describe("Slots with no post yet"),
    pillarBalance: z.array(
      z.object({
        pillar: z.string(),
        weight: z.number(),
        expectedCount: z.number(),
        actualCount: z.number(),
        underRepresented: z.boolean(),
      }),
    ),
    missingPillars: z.array(z.string()),
  }),
});

const postReadInput = z.object({ id: z.string().min(1).describe("Post id") });

const postReadOutput = z.object({
  id: z.string(),
  channel: z.string(),
  scheduledAt: z.string().optional(),
  copy: z.string(),
  copyFormulaRef: z.string().optional(),
  assetRefs: z.array(z.string()),
  targetLink: z.string(),
  provenance: z.array(z.object({ claim: z.string(), origin: z.enum(["owner", "agent", "data"]) })),
  status: z.string(),
  body: z.string().describe("The agent's rationale prose"),
});

// ---------------------------------------------------------------------------
// Tool factory — the runtime binds the tenant's repo, tests bind a map
// ---------------------------------------------------------------------------

export interface SocialTools {
  social_plan_propose: SkillToolDefinition<typeof planProposeInput, typeof planProposeOutput>;
  social_calendar_read: SkillToolDefinition<typeof calendarReadInput, typeof calendarReadOutput>;
  social_post_read: SkillToolDefinition<typeof postReadInput, typeof postReadOutput>;
}

export function createSocialTools(repo: SocialRepo): SocialTools {
  async function loadStrategy(): Promise<SocialStrategy | null> {
    const raw = await repo.readFile(STRATEGY_PATH);
    return raw === null ? null : parseStrategy(raw);
  }

  return {
    social_plan_propose: {
      id: "social_plan_propose",
      description:
        "Propose a month's social calendar scaffold from social/strategy.md: slots laid out by per-channel cadence, pillars rotated by weight, every slot carrying its rationale. Deterministic — the agent fills in creative content on top. Read-only: saving/approving the plan is an Action (SM2).",
      inputSchema: planProposeInput,
      outputSchema: planProposeOutput,
      execute: async (input) => {
        const strategy = await loadStrategy();
        if (!strategy) {
          throw new Error(
            `social_plan_propose: ${STRATEGY_PATH} not found — co-create the social strategy first (it derives from brand.md §10/§11)`,
          );
        }
        return proposePlan(strategy, input);
      },
    },

    social_calendar_read: {
      id: "social_calendar_read",
      description:
        "Read a month's social calendar (social/calendar/{YYYY-MM}.md) with gap analysis: slots without posts and pillar balance vs strategy weights.",
      inputSchema: calendarReadInput,
      outputSchema: calendarReadOutput,
      execute: async ({ month }) => {
        const raw = await repo.readFile(calendarPath(month));
        if (raw === null) {
          throw new Error(
            `social_calendar_read: no calendar for ${month} (${calendarPath(month)}) — use social_plan_propose to draft one`,
          );
        }
        const calendar = parseCalendar(raw);
        const strategy = await loadStrategy();
        const gaps = analyzeCalendarGaps(calendar, strategy);
        return {
          month: calendar.month,
          status: calendar.status,
          slots: calendar.slots,
          ...(calendar.notes !== undefined ? { notes: calendar.notes } : {}),
          gaps,
        };
      },
    },

    social_post_read: {
      id: "social_post_read",
      description:
        "Read a post spec (social/posts/{id}/post.md): channel, copy, assets, target link, provenance, status trail, and the agent's rationale.",
      inputSchema: postReadInput,
      outputSchema: postReadOutput,
      execute: async ({ id }) => {
        const raw = await repo.readFile(postPath(id));
        if (raw === null) {
          throw new Error(`social_post_read: post "${id}" not found (${postPath(id)})`);
        }
        return parsePost(raw);
      },
    },
  };
}
