/**
 * VENDORED from packages/skills/offers/src/types.ts (spec 32 OF0/OF2/OF3).
 *
 * CANONICAL LOGIC lives in packages/skills/offers — this is a mechanical
 * copy so the scaffolded template stays self-contained (it ships into a
 * store's own repo, outside this monorepo, so it cannot `workspace:*`
 * depend on the pack). Mirrors lib/email/repo.ts's vendoring convention.
 * A change here belongs in the pack first, then copied down — see spec 32
 * §12 OQ4 (this sync is not yet scripted/CI-checked, for any pack).
 */
/**
 * Offer Agent — type definitions (spec 32 OF0/OF2).
 *
 * This pack was consolidated from three diverging copies (spec 32 §1): the
 * MIT console template's `offer-{design,performance,review}.ts`, the pooled
 * runtime's `offers.ts`, and the private governance half in
 * `marketing-os-app`. The shapes below are the ones that were byte-identical
 * (or near enough) across the first two — the actual sources of duplication
 * bugs — pulled into one place.
 *
 * `OfferRepo` mirrors `EmailRepo`/`SocialRepo`: the seam `offers/*.md`
 * artifacts (below, OF2) read and write through — a store's repo via the
 * hosted runtime's `StoreRepo` binding (git-first per `STORE_REPO_MODE`,
 * spec 32 D6), an in-memory fake in tests.
 *
 * `OfferPlatformClient` and `OfferAttributionClient` are the seams — this
 * pack never sees a credential. The template binds them to
 * `MARKETING_OS_API_URL` + a per-tenant key; the pooled runtime binds them to
 * the broker's two-path auth (service key + `x-mos-tenant-shop`). Same
 * pattern as `KlaviyoClient` in the email pack.
 */

import type { ProvenanceClaim, StoreRepo } from "../skill-kit";

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

/** Client-side, zero-request targeting (spec 32 §5/OF3). `countries` reads
 * from a Liquid-rendered data attribute (Shopify already resolves it
 * server-side for the page render — no extra request); everything else
 * reads from data the runtime already has (viewport, referrer, URL). */
export interface OfferTargeting {
  devices?: ("desktop" | "mobile")[];
  referrerContains?: string[];
  utmSources?: string[];
  countries?: string[];
  returningOnly?: boolean;
}

export interface OfferManifest {
  id: string;
  type: "offer";
  placement: "corner-card" | "overlay" | "takeover";
  trigger: {
    /** exit-intent (OF3): desktop mouseout-toward-chrome; mobile has no
     * mouseout, so the runtime uses a scroll-velocity heuristic instead —
     * never a history/back-button trap. */
    kind: "delay" | "exit-intent";
    seconds: number;
    suppressAfterDismissDays: number;
    maxPerSession: number;
  };
  /** The re-open tab shown after a dismiss (OF3) — strictly less aggressive
   * than re-showing the modal; omitted/false means no teaser. */
  teaser?: { enabled: boolean };
  audience: {
    newVisitorsOnly: boolean;
    excludeSubscribed: boolean;
    pages: ("home" | "collection" | "product" | "cart")[];
    targeting?: OfferTargeting;
  };
  /** Campaign scheduling window (OF3), ISO datetimes. Evaluated client-side
   * as defense-in-depth; ideally the manifest endpoint also excludes
   * out-of-window surfaces server-side (smaller payload, no early leak of a
   * not-yet-live campaign) — that half is not built here. */
  schedule?: { from: string; to: string };
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
  /**
   * POST /api/offers/reallocate — every status transition and weight change
   * after the initial stage: pause/resume/retire (status only), promote
   * (winner takes the variant share) and thompson (posterior-weighted
   * reallocation). Control's share is never touched by promote/thompson.
   */
  reallocate(
    surfaceId: string,
    mode: "pause" | "resume" | "retire" | "promote" | "thompson",
    opts?: { days?: number; winner?: string },
  ): Promise<{ ok: boolean; surfaceId: string; status?: string }>;
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

// ---------------------------------------------------------------------------
// Repo artifacts (spec 32 §4/OF2) — offers/strategy.md, offers/{id}/offer.md,
// offers/{id}/results.md. Files are truth; the compiled OfferManifest above
// and the platform's index row are both projections rebuildable from these.
// ---------------------------------------------------------------------------

/** The lifecycle an offer.md's `status` field walks (spec 32 §4.2's event
 * list, minus the "reallocated"/"failed" events, which are results.md
 * entries rather than a resting state). */
export type OfferStatus = "proposed" | "approved" | "active" | "paused" | "retired";

/** offers/strategy.md — the standing offer strategy (spec 32 §4). */
export interface OfferStrategy {
  /** Incentive types this brand will run, in priority order, each with why
   * (cites the persona signal from brand.md §2/§6 it answers — spec 32 §2.1
   * of 14: "A discount is one arm of a hypothesis, never the default"). */
  incentives: { type: string; rationale: string; brandRef?: string }[];
  /** Placements this brand allows by default; a proposal may request one
   * outside this list, but it is a flag on the approval card, not a block —
   * the mechanical gates (dark-pattern, consent) are what actually block. */
  allowedPlacements: OfferManifest["placement"][];
  defaultConsentText: string;
  frequencyPosture: {
    suppressAfterDismissDays: number;
    maxPerSession: number;
  };
  /** A human-readable restatement of the mechanical dark-pattern stance —
   * documentation, not enforcement (gateOfferContent enforces regardless). */
  darkPatternStance: string;
  provenance: ProvenanceClaim[];
}

/** offers/{id}/offer.md — one offer's spec + status trail. */
export interface Offer {
  id: string;
  title: string;
  /** One sentence: why this offer, for this persona (propagated from
   * propose_offer's `hypothesis` param). */
  hypothesis: string;
  /** Citation into brand.md — the persona signal this incentive answers. */
  personaRef?: string;
  status: OfferStatus;
  manifest: OfferManifest;
  /** The compiled deploy's identity once activated — null before then. */
  experimentId: string | null;
  provenance: ProvenanceClaim[];
  /** Free-form notes body, same physical format as email's campaign.md. */
  body: string;
}

/** One results.md entry — a snapshot taken at a review (spec 32 §4). */
export interface OfferResultEntry {
  at: string; // ISO datetime
  decision: "promote" | "reallocate" | "continue" | "wash" | "retire";
  rationale: string;
  winner: string | null;
  /** The posteriors as of this read — arm key -> pBest, for the historical
   * record; not the full stats payload (that lives in the platform index). */
  posteriors: Record<string, number>;
}

/** offers/{id}/results.md — append-only review log for one offer. */
export interface OfferResults {
  offerId: string;
  entries: OfferResultEntry[];
}
