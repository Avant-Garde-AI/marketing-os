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
  /** Rendered on its own line in the display face's italic — the editorial
   * second beat of a headline ("Art for the room / you're working on."). */
  headlineAccent?: string;
  body: string;
  /** Up to three short value lines, "|"-separated. Kept a flat string so the
   * dark-pattern gate scans it like every other field. */
  points?: string;
  placeholder?: string;
  cta: string;
  success: string;
  consent: string;
  /** A quiet one-tap decline under the form. Never shaming — the gate's
   * confirmshame patterns apply to it like any other copy. */
  decline?: string;
  /** Takeover imagery. MUST be on the store's own Shopify CDN
   * (https://cdn.shopify.com/…): the runtime makes no third-party requests,
   * and compileOfferManifest, the platform validator and the runtime each
   * refuse anything else. */
  imageSrc?: string;
  imageAlt?: string;
  /** CSS object-position, e.g. "72% 35%" — where the crop should hold. */
  imageFocus?: string;
  /** A small caption over the image — what the room/set is. */
  imageCaption?: string;
}

export interface OfferManifestVariant {
  content: OfferVariantContent;
  style: {
    bg: string;
    ink: string;
    ink2: string;
    accent: string;
    line: string;
    /** Body face. "inherit" takes the theme's body font. */
    font: string;
    /** Headline face — pass the storefront's own display font by name. */
    fontDisplay?: string;
    /** Eyebrow/caption face. */
    fontMono?: string;
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
  /** The human name the agent gave the offer — what the merchant sees in the
   * admin instead of the slug. Ignored by the storefront runtime. */
  title?: string;
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
// Manifest v2 (spec 34 §2 / OH1) — steps of closed-set blocks on a named
// composition. v1 above (no `version` field, flat `content`) keeps rendering
// unchanged; the runtime and every validator branch on `version === "2"`.
// ---------------------------------------------------------------------------

export type Placement = "corner-card" | "overlay" | "takeover";
export type CompositionId = "split-image" | "full-bleed-image" | "editorial-type" | "card";

export type Block =
  | { kind: "eyebrow"; text: string }
  /** `accent` is the italic second beat of the headline. */
  | { kind: "headline"; text: string; accent?: string }
  | { kind: "body"; text: string }
  /** 1–3 items. */
  | { kind: "points"; items: string[] }
  /** `src` MUST be on https://cdn.shopify.com/. */
  | {
      kind: "image";
      src: string;
      alt: string;
      focus?: string;
      caption?: string;
      mobile?: "keep" | "drop";
    }
  /** Single-select, 2–4 options, advances on pick. `answerKey` matches
   * /^[a-z][a-z0-9_]{1,31}$/ — it becomes a profile property name. */
  | {
      kind: "choice";
      question: string;
      answerKey: string;
      options: { value: string; label: string }[];
    }
  | { kind: "email"; placeholder?: string; cta: string }
  /** Required in any step with `email`. Plain text — never a checkbox, so
   * pre-checked consent is structurally impossible. */
  | { kind: "consent"; text: string }
  /** Required in every non-reward step when steps.length > 1. */
  | { kind: "progress" }
  /** Advances to the next step (a hook without a choice). */
  | { kind: "cta"; label: string }
  | {
      kind: "reward";
      mode: "message" | "code" | "picks";
      headline: string;
      body?: string;
      /** Keyed by a choice option's `value`. `url` is a store-relative path. */
      picks?: Record<string, { title: string; url: string; imageSrc?: string }[]>;
      /** `href` is a store-relative path ("/collections/…") only. */
      link?: { label: string; href: string };
    }
  /** A neutral text link. Gated like all copy, plus value-framing refusal. */
  | { kind: "decline"; text: string };

export type BlockKind = Block["kind"];

export interface Step {
  id: string;
  kind: "hook" | "ask" | "reward";
  blocks: Block[];
}

/** Per variant, never per person (spec 34 H3). */
export interface Incentive {
  type: "none" | "content" | "early-access" | "free-shipping" | "percent";
  /** Percent points, for "percent". */
  value?: number;
  /** Defaults to "unique" when type is free-shipping | percent. */
  codeMode?: "unique" | "shared";
}

export type TriggerSpec =
  | { kind: "delay"; seconds: number }
  | { kind: "exit-intent" }
  | { kind: "scroll-dwell"; percent: number; dwellSeconds: number }
  | { kind: "product-views"; views: number };

export type ArchetypeId =
  | "quiet-editorial"
  | "zero-party-quiz"
  | "learn-and-earn"
  | "early-access"
  | "threshold"
  | "story";

export interface VariantV2Style {
  bg: string;
  ink: string;
  ink2: string;
  accent: string;
  line: string;
  font: string;
  fontDisplay?: string;
  fontMono?: string;
}

export interface VariantV2 {
  composition: CompositionId;
  /** 1–3. */
  steps: Step[];
  style: VariantV2Style;
  incentive?: Incentive;
  /** OH6: per-arm trigger policy override. */
  trigger?: TriggerSpec;
  /** Provenance from the harness. */
  archetype?: ArchetypeId;
}

export type IncumbentVendor =
  | "klaviyo"
  | "privy"
  | "justuno"
  | "optimonk"
  | "wisepops"
  | "sleeknote"
  | "omnisend"
  | "shopify-forms"
  | "alia"
  | "unknown";

export type ArmKind = "control" | "variant" | "incumbent";

export interface ArmV2 {
  key: string;
  weight: number;
  kind?: ArmKind;
  vendor?: IncumbentVendor;
}

export type CellDevice = "mobile" | "desktop";
export type CellVisit = "new" | "returning";
export type CellSource = "search" | "social" | "email" | "paid" | "direct" | "other";
/** `${device}.${visit}.${source}` (spec 34 §5.3 / contract §2). */
export type CellKey = `${CellDevice}.${CellVisit}.${CellSource}`;

export interface OfferManifestV2 {
  version: "2";
  id: string;
  type: "offer";
  title?: string;
  placement: Placement;
  trigger: TriggerSpec & { suppressAfterDismissDays: number; maxPerSession: number };
  /** Defaults to teaser-first for overlay/takeover. */
  mobile?: { searchArrival: "teaser-first" | "as-desktop" };
  teaser?: { enabled: boolean; label?: string };
  audience: {
    newVisitorsOnly: boolean;
    excludeSubscribed: boolean;
    pages: ("home" | "collection" | "product" | "cart")[];
    targeting?: OfferTargeting;
  };
  schedule?: { from: string; to: string };
  experiment: {
    id: string;
    policy: "fixed" | "thompson";
    allocation: number;
    /** Exactly one "control"; ≥1 variant; ≤1 incumbent. */
    arms: ArmV2[];
    /** OH6 per-cell weights; a missing cell falls back to `arms`. */
    cells?: Partial<Record<CellKey, { key: string; weight: number }[]>>;
  };
  /** Keyed by variant arm key; incumbent/control have none. */
  variants: Record<string, VariantV2>;
  consent: { capturesEmail: true };
}

// ---------------------------------------------------------------------------
// Preview diagnostics (contract §3) — what the runtime reports under
// `?mos_diag=1`; the conformance critic reads it.
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagReport {
  surfaceId: string;
  arm: string;
  step: number;
  steps: number;
  viewport: { w: number; h: number };
  composition: CompositionId | "v1";
  rects: { card: Rect; close?: Rect; cta?: Rect; input?: Rect; choices: Rect[]; decline?: Rect };
  /** Card content clipped / scroll needed at this viewport. */
  overflow: boolean;
  contrast: {
    role: "headline" | "body" | "cta" | "consent" | "decline";
    fg: string;
    bg: string;
    ratio: number;
  }[];
  /** null = no image block. */
  imageLoaded: boolean | null;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Incumbent audit (spec 34 §4.1 / contract §7) — facts measured by the
// render worker, graded by gradeOfferAudit (audit.ts).
// ---------------------------------------------------------------------------

export interface AuditFacts {
  viewport: "mobile" | "desktop";
  /** null = no popup found in 20 s. */
  vendor: IncumbentVendor | null;
  appeared: boolean;
  timeToShowMs: number | null;
  /** Dialog area / viewport area, 0–1. */
  coversPct: number | null;
  closeTarget: { w: number; h: number } | null;
  ctaTarget: { w: number; h: number } | null;
  ctaContrast: number | null;
  hasImage: boolean;
  hasConsentText: boolean;
  stepCount: number | null;
  incentiveText: string | null;
  /** For the dark-pattern scan. */
  visibleText: string;
  closeVisibleAtFirstPaint: boolean | null;
  vendorScriptKb: number | null;
  renderId: string | null;
}

export interface RubricLine {
  id: string;
  label: string;
  verdict: "pass" | "warn" | "fail" | "n/a";
  detail: string;
  viewport: "mobile" | "desktop" | "both";
}

export type OfferAuditGrade = "A" | "B" | "C" | "D" | "F" | "none";

export interface OfferAuditReport {
  vendor: IncumbentVendor | null;
  grade: OfferAuditGrade;
  score: number;
  lines: RubricLine[];
  facts: AuditFacts[];
  summary: string;
  createdAt: string;
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
  /** POST /api/offers/audit — enqueue an incumbent audit (free tier). */
  startAudit(): Promise<{ jobId: string }>;
  /**
   * POST /api/offers/design — enqueue the design harness. Free tier is one
   * run per 30 days; a binding MUST surface the platform's 409 quota
   * refusal as `OfferQuotaError` (tools.ts) so the agent can say so plainly.
   */
  startDesign(goal: string, constraints?: OfferDesignConstraints): Promise<{ jobId: string }>;
  /** GET /api/offers/jobs/:id. */
  getJob(jobId: string): Promise<OfferJobState>;
  /** GET /api/offers/audits/latest — null when the store was never audited. */
  latestAudit(): Promise<OfferAuditReport | null>;
}

export interface OfferDesignConstraints {
  placement?: Placement;
  incentiveTypes?: Incentive["type"][];
  margin?: { grossMarginPct: number; floorPct: number };
}

/** The platform job row, as `/api/offers/jobs/:id` reports it. `status` is
 * the orchestrator's (QUEUED | RUNNING | SUCCEEDED | FAILED); readers
 * compare case-insensitively (`offerJobPhase` in tools.ts). */
export interface OfferJobState {
  status: string;
  progress?: unknown;
  result?: unknown;
  error?: string | null;
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
