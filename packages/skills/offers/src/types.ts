/**
 * Offer Agent — type definitions (spec 32 OF0).
 *
 * This pack was consolidated from three diverging copies (spec 32 §1): the
 * MIT console template's `offer-{design,performance,review}.ts`, the pooled
 * runtime's `offers.ts`, and the private governance half in
 * `marketing-os-app`. The shapes below are the ones that were byte-identical
 * (or near enough) across the first two — the actual sources of duplication
 * bugs — pulled into one place.
 *
 * `OfferRepo` mirrors `EmailRepo`/`SocialRepo`: unused until spec 32 OF2 wires
 * `offers/*.md` artifacts through it, declared now for shape parity with the
 * other packs and so OF2 is additive rather than a rename.
 *
 * `OfferPlatformClient` and `OfferAttributionClient` are the seams — this
 * pack never sees a credential. The template binds them to
 * `MARKETING_OS_API_URL` + a per-tenant key; the pooled runtime binds them to
 * the broker's two-path auth (service key + `x-mos-tenant-shop`). Same
 * pattern as `KlaviyoClient` in the email pack.
 */

import type { StoreRepo } from "@avant-garde/skill-kit";

export type OfferRepo = StoreRepo;

// ---------------------------------------------------------------------------
// The surface manifest (spec 14 §1.2) — the compiled artifact
// ---------------------------------------------------------------------------

export interface OfferVariantContent {
  eyebrow?: string;
  headline: string;
  body: string;
  placeholder?: string;
  cta: string;
  success: string;
  consent: string;
}

export interface OfferManifestVariant {
  content: OfferVariantContent;
  style: {
    bg: string;
    ink: string;
    ink2: string;
    accent: string;
    line: string;
    font: string;
  };
}

export interface OfferManifestArm {
  key: string;
  weight: number;
}

export interface OfferManifest {
  id: string;
  type: "offer";
  placement: "corner-card" | "overlay";
  trigger: {
    kind: "delay";
    seconds: number;
    suppressAfterDismissDays: number;
    maxPerSession: number;
  };
  audience: {
    newVisitorsOnly: boolean;
    excludeSubscribed: boolean;
    pages: ("home" | "collection" | "product" | "cart")[];
  };
  experiment: {
    id: string;
    policy: "fixed" | "thompson";
    allocation: number;
    arms: OfferManifestArm[];
  };
  variants: Record<string, OfferManifestVariant>;
  consent: { capturesEmail: true };
}

// ---------------------------------------------------------------------------
// Experiment stats — the shape both platform.offers.stats reads flow through
// ---------------------------------------------------------------------------

/** The fields the decision engine reasons over. Every richer arm shape
 * (chart's attribution-joined arm, the platform's raw stats arm) is a
 * superset of this. */
export interface OfferArmDecisionInput {
  arm: string;
  impressions: number;
  captures: number;
  captureRate: number | null;
  ci95: [number, number] | null;
  pBest: number | null;
}

/** The full per-arm shape `chart_offer_performance` renders — decision
 * fields plus funnel counts plus Shopify-attributed outcomes. */
export interface OfferArmStats extends OfferArmDecisionInput {
  exposures: number;
  dismisses: number;
  attributedCustomers: number;
  attributedOrders: number;
  attributedRevenue: number;
}

/** The platform stats response shape (`/api/offers/stats`), pre-attribution. */
export type OfferPlatformArm = Omit<
  OfferArmStats,
  "attributedCustomers" | "attributedOrders" | "attributedRevenue"
>;

export interface OfferPlatformStatsResponse {
  surfaces: { surfaceId: string; arms: OfferPlatformArm[] }[];
}

// ---------------------------------------------------------------------------
// The seams — pack-owned interfaces, binding-supplied implementations
// ---------------------------------------------------------------------------

/** The platform's own offer endpoints (surface store + daily counters).
 * Not a third-party broker call — see spec 32 §3; every binding talks to
 * the same first-party platform routes, just with different auth. */
export interface OfferPlatformClient {
  /** POST /api/offers/surfaces — stage or deploy a manifest at a status. */
  stageSurface(manifest: OfferManifest, status: "PAUSED" | "ACTIVE"): Promise<{
    ok: boolean;
    surfaceId: string;
    status: string;
  }>;
  /** GET /api/offers/stats — per-arm counters + posteriors for a surface. */
  getStats(surfaceId: string, days: number): Promise<OfferPlatformStatsResponse>;
}

/** Shopify capture-tag attribution (customers tagged `<surfaceId>`,
 * `arm:<arm>` by the capture endpoint). Optional — a failure here degrades
 * the funnel, it never blocks it. */
export interface OfferAttributionClient {
  findCapturedCustomers(
    surfaceId: string,
    arm: string,
  ): Promise<{ orders_count: number; total_spent: string }[]>;
}

/** What happens after a proposal compiles + gates cleanly. The template and
 * the pooled runtime answer this differently (spec 32 §1's real behavioral
 * fork, not just transport): the template stages nothing here — deploy is a
 * separate console-approval route — while the pooled runtime stages the
 * surface PAUSED and proposes `offer.activate` through the spec-20 gate.
 * Each binding supplies its own; the pack does not choose for them. */
export interface OfferProposalHandler {
  onCompiled(manifest: OfferManifest): Promise<{
    staged: boolean;
    proposalId: string | null;
    posted: boolean;
    channel: string | null;
    note: string;
  }>;
}
