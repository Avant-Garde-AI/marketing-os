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

// ---------------------------------------------------------------------------
// The design harness's agent-facing half (spec 34 §0/§4.1): start an audit,
// start a design run, read a job. All three are reads/enqueues against the
// platform — none of them stages or activates anything. What the harness
// produces arrives as an `offer.activate` approval card, through the gate.
// ---------------------------------------------------------------------------

/** Bindings throw this when `/api/offers/design` answers 409 quota (free
 * tier: one design run per 30 days), so the tool can say so plainly
 * instead of reporting a generic outage. */
export class OfferQuotaError extends Error {
  constructor(public readonly retryAfter: string | null) {
    super("offer design quota reached");
    this.name = "OfferQuotaError";
  }
}

function isQuotaError(err: unknown): err is OfferQuotaError {
  return err instanceof OfferQuotaError || (err instanceof Error && err.name === "OfferQuotaError");
}

/** Normalise the orchestrator's job status (QUEUED | RUNNING | SUCCEEDED |
 * FAILED, any case) to the three phases the agent reasons about. */
export function offerJobPhase(status: string): "running" | "succeeded" | "failed" {
  const s = status.toLowerCase();
  if (s === "succeeded" || s === "success" || s === "done" || s === "complete" || s === "completed") return "succeeded";
  if (s.startsWith("fail") || s === "error" || s === "cancelled" || s === "canceled") return "failed";
  return "running";
}

export interface CreateOfferJobToolsDeps {
  platform: OfferPlatformClient;
  onUnavailable: CreateOfferToolsDeps["onUnavailable"];
  /** audit_current_offer polls the job this long before handing back the
   * jobId (default 50 s — inside a serverless turn's budget). */
  pollBudgetMs?: number;
  pollIntervalMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const unavailableSchema = z.object({ unavailable: z.literal(true), reason: z.string() });

const auditInputSchema = z.object({});

const auditOutputSchema = z.union([
  z.object({
    jobId: z.string(),
    status: z.enum(["succeeded", "running", "failed"]),
    report: z.unknown().optional(),
    error: z.string().optional(),
    note: z.string(),
  }),
  unavailableSchema,
]);

export function createAuditCurrentOfferTool(
  deps: CreateOfferJobToolsDeps,
): SkillToolDefinition<typeof auditInputSchema, typeof auditOutputSchema> {
  const budget = deps.pollBudgetMs ?? 50_000;
  const interval = deps.pollIntervalMs ?? 4_000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  return {
    id: "audit_current_offer",
    description:
      "Audit the welcome popup / email-capture offer this store already runs (Klaviyo, Privy, Alia, Justuno, " +
      "OptiMonk, Wisepops, Omnisend, Shopify Forms, or none): a headless first visit on desktop and mobile, " +
      "screenshots, and a graded report card (A–F) where every line cites what was measured. Read-only and " +
      "free on every plan. Use first whenever the merchant asks to improve, replace, or test their popup or " +
      "welcome offer.",
    inputSchema: auditInputSchema,
    outputSchema: auditOutputSchema,
    execute: async () => {
      let jobId: string;
      try {
        ({ jobId } = await deps.platform.startAudit());
      } catch (err) {
        return deps.onUnavailable(err, "Offer audit");
      }
      const deadline = now() + budget;
      try {
        while (now() < deadline) {
          await sleep(interval);
          const job = await deps.platform.getJob(jobId);
          const phase = offerJobPhase(job.status);
          if (phase === "succeeded") {
            return { jobId, status: phase, report: job.result, note: "Audit complete. Summarise the grade and the lines that failed, citing the measured numbers." };
          }
          if (phase === "failed") {
            return {
              jobId,
              status: phase,
              error: job.error ?? "the audit job failed",
              note: "Tell the merchant the audit could not complete and why; do not guess at a grade.",
            };
          }
        }
      } catch (err) {
        return deps.onUnavailable(err, "Offer audit");
      }
      return {
        jobId,
        status: "running" as const,
        note: "Still running (a headless visit takes a minute or two). Call get_offer_job with this jobId shortly.",
      };
    },
  };
}

const designInputSchema = z.object({
  goal: z
    .string()
    .min(3)
    .max(500)
    .describe('The merchant\'s goal in their words, e.g. "grow the list without discounting".'),
  constraints: z
    .object({
      placement: z.enum(["corner-card", "overlay", "takeover"]).optional(),
      incentiveTypes: z.array(z.enum(["none", "content", "early-access", "free-shipping", "percent"])).optional(),
      margin: z
        .object({ grossMarginPct: z.number().min(1).max(100), floorPct: z.number().min(0).max(99) })
        .optional()
        .describe("Only when the merchant states a margin floor; percent incentives are capped to stay above it."),
    })
    .optional(),
});

const designOutputSchema = z.union([
  z.object({ jobId: z.string(), status: z.literal("queued"), note: z.string() }),
  z.object({ quota: z.literal(true), retryAfter: z.string().nullable(), note: z.string() }),
  unavailableSchema,
]);

export function createDesignOfferChallengersTool(
  deps: CreateOfferJobToolsDeps,
): SkillToolDefinition<typeof designInputSchema, typeof designOutputSchema> {
  return {
    id: "design_offer_challengers",
    description:
      "Start the offer design harness: it writes several structurally different concepts from the brand, " +
      "renders each on this store's real storefront, critiques and repairs them, and picks the best two as " +
      "challengers to the current popup. Runs in the background for several minutes; the result arrives as " +
      "an approval card in Reviews with screenshots and a preview link. Never hand-author a v2 offer instead.",
    inputSchema: designInputSchema,
    outputSchema: designOutputSchema,
    execute: async (input) => {
      try {
        const { jobId } = await deps.platform.startDesign(input.goal, input.constraints);
        return {
          jobId,
          status: "queued" as const,
          note:
            "The harness is designing challengers now. The result arrives as an approval card in Reviews — " +
            "screenshots of each challenger beside the current popup, plus a preview link on the storefront. " +
            "Nothing reaches shoppers without approval, and going live needs the Starter plan.",
        };
      } catch (err) {
        if (isQuotaError(err)) {
          return {
            quota: true as const,
            retryAfter: err.retryAfter,
            note:
              "The free plan includes one challenger design run every 30 days and this store has used it. " +
              "Starter ($15/month) removes the limit and lets a challenger go live against the current popup.",
          };
        }
        return deps.onUnavailable(err, "Offer design");
      }
    },
  };
}

const jobInputSchema = z.object({ jobId: z.string().min(1) });
const jobOutputSchema = z.union([
  z.object({
    jobId: z.string(),
    status: z.enum(["succeeded", "running", "failed"]),
    progress: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  unavailableSchema,
]);

export function createGetOfferJobTool(
  deps: CreateOfferJobToolsDeps,
): SkillToolDefinition<typeof jobInputSchema, typeof jobOutputSchema> {
  return {
    id: "get_offer_job",
    description:
      "Check an offer audit or design job started by audit_current_offer or design_offer_challengers. " +
      "Returns its status, progress, and — once finished — the audit report or the design result.",
    inputSchema: jobInputSchema,
    outputSchema: jobOutputSchema,
    execute: async ({ jobId }) => {
      try {
        const job = await deps.platform.getJob(jobId);
        const out: { jobId: string; status: "succeeded" | "running" | "failed"; progress?: unknown; result?: unknown; error?: string } =
          { jobId, status: offerJobPhase(job.status) };
        if (job.progress !== undefined) out.progress = job.progress;
        if (job.result !== undefined) out.result = job.result;
        if (job.error) out.error = job.error;
        return out;
      } catch (err) {
        return deps.onUnavailable(err, "Offer job");
      }
    },
  };
}
