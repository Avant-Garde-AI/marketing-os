/**
 * VENDORED from packages/skills/offers/src/tools.ts (spec 32 OF0).
 *
 * CANONICAL LOGIC lives in packages/skills/offers — this is a mechanical
 * copy so the scaffolded template stays self-contained (it ships into a
 * store's own repo, outside this monorepo, so it cannot `workspace:*`
 * depend on the pack). Mirrors lib/email/repo.ts's vendoring convention.
 * A change here belongs in the pack first, then copied down — see spec 32
 * §12 OQ4 (this sync is not yet scripted/CI-checked, for any pack).
 */
/**
 * Canonical offer tools (spec 32 OF0).
 *
 * `review_offer_experiment` and `chart_offer_performance` were byte-identical
 * (down to field names) across the template and pooled-runtime copies except
 * for transport, so they are fully unified here: one plain tool definition
 * per tool (skill-kit's `SkillToolDefinition` — deliberately not a Mastra
 * `createTool` instance, so this pack stays free of `@mastra/core` and each
 * runtime wraps these at merge time, per skill-kit's `tool.ts`), parameterized
 * by the `OfferPlatformClient`/`OfferAttributionClient` seams (types.ts).
 * Every binding vendors these two functions verbatim.
 *
 * `propose_offer` is NOT unified into a single tool here — the template and
 * the pooled runtime genuinely diverge in what happens after a proposal
 * compiles clean (spec 32 §1, `OfferProposalHandler`'s doc comment): the
 * template returns a draft for a console ProposalCard and defers deploy to a
 * separate approval route, while the pooled runtime stages the surface
 * PAUSED and opens a spec-20 Action proposal immediately. Each binding keeps
 * its own thin tool wrapper; both call `compileOfferManifest` +
 * `gateOfferContent` from this package, which is where the actual
 * duplication risk (weight math, the gate invocation) lived.
 */

import { z } from "zod";
import type { SkillToolDefinition } from "../skill-kit";
import { decideOfferExperiment } from "./decision";
import type { OfferAttributionClient, OfferPlatformClient } from "./types";

const armDecisionSchema = z.object({
  arm: z.string(),
  impressions: z.number(),
  captures: z.number(),
  captureRate: z.number().nullable(),
  ci95: z.tuple([z.number(), z.number()]).nullable(),
  pBest: z.number().nullable(),
});

const armStatsSchema = armDecisionSchema.extend({
  exposures: z.number(),
  dismisses: z.number(),
  attributedCustomers: z.number(),
  attributedOrders: z.number(),
  attributedRevenue: z.number(),
});

export interface CreateOfferToolsDeps {
  platform: OfferPlatformClient;
  attribution: OfferAttributionClient;
  /** Reported by the caller when the platform link errors or is unconfigured
   * — both bindings had their own `unavailable(err, what)` helper with
   * slightly different wording; this keeps that wording binding-owned. */
  onUnavailable: (err: unknown, what: string) => { unavailable: true; reason: string };
  defaultSurfaceId?: string;
}

function reviewOfferInputSchema(deps: CreateOfferToolsDeps) {
  return z.object({
    surfaceId: deps.defaultSurfaceId
      ? z.string().default(deps.defaultSurfaceId)
      : z.string().describe("The offer surface id, e.g. ofr_spring_editions"),
    days: z.number().int().min(7).max(90).default(30),
  });
}

const reviewOfferOutputSchema = z.union([
  z.object({
    surfaceId: z.string(),
    decision: z.enum(["promote", "reallocate", "continue", "wash"]),
    rationale: z.string(),
    winner: z.string().nullable(),
    arms: z.array(armDecisionSchema),
    actionable: z.boolean(),
    proposedMode: z.enum(["promote", "thompson"]).nullable(),
  }),
  z.object({ unavailable: z.literal(true), reason: z.string() }),
]);

export function createReviewOfferExperimentTool(
  deps: CreateOfferToolsDeps,
): SkillToolDefinition<ReturnType<typeof reviewOfferInputSchema>, typeof reviewOfferOutputSchema> {
  return {
    id: "review_offer_experiment",
    description:
      "Review a running offer experiment and recommend the next move: promote the winner, " +
      "shift traffic (Thompson), keep collecting, or call it a wash. Use when asked to review, " +
      "optimize, or decide on an offer test. Reads only — recommends, never applies.",
    inputSchema: reviewOfferInputSchema(deps),
    outputSchema: reviewOfferOutputSchema,
    execute: async (inputData) => {
      const days = inputData.days ?? 30;
      try {
        const stats = await deps.platform.getStats(inputData.surfaceId, days);
        const surface = stats.surfaces.find((s) => s.surfaceId === inputData.surfaceId);
        const arms = surface?.arms ?? [];
        const result = decideOfferExperiment(arms);
        if (result === null) {
          return { unavailable: true as const, reason: "No experiment data yet — the offer may not be live." };
        }
        return { surfaceId: inputData.surfaceId, arms, ...result };
      } catch (err) {
        return deps.onUnavailable(err, "Experiment review");
      }
    },
  };
}

function chartOfferInputSchema(deps: CreateOfferToolsDeps) {
  return z.object({
    surfaceId: deps.defaultSurfaceId
      ? z.string().default(deps.defaultSurfaceId)
      : z.string().describe("The offer surface id, e.g. ofr_spring_editions"),
    days: z.number().int().min(7).max(90).default(30),
  });
}

const chartOfferOutputSchema = z.union([
  z.object({ surfaceId: z.string(), days: z.number(), arms: z.array(armStatsSchema) }),
  z.object({ unavailable: z.literal(true), reason: z.string() }),
]);

export function createChartOfferPerformanceTool(
  deps: CreateOfferToolsDeps,
): SkillToolDefinition<ReturnType<typeof chartOfferInputSchema>, typeof chartOfferOutputSchema> {
  return {
    id: "chart_offer_performance",
    description:
      "Render the offer-performance funnel: per-arm exposures, impressions, captures, capture rate " +
      "with credible interval, probability-best, and Shopify-attributed customers/orders/revenue. " +
      "Use for questions about how an offer, popup, signup, or capture surface is performing.",
    inputSchema: chartOfferInputSchema(deps),
    outputSchema: chartOfferOutputSchema,
    execute: async (inputData) => {
      const days = inputData.days ?? 30;
      try {
        const stats = await deps.platform.getStats(inputData.surfaceId, days);
        const surface = stats.surfaces.find((s) => s.surfaceId === inputData.surfaceId);
        if (!surface || surface.arms.length === 0) {
          return {
            unavailable: true as const,
            reason: "No experiment data yet — the offer may not be live or hasn't had traffic.",
          };
        }
        const arms = await Promise.all(
          surface.arms.map(async (a) => {
            let customers = 0;
            let orders = 0;
            let revenue = 0;
            if (a.arm !== "control") {
              try {
                const found = await deps.attribution.findCapturedCustomers(inputData.surfaceId, a.arm);
                for (const c of found) {
                  customers += 1;
                  orders += c.orders_count ?? 0;
                  revenue += Number.parseFloat(c.total_spent ?? "0") || 0;
                }
              } catch {
                /* attribution optional — funnel still renders */
              }
            }
            return {
              ...a,
              attributedCustomers: customers,
              attributedOrders: orders,
              attributedRevenue: Math.round(revenue),
            };
          }),
        );
        return { surfaceId: inputData.surfaceId, days, arms };
      } catch (err) {
        return deps.onUnavailable(err, "Offer performance");
      }
    },
  };
}
