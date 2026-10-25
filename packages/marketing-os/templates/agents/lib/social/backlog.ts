/** Store-owned production batch. Dates and drafts never imply publishing consent. */
import { createHash } from "node:crypto";
import { z } from "zod";
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const ms=Date.parse(`${value}T00:00:00Z`); return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10)===value; }, "Invalid calendar date");
const job = z.object({ artifactId: id.max(100), postId: id, parentPostId: id,
  mechanic: z.enum(["collection-scene", "artwork-loop"]), maximumCredits: z.number().finite().positive().max(8) }).strict();
export const socialBacklogSchema = z.object({ schemaVersion: z.literal(1), id,
  range: z.object({ from: date, through: date }), timeZone: z.string(), maximumCredits: z.number().positive().max(125),
  reservedMaximumCredits: z.number().finite().positive(),
  posts: z.array(z.object({ id, date, plannedAt: z.string().datetime({ offset: true }), caption: z.string().min(1).max(2200),
    generationInputs: z.array(z.string()).max(3), cameraManifest: z.string().optional() }).passthrough()).length(14),
  generationJobs: z.array(job).max(28),
}).passthrough().superRefine((b, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(b.posts.map(p => p.id)).size !== 14 || new Set(b.posts.map(p => p.date)).size !== 14) fail("Duplicate post or date");
  const from = Date.parse(`${b.range.from}T00:00:00Z`);
  if (!Number.isFinite(from)) { fail("Invalid batch start"); return; }
  if (new Date(from + 13 * 86400000).toISOString().slice(0, 10) !== b.range.through) fail("Batch must span fourteen days");
  const postIds = new Set(b.posts.map(p => p.id));
  if (new Set(b.generationJobs.map(j => j.artifactId)).size !== b.generationJobs.length) fail("Duplicate generation job");
  for (const [index, p] of b.posts.entries()) {
    if (p.date !== new Date(from + index * 86400000).toISOString().slice(0, 10) || !p.id.startsWith(p.date + "-")) fail("Posts must follow the batch calendar");
    const jobs = b.generationJobs.filter(j => j.parentPostId === p.id);
    if (p.cameraManifest) {
      if (jobs.length || p.generationInputs.length || p.cameraManifest !== `social/production/camera/${p.id}.json`) fail("Camera binding differs");
    } else if (!(jobs.length === 1 && jobs[0].mechanic === "artwork-loop") && !(jobs.length === 3 && jobs.every(j => j.mechanic === "collection-scene"))) fail("Incomplete post generation jobs");
    if (JSON.stringify([...p.generationInputs].sort()) !== JSON.stringify(jobs.map(j => `social/production/jobs/${j.artifactId}.json`).sort())) fail("Generation paths differ from reserved jobs");
  }
  if (b.generationJobs.some(j => !postIds.has(j.parentPostId))) fail("Orphan generation job");
  const reserved = b.generationJobs.reduce((sum, j) => sum + j.maximumCredits, 0);
  if (reserved !== b.reservedMaximumCredits || reserved > b.maximumCredits) fail("Generation reservation exceeds the batch budget");
});
export type SocialBacklog = z.infer<typeof socialBacklogSchema>;
export async function loadSocialBacklog(repo: {readFile(path: string): Promise<string | null>}, requested?: string) {
  let batchId = requested;
  if (!batchId) {
    const current = await repo.readFile("social/autopilot/current-backlog.json");
    if (!current) return null;
    batchId = id.parse(JSON.parse(current).batchId);
  }
  id.parse(batchId);
  const raw = await repo.readFile(`social/drafts/${batchId}/batch.json`);
  if (!raw || raw.length > 500000) throw Error("Production batch unavailable");
  const batch = socialBacklogSchema.parse(JSON.parse(raw));
  if (batch.id !== batchId) throw Error("Production batch identity differs");
  return { batch, hash: createHash("sha256").update(raw).digest("hex") };
}
