// VENDORED from packages/skills/email-campaign — do not edit here; swap for the
// published package on next touch (H8.3).

/**
 * The pure planning core (WS3-R3) — the social pack's purity discipline,
 * verbatim: NO clocks, month comes from the input, same inputs → same plan.
 * The LLM layers creative content (final intents, specific products, copy)
 * on the deterministic scaffold; persisting/approving a plan is an Action.
 */

import type {
  EmailCalendar,
  EmailCalendarSlot,
  EmailStrategy,
  StrategyArchetype,
} from "./types";
import { serializeCalendar } from "./artifacts";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function monthParts(month: string): { year: number; monthIndex: number } {
  if (!MONTH_RE.test(month)) throw new Error(`month must be YYYY-MM, got "${month}"`);
  const [y, m] = month.split("-");
  return { year: Number(y), monthIndex: Number(m) };
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days of the month grouped into Monday-start weeks (partial edge weeks kept).
 * Same convention as the social pack's monthWeeks. */
export function monthWeeks(month: string): string[][] {
  const { year, monthIndex } = monthParts(month);
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const weeks: string[][] = [];
  let current: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const weekday = new Date(Date.UTC(year, monthIndex - 1, day)).getUTCDay();
    if (weekday === 1 && current.length > 0) {
      weeks.push(current);
      current = [];
    }
    current.push(isoDate(year, monthIndex, day));
  }
  if (current.length > 0) weeks.push(current);
  return weeks;
}

function weekdayOf(isoDay: string): (typeof WEEKDAYS)[number] {
  const d = new Date(`${isoDay}T00:00:00Z`);
  return WEEKDAYS[d.getUTCDay()]!;
}

function inQuietPeriod(isoDay: string, strategy: EmailStrategy): { hit: boolean; reason?: string } {
  for (const qp of strategy.guardrails?.quietPeriods ?? []) {
    if (isoDay >= qp.start && isoDay <= qp.end) {
      return { hit: true, ...(qp.reason ? { reason: qp.reason } : {}) };
    }
  }
  return { hit: false };
}

/**
 * Deterministic weighted round-robin (the social pack's rotatePillars
 * algorithm, applied to archetypes): assign an archetype to each of `count`
 * ordered slots so counts track weights — largest-deficit-first, ties broken
 * by declaration order.
 */
export function rotateArchetypes(archetypes: StrategyArchetype[], count: number): StrategyArchetype[] {
  if (archetypes.length === 0) throw new Error("rotateArchetypes: no archetypes");
  const totalWeight = archetypes.reduce((sum, a) => sum + a.weight, 0);
  const assigned = new Array<number>(archetypes.length).fill(0);
  const out: StrategyArchetype[] = [];
  for (let n = 0; n < count; n++) {
    let best = 0;
    let bestDeficit = -Infinity;
    for (let i = 0; i < archetypes.length; i++) {
      const archetype = archetypes[i]!;
      const deficit = (archetype.weight * (n + 1)) / totalWeight - assigned[i]!;
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit;
        best = i;
      }
    }
    assigned[best] = assigned[best]! + 1;
    out.push(archetypes[best]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan proposal
// ---------------------------------------------------------------------------

export interface PlanContext {
  /** Top-moving products/collections from the semantic layer. */
  topMovers?: string[];
  /** Free-form seasonal context to weave into rationales. */
  seasonal?: string;
  /** Readback highlights from prior campaigns ("editorial-story out-performed
   * promotion by 2.1x on revenue/recipient") — cited in rationales. */
  readback?: string[];
}

export interface ProposedEmailSlot extends EmailCalendarSlot {
  /** Why this slot exists — every slot carries its why. */
  rationale: string;
}

export interface EmailPlanProposal {
  month: string;
  status: "proposed";
  slots: ProposedEmailSlot[];
  /** The draft serialized as email/calendar/{month}.md, ready to propose. */
  calendarMarkdown: string;
  summary: string;
  /** Slots dropped or left audience-less by guardrails, stated honestly. */
  warnings: string[];
}

/**
 * Lay out a month's campaign slots from the strategy, deterministically:
 *
 * 1. `campaignsPerMonth` slots spread evenly across the month's weeks,
 *    respecting `maxCampaignsPerWeek`.
 * 2. Within a week, dates pick the strategy's preferred send days in
 *    declaration order (tuesday before thursday if declared so), skipping
 *    quiet-period days; a week with no eligible day drops its slot with a
 *    warning rather than violating a guardrail.
 * 3. Archetypes rotate by weight (largest-deficit-first).
 * 4. Audiences rotate round-robin under their cadenceCaps; when every
 *    audience is at cap the slot is left unassigned ("—") with a warning —
 *    a proposal never violates a cap.
 * 5. Seasonal arcs, top movers, and readback context weave into rationales;
 *    every third slot (deterministic) becomes a commercial feature slot when
 *    top movers are supplied.
 */
export function proposeEmailPlan(
  strategy: EmailStrategy,
  input: {
    month: string;
    campaignsOverride?: number;
    context?: PlanContext;
  },
): EmailPlanProposal {
  const { month, campaignsOverride, context } = input;
  const weeks = monthWeeks(month);
  const target = campaignsOverride ?? strategy.campaignsPerMonth;
  const perWeekCap = strategy.guardrails?.maxCampaignsPerWeek ?? Infinity;
  const warnings: string[] = [];

  // 1–2. Distribute slot counts across weeks, then pick concrete days.
  const perWeek = new Array<number>(weeks.length).fill(0);
  for (let n = 0; n < target; n++) {
    // Even spread: week index by proportional position, then bump forward to
    // the first week under the cap.
    let w = Math.floor((n * weeks.length) / target);
    let placed = false;
    for (let probe = 0; probe < weeks.length; probe++) {
      const candidate = (w + probe) % weeks.length;
      if (perWeek[candidate]! < perWeekCap) {
        perWeek[candidate] = perWeek[candidate]! + 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      warnings.push(
        `slot ${n + 1}/${target} dropped: every week is at maxCampaignsPerWeek=${perWeekCap}`,
      );
    }
  }

  const dates: { date: string; week: number }[] = [];
  weeks.forEach((weekDays, week) => {
    const wanted = perWeek[week]!;
    if (wanted === 0) return;
    // Preferred send days in declaration order, then any remaining weekday as
    // fallback, skipping quiet periods.
    const eligible: string[] = [];
    for (const prefDay of strategy.sendDays) {
      for (const d of weekDays) {
        if (weekdayOf(d) === prefDay && !inQuietPeriod(d, strategy).hit) eligible.push(d);
      }
    }
    for (const d of weekDays) {
      if (!eligible.includes(d) && !inQuietPeriod(d, strategy).hit) eligible.push(d);
    }
    if (eligible.length === 0) {
      warnings.push(`week ${week + 1}: all days in a quiet period — ${wanted} slot(s) dropped`);
      return;
    }
    for (let i = 0; i < wanted; i++) {
      const date = eligible[Math.min(i, eligible.length - 1)]!;
      if (i >= eligible.length) {
        warnings.push(
          `week ${week + 1}: more slots (${wanted}) than eligible send days (${eligible.length}); doubling up on ${date}`,
        );
      }
      dates.push({ date, week });
    }
  });
  dates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // 3. Archetype rotation.
  const rotation = rotateArchetypes(strategy.archetypes, dates.length);

  // 4. Audience rotation under cadenceCaps.
  const audienceUse = new Map<string, number>(strategy.audiences.map((a) => [a.key, 0]));
  let audienceCursor = 0;
  function nextAudience(): string | null {
    for (let probe = 0; probe < strategy.audiences.length; probe++) {
      const idx = (audienceCursor + probe) % strategy.audiences.length;
      const aud = strategy.audiences[idx]!;
      if (audienceUse.get(aud.key)! < aud.cadenceCap) {
        audienceUse.set(aud.key, audienceUse.get(aud.key)! + 1);
        audienceCursor = idx + 1;
        return aud.key;
      }
    }
    return null;
  }

  const seasonalArcs = (strategy.seasonalArcs ?? []).filter((a) => a.months?.includes(month));
  const topMovers = context?.topMovers ?? [];
  let moverCursor = 0;

  // 5. Assemble slots with rationales.
  const slots: ProposedEmailSlot[] = dates.map((entry, i) => {
    const archetype = rotation[i]!;
    const audience = nextAudience();
    if (audience === null) {
      warnings.push(
        `${entry.date}: every audience is at its cadenceCap — audience left unassigned for owner review`,
      );
    }

    let intent = archetype.messagingRef;
    const why: string[] = [
      `send day ${entry.date} (${weekdayOf(entry.date)} ${strategy.sendTime}), week ${entry.week + 1}`,
      `archetype "${archetype.name}" (weight ${archetype.weight}) → ${archetype.messagingRef}`,
    ];
    if (audience) {
      const aud = strategy.audiences.find((a) => a.key === audience)!;
      why.push(`audience "${audience}" (${aud.description}), ${audienceUse.get(audience)}/${aud.cadenceCap} this month`);
    } else {
      why.push("audience unassigned: cadence caps exhausted");
    }
    if (topMovers.length > 0 && i % 3 === 2) {
      const mover = topMovers[moverCursor % topMovers.length]!;
      moverCursor++;
      intent = `feature: ${mover}`;
      why.push(`commercial slot: top mover "${mover}" from the semantic layer`);
    }
    if (context?.seasonal) why.push(`seasonal context: ${context.seasonal}`);
    for (const arc of seasonalArcs) why.push(`seasonal arc "${arc.name}" is active this month`);
    for (const rb of context?.readback ?? []) why.push(`readback: ${rb}`);

    return {
      slot: entry.date,
      audience,
      archetype: archetype.name,
      intent,
      campaignId: null,
      status: "planned",
      rationale: why.join("; "),
    };
  });

  const calendarMarkdown = serializeCalendar({
    month,
    status: "proposed",
    slots: slots.map(({ rationale: _r, ...slot }) => slot),
    notes: `Proposed by the email campaign agent from email/strategy.md (${target} campaigns/month target, send days ${strategy.sendDays.join("/")} at ${strategy.sendTime}). Every slot's rationale is in the proposal payload.`,
  });

  const summary = `${slots.length} campaign slot(s) for ${month} across ${new Set(slots.map((s) => s.audience).filter(Boolean)).size} audience(s). Archetype rotation weighted over [${strategy.archetypes.map((a) => `${a.name}:${a.weight}`).join(", ")}].${warnings.length ? ` ${warnings.length} warning(s).` : ""}`;

  return { month, status: "proposed", slots, calendarMarkdown, summary, warnings };
}

// ---------------------------------------------------------------------------
// Gap analysis
// ---------------------------------------------------------------------------

export interface ArchetypeBalance {
  archetype: string;
  weight: number;
  expectedCount: number;
  actualCount: number;
  underRepresented: boolean;
}

export interface AudienceContact {
  audience: string;
  cadenceCap: number;
  plannedCount: number;
  overCap: boolean;
}

export interface EmailGapAnalysis {
  /** Slots with no campaign yet. */
  unassignedSlots: EmailCalendarSlot[];
  /** Slots with no audience assigned. */
  audiencelessSlots: EmailCalendarSlot[];
  archetypeBalance: ArchetypeBalance[];
  /** Strategy archetypes that appear in no slot at all. */
  missingArchetypes: string[];
  /** Per-audience contact pressure vs cadenceCap. */
  audienceContact: AudienceContact[];
  /** Slots landing inside a strategy quiet period (drift after edits). */
  quietPeriodViolations: EmailCalendarSlot[];
}

export function analyzeEmailCalendarGaps(
  calendar: Pick<EmailCalendar, "slots">,
  strategy: EmailStrategy | null,
): EmailGapAnalysis {
  const unassignedSlots = calendar.slots.filter((s) => s.campaignId === null);
  const audiencelessSlots = calendar.slots.filter((s) => s.audience === null);
  const archetypeBalance: ArchetypeBalance[] = [];
  const missingArchetypes: string[] = [];
  const audienceContact: AudienceContact[] = [];
  const quietPeriodViolations: EmailCalendarSlot[] = [];

  if (strategy) {
    if (strategy.archetypes.length > 0) {
      const totalWeight = strategy.archetypes.reduce((sum, a) => sum + a.weight, 0);
      const counts = new Map<string, number>();
      for (const slot of calendar.slots) {
        counts.set(slot.archetype, (counts.get(slot.archetype) ?? 0) + 1);
      }
      for (const archetype of strategy.archetypes) {
        const actualCount = counts.get(archetype.name) ?? 0;
        const expectedCount = (archetype.weight / totalWeight) * calendar.slots.length;
        archetypeBalance.push({
          archetype: archetype.name,
          weight: archetype.weight,
          expectedCount: Math.round(expectedCount * 100) / 100,
          actualCount,
          underRepresented: actualCount < Math.floor(expectedCount),
        });
        if (actualCount === 0 && calendar.slots.length > 0) missingArchetypes.push(archetype.name);
      }
    }
    for (const aud of strategy.audiences) {
      const plannedCount = calendar.slots.filter((s) => s.audience === aud.key).length;
      audienceContact.push({
        audience: aud.key,
        cadenceCap: aud.cadenceCap,
        plannedCount,
        overCap: plannedCount > aud.cadenceCap,
      });
    }
    for (const slot of calendar.slots) {
      if (inQuietPeriod(slot.slot, strategy).hit) quietPeriodViolations.push(slot);
    }
  }

  return {
    unassignedSlots,
    audiencelessSlots,
    archetypeBalance,
    missingArchetypes,
    audienceContact,
    quietPeriodViolations,
  };
}
