/** Reusable standing-intent contract. Provider calls and gate decisions stay in the platform. */
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
export const socialAutopilotPolicySchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  account: z.object({ id: z.string().regex(/^\d+$/), username: z.string().min(1).max(100) }).strict(),
  firstPostDate: day,
  timeZone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Invalid time zone"),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  batchDays: z.literal(14),
  leadDays: z.literal(7),
  /** Null is intentionally unarmed. Historical quotes never grant future spend. */
  maximumCredits: z.number().finite().positive().max(1000).nullable(),
  maximumJobCredits: z.number().finite().positive().max(100),
  minimumReviewHours: z.number().int().min(1).max(168),
  requireSlackNotice: z.literal(true),
  publishUnlessPaused: z.literal(true),
  recipeIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/)).min(1).max(20),
}).strict().superRefine((policy, ctx) => {
  if (new Set(policy.recipeIds).size !== policy.recipeIds.length)
    ctx.addIssue({ code: "custom", message: "Duplicate recipe" });
  if (policy.enabled && policy.maximumCredits === null)
    ctx.addIssue({ code: "custom", message: "An enabled policy needs an explicit credit cap" });
});
export type SocialAutopilotPolicy = z.infer<typeof socialAutopilotPolicySchema>;
const DAY = 86_400_000;
export function addCalendarDays(date: string, count: number): string {
  day.parse(date);
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}
export function localCalendarDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** Resolve a wall time without assuming a fixed UTC offset across daylight savings. */
export function socialWallTime(date: string, time: string, timeZone: string): string {
  day.parse(date);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Invalid local time");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const wall = (ms: number) => {
    const parts = formatter.formatToParts(new Date(ms));
    const p = (key: string) => parts.find(part => part.type === key)!.value;
    return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:00Z`;
  };
  const desired = `${date}T${time}:00Z`, target = Date.parse(desired);
  let candidate = target;
  for (let i = 0; i < 4; i++) candidate += target - Date.parse(wall(candidate));
  if (wall(candidate) !== desired) throw new Error("Local publish time does not exist on this date");
  // Never guess an offset during a repeated hour; require an unambiguous policy time.
  if (Array.from({ length: 24 }, (_, i) => (i < 12 ? i - 12 : i - 11) * 900_000).some(delta => wall(candidate + delta) === desired))
    throw new Error("Local publish time is ambiguous on this date");
  return new Date(candidate).toISOString();
}
export interface AutopilotWindow { id: string; from: string; through: string; prepareOn: string; slots: { date: string; scheduledAt: string }[] }
export function autopilotWindow(policyInput: SocialAutopilotPolicy, index: number): AutopilotWindow {
  const policy = socialAutopilotPolicySchema.parse(policyInput);
  if (!Number.isSafeInteger(index) || index < 0 || index > 1000) throw new Error("Invalid batch index");
  const from = addCalendarDays(policy.firstPostDate, index * policy.batchDays);
  return { id: `${policy.account.id}-${from}`, from, through: addCalendarDays(from, policy.batchDays - 1),
    prepareOn: addCalendarDays(from, -policy.leadDays),
    slots: Array.from({ length: policy.batchDays }, (_, offset) => {
      const date = addCalendarDays(from, offset);
      return { date, scheduledAt: socialWallTime(date, policy.localTime, policy.timeZone) };
    }) };
}
/** One current due window, never a fresh overlapping fortnight on every daily tick. */
export function dueAutopilotWindow(policyInput: SocialAutopilotPolicy, now = new Date()): AutopilotWindow | null {
  const policy = socialAutopilotPolicySchema.parse(policyInput);
  if (!policy.enabled || policy.maximumCredits === null) return null;
  const today = localCalendarDate(now, policy.timeZone);
  const offset = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${policy.firstPostDate}T00:00:00Z`)) / DAY);
  if (offset < -policy.leadDays) return null;
  return autopilotWindow(policy, Math.max(0, Math.floor((offset + policy.leadDays) / policy.batchDays)));
}

export function assertBatchSpend(policyInput: SocialAutopilotPolicy, jobs: { id: string; maximumCredits: number }[]) {
  const policy = socialAutopilotPolicySchema.parse(policyInput);
  if (!policy.enabled || policy.maximumCredits === null) throw new Error("Autopilot is not armed with a budget");
  if (!jobs.length || jobs.length > 42 || jobs.some(j => !/^[a-z0-9][a-z0-9-]{0,99}$/.test(j.id)) || new Set(jobs.map(j => j.id)).size !== jobs.length)
    throw new Error("Batch jobs must be unique and bounded");
  // Reserve the ceilings, not estimates. Every paid attempt keeps its reservation,
  // including failed/unknown submissions; rerolls require a new bounded grant.
  const reserved = jobs.reduce((sum, job) => {
    if (!Number.isFinite(job.maximumCredits) || job.maximumCredits <= 0 || job.maximumCredits > policy.maximumJobCredits)
      throw new Error("Generation job exceeds the per-job ceiling");
    return sum + job.maximumCredits;
  }, 0);
  if (reserved > policy.maximumCredits + Number.EPSILON) throw new Error("Batch exceeds the authorized credit cap");
  return reserved;
}
/** Review is opt-out, but the notice must be delivered before a post is armed. */
export function assertAutopilotRelease(policyInput: SocialAutopilotPolicy, window: AutopilotWindow,
  notice: { deliveredAt: string | null; channel: string | null }, slots: { scheduledAt: string; ready: boolean; accountId: string }[], now = new Date()) {
  const policy = socialAutopilotPolicySchema.parse(policyInput);
  if (!policy.enabled || policy.maximumCredits === null) throw new Error("Autopilot is paused or has no budget");
  if (!notice.channel || !notice.deliveredAt || !Number.isFinite(Date.parse(notice.deliveredAt)))
    throw new Error("Slack review notice has not been delivered");
  if (slots.length !== 14 || new Set(slots.map(s => s.scheduledAt)).size !== 14)
    throw new Error("A release needs fourteen distinct daily posts");
  const offset = (Date.parse(`${window.from}T00:00:00Z`) - Date.parse(`${policy.firstPostDate}T00:00:00Z`)) / DAY;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % policy.batchDays !== 0 ||
      JSON.stringify(autopilotWindow(policy, offset / policy.batchDays)) !== JSON.stringify(window))
    throw new Error("Release window differs from the authorized policy");
  if (localCalendarDate(now, policy.timeZone) < window.prepareOn)
    throw new Error("Release batch is not due for preparation yet");
  const expected = new Set(window.slots.map(s => s.scheduledAt));
  const deliveredAt = Date.parse(notice.deliveredAt);
  if (deliveredAt > now.getTime()) throw new Error("Invalid Slack delivery time");
  for (const slot of slots) {
    const when = Date.parse(slot.scheduledAt);
    if (!expected.has(slot.scheduledAt) || !slot.ready || slot.accountId !== policy.account.id)
      throw new Error("Post is unfinished, outside the batch or bound to another account");
    if (when <= now.getTime() || when - deliveredAt < policy.minimumReviewHours * 3_600_000)
      throw new Error("Review lead time has elapsed; do not backfill or silently publish late");
  }
}
