/**
 * Offer pack tools (spec 32 OF0-OF3) — replaces the three loose files
 * (offer-design.ts, offer-performance.ts, offer-review.ts) that predated the
 * pack pattern. Wraps the vendored pack's `review_offer_experiment` and
 * `chart_offer_performance` (lib/offers/tools.ts, byte-identical logic to
 * the pooled runtime's copy — see packages/skills/offers) and adds
 * `propose_offer`, which stays template-owned because this deployment's
 * approval flow differs from the pooled runtime's (§1 of spec 32): here,
 * propose_offer is SIDE-EFFECT FREE and returns a draft for the console's
 * OfferProposalCard; deploying happens when the merchant clicks Approve,
 * which POSTs to app/api/offers/deploy. It shares `compileOfferManifest` and
 * `gateOfferContent` with every other binding, which is where the actual
 * duplication risk (weight math, the gate invocation) used to live.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { z as zod } from "zod";
import { compileOfferManifest } from "../../../lib/offers/manifest";
import { gateOfferContent } from "../../../lib/offers/gates";
import { createReviewOfferExperimentTool, createChartOfferPerformanceTool } from "../../../lib/offers/tools";
import { offerPlatformClient, unavailable } from "../../../lib/offers/platform-client";
import { offerAttributionClient } from "../../../lib/offers/attribution-client";
import type { SkillToolDefinition } from "../../../lib/skill-kit";
import type { OfferVariantContent } from "../../../lib/offers/types";

function toMastraTool<I extends zod.ZodTypeAny, O extends zod.ZodTypeAny>(
  def: SkillToolDefinition<I, O>,
) {
  return createTool({
    id: def.id,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    execute: (input: zod.infer<I>) => def.execute(input),
  });
}

const offerToolDeps = {
  platform: offerPlatformClient,
  attribution: offerAttributionClient,
  onUnavailable: unavailable,
  defaultSurfaceId: "ofr_collectors_list_v1",
};

// ---------------------------------------------------------------------------
// propose_offer (O2 + O4) — side-effect free; deploy is a separate console
// approval route (app/api/offers/deploy)
// ---------------------------------------------------------------------------

const variantContentSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string().min(4).max(80),
  body: z.string().min(10).max(240),
  placeholder: z.string().default("Email address"),
  cta: z.string().min(2).max(30),
  success: z.string().min(4).max(120),
  consent: z.string().min(10).max(200),
});

export const proposeOffer = createTool({
  id: "propose_offer",
  description:
    "Propose a new storefront offer (email-capture surface) for merchant " +
    "review. Author the incentive FROM the persona (early access, content, " +
    "threshold, story — a discount is one option, never the default) and the " +
    "copy in the brand voice. Renders an approval card; deploys only on the " +
    "merchant's Approve. Use for any popup/offer/signup/list-building request.",
  inputSchema: z.object({
    surfaceSlug: z
      .string()
      .regex(/^[a-z0-9_-]{4,48}$/)
      .describe("Stable id, e.g. ofr_spring_editions"),
    title: z.string().describe("Short human name for the offer"),
    hypothesis: z.string().describe("One sentence: why this offer, for this persona"),
    placement: z
      .enum(["corner-card", "overlay", "takeover"])
      .default("corner-card")
      .describe("takeover is the full-screen format — use sparingly, e.g. a seasonal campaign, not a default."),
    triggerKind: z
      .enum(["delay", "exit-intent"])
      .default("delay")
      .describe("exit-intent fires as the visitor moves to leave, rather than after a fixed delay."),
    triggerSeconds: z.number().int().min(5).max(60).default(10).describe("Ignored when triggerKind is exit-intent."),
    pages: z.array(z.enum(["home", "collection", "product", "cart"])).default(["home", "collection", "product"]),
    variants: z
      .record(z.string(), variantContentSchema)
      .describe('Variant copy keyed by arm ("v1", "v2", …) — 1 or 2 variants'),
    controlWeight: z.number().min(0.2).max(0.5).default(0.34),
    teaser: z
      .boolean()
      .optional()
      .describe("Re-open tab after a dismiss. Defaults on for corner-card, off otherwise; set explicitly to override."),
    targeting: z
      .object({
        devices: z.array(z.enum(["desktop", "mobile"])).optional(),
        referrerContains: z.array(z.string()).optional(),
        utmSources: z.array(z.string()).optional(),
        countries: z.array(z.string()).optional(),
        returningOnly: z.boolean().optional(),
      })
      .optional()
      .describe("Client-side targeting — no extra request. countries reads Shopify's own resolved localization."),
    schedule: z
      .object({ from: z.string(), to: z.string() })
      .optional()
      .describe("ISO datetimes — a campaign window, e.g. Black Friday. Omit for an always-on offer."),
  }),
  outputSchema: z.object({
    proposalId: z.string(),
    title: z.string(),
    hypothesis: z.string(),
    surface: z.record(z.string(), z.unknown()),
    reviewNote: z.string(),
    gates: z.object({
      passed: z.boolean(),
      darkPattern: z.object({
        passed: z.boolean(),
        findings: z.array(z.object({ code: z.string(), message: z.string() })),
      }),
      consentPresent: z.boolean(),
      componentGuarantees: z.array(z.string()),
    }),
  }),
  execute: async (inputData) => {
    const variants = inputData.variants as Record<string, OfferVariantContent>;
    const surface = compileOfferManifest({
      surfaceSlug: inputData.surfaceSlug,
      placement: inputData.placement,
      triggerKind: inputData.triggerKind,
      triggerSeconds: inputData.triggerSeconds,
      pages: inputData.pages,
      variants,
      controlWeight: inputData.controlWeight,
      teaser: inputData.teaser,
      targeting: inputData.targeting,
      schedule: inputData.schedule,
    });

    const gates = gateOfferContent(variants as unknown as Record<string, Record<string, string>>);

    return {
      proposalId: `offer-${Math.random().toString(36).slice(2, 8)}`,
      title: inputData.title,
      hypothesis: inputData.hypothesis,
      surface: surface as unknown as Record<string, unknown>,
      reviewNote: gates.passed
        ? "Deploys as an experiment with a held-out control. Live within a minute of approval."
        : "Gates failed — revise the copy before this can be approved.",
      gates,
    };
  },
});

// ---------------------------------------------------------------------------
// review_offer_experiment + chart_offer_performance — vendored pack tools
// ---------------------------------------------------------------------------

export const reviewOfferExperiment = toMastraTool(createReviewOfferExperimentTool(offerToolDeps));
export const chartOfferPerformance = toMastraTool(createChartOfferPerformanceTool(offerToolDeps));
