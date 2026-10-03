/** One approval over a dated set of final posts; the existing per-post scheduler owns sending. */
import { z } from "zod";
import { hashPreview } from "../actions/hash";
import { registerAction } from "../actions/registry";
import { createSocialActions, approvalHash } from "./actions";
import { parsePost, postPath } from "./artifacts";
import { socialActionDeps } from "./register-actions";
import { socialRepo } from "./repo";
import { socialSheetLink } from "./review-links";
import { getTenant } from "../tenant-context";
export const scheduleBatchSchema = z.object({ entries: z.array(z.object({
  postId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/),
  scheduledAt: z.string().datetime({ offset: true }), expectedMaterialHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()).min(1).max(31) }).strict().refine(p => new Set(p.entries.map(e => e.postId)).size === p.entries.length,
  "Each post may appear only once");
export type ScheduleBatchParams = z.infer<typeof scheduleBatchSchema>;
async function verifyEntry(entry: ScheduleBatchParams["entries"][number]) {
  const raw = await socialRepo.readFile(postPath(entry.postId));
  if (!raw) throw new Error(`Post ${entry.postId} unavailable`);
  const post = parsePost(raw);
  if (!post.channelAccount) throw new Error("Connected destination must be bound to every post");
  if (approvalHash({ ...post, scheduledAt: entry.scheduledAt }) !== entry.expectedMaterialHash)
    throw new Error(`Post ${entry.postId} changed; review it again before scheduling`);
  return post;
}
export function socialScheduleBatchAction() {
  return { kind: "social.schedule_batch", title: "Schedule reviewed social posts", risk: "medium" as const,
    scopes: ["social:publish"], paramsSchema: scheduleBatchSchema,
    summary: (p: ScheduleBatchParams) => `Schedule ${p.entries.length} reviewed social posts`,
    async preview(p: ScheduleBatchParams) {
      const deps = socialActionDeps(), actions = createSocialActions(deps);
      // Read-only validation runs in a small pool: a month should not wait for
      // fourteen sequential provider/Git round trips. Keep rows in date order.
      const rows: { label: string; value: string }[] = new Array(p.entries.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, p.entries.length) }, async () => {
        while (next < p.entries.length) {
          const index = next++, entry = p.entries[index];
          const post = await verifyEntry(entry);
          await actions.schedulePost.preview({ postId: entry.postId, scheduledAt: entry.scheduledAt });
          rows[index] = { label: `${entry.scheduledAt} · ${post.renderedVideo ? "Reel" : "Carousel"} · @${post.channelAccount!.username}`,
            value: post.copy };
        }
      }));
      return { summary: `Approval authorizes ${p.entries.length} final posts at the listed times. Edits invalidate consent; no further approval at send time.`,
        rows, previewUrl: `${process.env.MOS_AGENTS_PUBLIC_URL?.replace(/\/$/, "")}/social/schedule?month=${p.entries[0].scheduledAt.slice(0, 7)}`,
        previewHash: hashPreview({ kind: "social.schedule_batch", entries: p.entries }) };
    },
    async execute(p: ScheduleBatchParams) {
      // Validate the entire set before the first write. Each subsequent write
      // rechecks under the same lock the cron uses. Partial failure is explicit.
      for (const entry of p.entries) await verifyEntry(entry);
      const deps = socialActionDeps(), completed: string[] = [];
      for (const entry of p.entries) {
        try {
          await deps.withPostLock!(entry.postId, async () => {
            await verifyEntry(entry);
            const result = await createSocialActions({ ...deps, withPostLock: undefined }).schedulePost.execute(entry);
            if (!result.ok) throw new Error(result.summary);
          });
          completed.push(entry.postId);
        } catch (e) {
          throw new Error(`Scheduled ${completed.length}/${p.entries.length}. Stopped at ${entry.postId}: ${e instanceof Error ? e.message : "unavailable"}. Review remaining posts; no media was published by this action.`);
        }
      }
      return { ok: true, summary: `Scheduled ${completed.length} posts. Each sends automatically at its approved time.`, detail: { postIds: completed } };
    },
  };
}
registerAction("social.schedule_batch", socialScheduleBatchAction);
