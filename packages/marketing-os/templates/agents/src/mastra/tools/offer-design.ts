// agents/src/mastra/tools/offer-design.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { checkDarkPatterns, type CaptureBundleRef } from "@avant-garde/design-loop";

// NOTE: design-loop 0.1.0 exports two colliding `GateResult` types (gates vs
// release gate) — the release one shadows. Use ReturnType until 0.1.1 renames.
type CopyGateResult = ReturnType<typeof checkDarkPatterns>;

/** Content-level observations for the design-loop gates (spec 14, O4).
 * Layout/a11y are component-guaranteed by the audited runtime renderer, so
 * the meaningful pre-approval gates on an offer are its COPY and consent. */
function gateVariantContent(all: Record<string, Record<string, string>>): {
  darkPattern: CopyGateResult;
  consentPresent: boolean;
} {
  const texts = Object.values(all).flatMap((c) => Object.values(c));
  const bundle = {
    location: "content://offer-proposal",
    manifest: { page: "-", themeRef: "-", commit: null, capturedAt: "-",
      versionVector: { agent: "offer-engine", skillset: "none", mcpSnapshot: "none", brandDoc: "none" } },
    screenshots: {}, tokens: {}, domSegments: [],
    observations: { texts, inputs: [], images: [], contrast: [], markers: [] },
  } as unknown as CaptureBundleRef;
  return {
    darkPattern: checkDarkPatterns(bundle),
    consentPresent: Object.values(all).every((c) => (c.consent ?? "").trim().length >= 10),
  };
}

/**
 * propose_offer (spec 14, O2) — SIDE-EFFECT FREE.
 *
 * The agent authors the offer (incentive selected from the persona, copy in
 * the brand voice) and passes it here; the tool normalizes it into a complete
 * surface manifest draft and returns it for the OfferProposalCard. Nothing
 * deploys until the merchant clicks Approve (which posts the draft to the
 * platform surface store — where it is mechanically re-validated).
 *
 * Rules the agent must follow (also enforced platform-side):
 * - control arm always present; weights sum to 1
 * - email capture requires consent text
 * - no urgency/scarcity theatrics — the platform blocklist rejects them
 */

const variantContent = z.object({
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
    placement: z.enum(["corner-card", "overlay"]).default("corner-card"),
    triggerSeconds: z.number().int().min(5).max(60).default(10),
    pages: z.array(z.enum(["home", "collection", "product", "cart"])).default(["home", "collection", "product"]),
    variants: z
      .record(z.string(), variantContent)
      .describe('Variant copy keyed by arm ("v1", "v2", …) — 1 or 2 variants'),
    controlWeight: z.number().min(0.2).max(0.5).default(0.34),
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
    const variantKeys = Object.keys(inputData.variants ?? {}).slice(0, 2);
    if (variantKeys.length === 0) throw new Error("At least one variant is required.");
    const controlWeight = inputData.controlWeight ?? 0.34;
    const share = (1 - controlWeight) / variantKeys.length;

    const surface = {
      id: inputData.surfaceSlug,
      type: "offer",
      placement: inputData.placement ?? "corner-card",
      trigger: {
        kind: "delay",
        seconds: inputData.triggerSeconds ?? 10,
        suppressAfterDismissDays: 14,
        maxPerSession: 1,
      },
      audience: {
        newVisitorsOnly: true,
        excludeSubscribed: true,
        pages: inputData.pages ?? ["home", "collection", "product"],
      },
      experiment: {
        id: `exp_${inputData.surfaceSlug}`,
        policy: "fixed",
        allocation: 1,
        arms: [
          { key: "control", weight: Number(controlWeight.toFixed(2)) },
          ...variantKeys.map((k) => ({ key: k, weight: Number(share.toFixed(2)) })),
        ],
      },
      variants: Object.fromEntries(
        variantKeys.map((k) => [
          k,
          {
            content: inputData.variants[k],
            style: {
              bg: "#ffffff",
              ink: "#1a1a1a",
              ink2: "rgba(26,26,26,.72)",
              accent: "#8d6c42",
              line: "rgba(26,26,26,.16)",
              font: "inherit",
            },
          },
        ])
      ),
      consent: { capturesEmail: true },
    };

    // O4: run the design-loop gates (the published package — the same
    // blocklist the design agent ships under) on the proposal content.
    const g = gateVariantContent(inputData.variants as Record<string, Record<string, string>>);
    const gates = {
      passed: g.darkPattern.passed && g.consentPresent,
      darkPattern: {
        passed: g.darkPattern.passed,
        findings: g.darkPattern.findings.map((f) => ({ code: f.code, message: f.message })),
      },
      consentPresent: g.consentPresent,
      componentGuarantees: ["WCAG AA renderer", "zero layout shift", "one-tap dismiss, remembered"],
    };

    return {
      proposalId: `offer-${Math.random().toString(36).slice(2, 8)}`,
      title: inputData.title,
      hypothesis: inputData.hypothesis,
      surface,
      reviewNote: gates.passed
        ? "Deploys as an experiment with a held-out control. Live within a minute of approval."
        : "Gates failed — revise the copy before this can be approved.",
      gates,
    };
  },
});
