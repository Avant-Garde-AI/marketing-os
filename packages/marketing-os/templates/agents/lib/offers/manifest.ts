/**
 * VENDORED from packages/skills/offers/src/manifest.ts (spec 32 OF0/OF2/OF3).
 *
 * CANONICAL LOGIC lives in packages/skills/offers — this is a mechanical
 * copy so the scaffolded template stays self-contained (it ships into a
 * store's own repo, outside this monorepo, so it cannot `workspace:*`
 * depend on the pack). Mirrors lib/email/repo.ts's vendoring convention.
 * A change here belongs in the pack first, then copied down — see spec 32
 * §12 OQ4 (this sync is not yet scripted/CI-checked, for any pack).
 */
/**
 * compileOfferManifest — the authoring→manifest compile (spec 14 O2/O4,
 * extended OF3 for takeover/exit-intent/teaser/targeting/schedule).
 *
 * Pulled verbatim (same weight math, same defaults) from what the template's
 * `offer-design.ts` and the pooled runtime's `offers.ts` had each grown
 * independently — this was the actual duplication risk spec 32 §1 names: a
 * weight-splitting bug fixed in one copy and not the other is a silent
 * experiment-integrity bug, not a cosmetic one.
 */

import type { OfferManifest, OfferTargeting, OfferVariantContent } from "./types";

export interface CompileOfferManifestInput {
  surfaceSlug: string;
  placement?: "corner-card" | "overlay" | "takeover";
  /** delay (default) or exit-intent — see OfferManifest.trigger's doc. */
  triggerKind?: "delay" | "exit-intent";
  triggerSeconds?: number;
  pages?: ("home" | "collection" | "product" | "cart")[];
  variants: Record<string, OfferVariantContent>;
  controlWeight?: number;
  /** Defaults to true when placement is "corner-card" (the format the
   * teaser exists for); explicit false always wins. */
  teaser?: boolean;
  targeting?: OfferTargeting;
  /** ISO datetimes. Both required together, or omit entirely. */
  schedule?: { from: string; to: string };
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
  const placement = input.placement ?? "corner-card";

  const manifest: OfferManifest = {
    id: input.surfaceSlug,
    type: "offer",
    placement,
    trigger: {
      kind: input.triggerKind ?? "delay",
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

  const teaserOn = input.teaser ?? placement === "corner-card";
  if (teaserOn) manifest.teaser = { enabled: true };
  if (input.targeting) manifest.audience.targeting = input.targeting;
  if (input.schedule) manifest.schedule = input.schedule;

  return manifest;
}
