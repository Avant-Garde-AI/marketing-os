/**
 * compileOfferManifest — the authoring→manifest compile (spec 14 O2/O4).
 *
 * Pulled verbatim (same weight math, same defaults) from what the template's
 * `offer-design.ts` and the pooled runtime's `offers.ts` had each grown
 * independently — this was the actual duplication risk spec 32 §1 names: a
 * weight-splitting bug fixed in one copy and not the other is a silent
 * experiment-integrity bug, not a cosmetic one.
 */

import type { OfferManifest, OfferVariantContent } from "./types";

export interface CompileOfferManifestInput {
  surfaceSlug: string;
  placement?: "corner-card" | "overlay";
  triggerSeconds?: number;
  pages?: ("home" | "collection" | "product" | "cart")[];
  variants: Record<string, OfferVariantContent>;
  controlWeight?: number;
}

const DEFAULT_STYLE = {
  bg: "#ffffff",
  ink: "#1a1a1a",
  ink2: "rgba(26,26,26,.72)",
  accent: "#8d6c42",
  line: "rgba(26,26,26,.16)",
  font: "inherit",
} as const;

export function compileOfferManifest(input: CompileOfferManifestInput): OfferManifest {
  const variantKeys = Object.keys(input.variants ?? {}).slice(0, 2);
  if (variantKeys.length === 0) {
    throw new Error("At least one variant is required.");
  }
  const controlWeight = input.controlWeight ?? 0.34;
  const share = (1 - controlWeight) / variantKeys.length;

  return {
    id: input.surfaceSlug,
    type: "offer",
    placement: input.placement ?? "corner-card",
    trigger: {
      kind: "delay",
      seconds: input.triggerSeconds ?? 10,
      suppressAfterDismissDays: 14,
      maxPerSession: 1,
    },
    audience: {
      newVisitorsOnly: true,
      excludeSubscribed: true,
      pages: input.pages ?? ["home", "collection", "product"],
    },
    experiment: {
      id: `exp_${input.surfaceSlug}`,
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
        { content: input.variants[k]!, style: { ...DEFAULT_STYLE } },
      ]),
    ),
    consent: { capturesEmail: true as const },
  };
}
