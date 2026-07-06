// agents/src/mastra/tools/offer-review.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * review_offer_experiment (spec 14, O3) — the decision read.
 *
 * Pulls the platform posteriors and applies the shared decision rules:
 *   promote    — an arm clears P(best) ≥ .95 with minimum samples
 *   reallocate — samples accruing; Thompson shift would speed learning
 *   continue   — not enough data yet
 *   wash       — big N, nobody separates; simplify
 *
 * SIDE-EFFECT FREE: applying a decision goes through the OfferDecisionCard's
 * Apply button (merchant-approved), or the nightly cron for surfaces already
 * on the thompson policy.
 */

const MIN_IMPRESSIONS = 200;
const MIN_CAPTURES = 10;
const PROMOTE_AT = 0.95;
const FUTILITY_AT = 0.7;
const FUTILITY_N = 2000;

const armOut = z.object({
  arm: z.string(),
  impressions: z.number(),
  captures: z.number(),
  captureRate: z.number().nullable(),
  ci95: z.tuple([z.number(), z.number()]).nullable(),
  pBest: z.number().nullable(),
});

export const reviewOfferExperiment = createTool({
  id: "review_offer_experiment",
  description:
    "Review a running offer experiment and recommend the next move: promote " +
    "the winner, shift traffic (Thompson), keep collecting, or call it a " +
    "wash. Use when asked to review, optimize, or decide on an offer test.",
  inputSchema: z.object({
    surfaceId: z.string().default("ofr_collectors_list_v1"),
    days: z.number().int().min(7).max(90).default(30),
  }),
  outputSchema: z.union([
    z.object({
      surfaceId: z.string(),
      decision: z.enum(["promote", "reallocate", "continue", "wash"]),
      rationale: z.string(),
      winner: z.string().nullable(),
      arms: z.array(armOut),
      actionable: z.boolean(),
      proposedMode: z.enum(["promote", "thompson"]).nullable(),
    }),
    z.object({ unavailable: z.literal(true), reason: z.string() }),
  ]),
  execute: async (inputData) => {
    const surfaceId = inputData.surfaceId ?? "ofr_collectors_list_v1";
    const days = inputData.days ?? 30;
    const apiUrl = process.env.MARKETING_OS_API_URL;
    const apiKey = process.env.MARKETING_OS_API_KEY;
    if (!apiUrl || !apiKey) {
      return { unavailable: true as const, reason: "Platform link not configured." };
    }
    try {
      const res = await fetch(
        `${apiUrl.replace(/\/$/, "")}/api/offers/stats?surfaceId=${encodeURIComponent(surfaceId)}&days=${days}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (!res.ok) return { unavailable: true as const, reason: `Stats unavailable (${res.status}).` };
      const stats = (await res.json()) as {
        surfaces: { surfaceId: string; arms: z.infer<typeof armOut>[] }[];
      };
      const surface = stats.surfaces.find((s) => s.surfaceId === surfaceId);
      const arms = surface?.arms ?? [];
      const shown = arms.filter((a) => a.arm !== "control");
      if (shown.length === 0) {
        return { unavailable: true as const, reason: "No experiment data yet — the offer may not be live." };
      }

      const totalCaptures = shown.reduce((t, a) => t + a.captures, 0);
      const minN = Math.min(...shown.map((a) => a.impressions));
      const top = [...shown].sort((a, b) => (b.pBest ?? 0) - (a.pBest ?? 0))[0]!;
      const samplesMet = minN >= MIN_IMPRESSIONS && totalCaptures >= MIN_CAPTURES;

      let decision: "promote" | "reallocate" | "continue" | "wash";
      let rationale: string;
      let proposedMode: "promote" | "thompson" | null = null;

      if (samplesMet && (top.pBest ?? 0) >= PROMOTE_AT) {
        decision = "promote";
        proposedMode = "promote";
        rationale = `"${top.arm}" is best with ${Math.round((top.pBest ?? 0) * 100)}% probability at ` +
          `${top.captureRate !== null ? (top.captureRate * 100).toFixed(1) : "—"}% capture. Promote it.`;
      } else if (minN >= FUTILITY_N && (top.pBest ?? 0) < FUTILITY_AT) {
        decision = "wash";
        rationale = `After ${minN.toLocaleString()}+ impressions per arm no variant separates ` +
          `(top P(best) ${Math.round((top.pBest ?? 0) * 100)}%). Keep the simpler variant and test a bolder difference next.`;
      } else if (samplesMet && shown.length >= 2) {
        decision = "reallocate";
        proposedMode = "thompson";
        rationale = `Signal is forming ("${top.arm}" at ${Math.round((top.pBest ?? 0) * 100)}% P(best)) but not ` +
          `conclusive. Shift new traffic toward the leader (Thompson) to learn faster without losing the control.`;
      } else {
        decision = "continue";
        rationale = `Not enough data yet (${minN.toLocaleString()} impressions on the smallest arm, ` +
          `${totalCaptures} captures total; needs ${MIN_IMPRESSIONS}/arm and ${MIN_CAPTURES} captures). Let it run.`;
      }

      return {
        surfaceId,
        decision,
        rationale,
        winner: decision === "promote" ? top.arm : null,
        arms,
        actionable: proposedMode !== null,
        proposedMode,
      };
    } catch (err) {
      return { unavailable: true as const, reason: err instanceof Error ? err.message : "review failed" };
    }
  },
});
