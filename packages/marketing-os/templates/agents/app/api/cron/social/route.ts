/**
 * /api/cron/social (spec 24 §5, SM2) — the publish executor for approved
 * schedules, on the shared cron frame (05 H7) like /api/cron/email.
 *
 * For each shop with social posts, for each `scheduled` post whose
 * scheduledAt has arrived:
 *
 *  1. RE-VERIFY THE CONSENT (D2 nonce discipline): recompute the publish-
 *     material hash from CURRENT file state and compare to the approval hash
 *     social.schedule_post recorded. Drift (copy edit, time move, creative
 *     rebinding) ⇒ the consent is void: the post drops back to asset_ready,
 *     the schedule is cleared, and the mismatch is flagged loudly — the card
 *     must re-arm. Nothing publishes.
 *  2. PUBLISH via social.publish_post's execute() — the SAME implementation
 *     the gate dispatches for immediate publishes (one publish path). The
 *     approval that authorizes this execution is the schedule approval: D2
 *     says approving the schedule IS consent to publish at T, so the cron
 *     needs no second human touch. The adapter resolves per channel; the
 *     asset is the post's design-surface export (public JPEG URL).
 *  3. WRITE-BACK rides the action: platform id + permalink + status
 *     `published` land on post.md; a failed publish lands status `failed` +
 *     the error (no silent retries — a human re-proposes via the card, which
 *     allows retrying `failed` posts).
 *
 * Idempotent: publish_post's execute returns early for already-published
 * posts, so a double firing (or a retry after a write-back race) converges.
 * Self-limiting via the shared frame; per-item errors never abort the sweep.
 */

import { NextRequest } from "next/server";
import { Pool } from "pg";
import { cronGate, cronSweep } from "../../../../lib/cron-frame";
import { runWithTenant } from "../../../../lib/tenant-context";
import { socialRepo } from "../../../../lib/social/repo";
import { parsePost, postPath, serializePost } from "../../../../lib/social/artifacts";
import { approvalHash, createSocialActions } from "../../../../lib/social/actions";
import { socialActionDeps } from "../../../../lib/social/register-actions";
import type { SocialPost } from "../../../../lib/social/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const SHOPS_PER_FIRING = 3;
const POSTS_PER_SHOP = 10;

let _pool: Pool | null = null;
function pool(): Pool | null {
  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) return null;
  if (!_pool) _pool = new Pool({ connectionString: cs, max: 2 });
  return _pool;
}

async function shopsWithSocialPosts(): Promise<string[]> {
  const p = pool();
  if (!p) return [];
  const r = await p.query(
    `SELECT DISTINCT shop FROM mos_social_artifacts WHERE path LIKE 'social/posts/%' ORDER BY shop`,
  );
  return r.rows.map((row: { shop: string }) => row.shop);
}

interface PostSweepOutcome {
  id: string;
  action: string;
}

async function sweepShop(shop: string): Promise<PostSweepOutcome[]> {
  return runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") }, async () => {
    const outcomes: PostSweepOutcome[] = [];
    const paths = (await socialRepo.list("social/posts/")).filter((p) => p.endsWith("/post.md"));
    const publish = createSocialActions(socialActionDeps()).publishPost;

    let handled = 0;
    for (const path of paths) {
      if (handled >= POSTS_PER_SHOP) break;
      const raw = await socialRepo.readFile(path);
      if (raw === null) continue;
      let post: SocialPost;
      try {
        post = parsePost(raw);
      } catch (e) {
        outcomes.push({ id: path, action: `unparseable: ${e instanceof Error ? e.message : e}` });
        continue;
      }

      if (post.status !== "scheduled") continue;
      if (!post.scheduledAt || Date.parse(post.scheduledAt) > Date.now()) continue;
      handled++;

      // 1 — re-verify the approve-at-schedule consent (D2).
      if (!post.approval || post.approval.hash !== approvalHash(post)) {
        const reverted: SocialPost = { ...post, status: "asset_ready" };
        delete reverted.scheduledAt;
        delete reverted.approval;
        await socialRepo.writeFile(postPath(post.id), serializePost(reverted));
        const action = post.approval
          ? "OUT-OF-BAND: publish material changed since approval — consent void, post back to asset_ready; re-propose social.schedule_post"
          : "OUT-OF-BAND: scheduled post has no approval record — back to asset_ready; re-propose social.schedule_post";
        console.error(`[cron-social] ${shop}/${post.id} ${action}`);
        outcomes.push({ id: post.id, action });
        continue;
      }

      // 2 — publish (the action writes platform/permalink/status back itself;
      // a failure writes status=failed + the message, then throws).
      try {
        const result = await publish.execute({ postId: post.id });
        outcomes.push({ id: post.id, action: result.summary });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[cron-social] ${shop}/${post.id} publish FAILED: ${message}`);
        outcomes.push({ id: post.id, action: `FAILED: ${message}` });
      }
    }
    return outcomes;
  });
}

export async function GET(req: NextRequest) {
  const denied = cronGate(req);
  if (denied) return denied;

  const shops = await shopsWithSocialPosts();
  const report = await cronSweep(
    "cron-social",
    shops,
    SHOPS_PER_FIRING,
    (shop) => shop,
    async (shop) => {
      const outcomes = await sweepShop(shop);
      if (outcomes.length === 0) return "nothing due";
      const flagged = outcomes.filter(
        (o) => o.action.startsWith("OUT-OF-BAND") || o.action.startsWith("FAILED"),
      );
      return `${outcomes.length} post(s)${flagged.length ? `, ${flagged.length} FLAGGED` : ""}: ${outcomes
        .map((o) => `${o.id}=${o.action}`)
        .join("; ")}`;
    },
  );
  return Response.json(report);
}
