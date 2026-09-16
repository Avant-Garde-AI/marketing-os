/**
 * VENDORED from packages/skills/offers/src/artifacts.ts (spec 32 OF0/OF2).
 *
 * CANONICAL LOGIC lives in packages/skills/offers — this is a mechanical
 * copy so the scaffolded template stays self-contained (it ships into a
 * store's own repo, outside this monorepo, so it cannot `workspace:*`
 * depend on the pack). Mirrors lib/email/repo.ts's vendoring convention.
 * A change here belongs in the pack first, then copied down — see spec 32
 * §12 OQ4 (this sync is not yet scripted/CI-checked, for any pack).
 */
/**
 * Parse + serialize the `offers/` repo artifacts (spec 32 §4/OF2), mirroring
 * the email pack's discipline exactly (spec 32 D6): YAML front matter +
 * markdown body via skill-kit's helpers, round-trip guarantee
 * `parse(serialize(x))` deep-equals `x`, document-name context on every
 * error.
 */

import {
  frontMatterDocument as document,
  splitFrontMatter,
  validateFrontMatter as validate,
} from "../skill-kit";
import { z } from "zod";
import type { Offer, OfferManifest, OfferResultEntry, OfferResults, OfferStatus, OfferStrategy } from "./types";

const ID_RE = /^[a-z0-9_-]{4,48}$/;

export const STRATEGY_PATH = "offers/strategy.md";

export function offerPath(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`offerPath: invalid offer id "${id}"`);
  return `offers/${id}/offer.md`;
}

export function resultsPath(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`resultsPath: invalid offer id "${id}"`);
  return `offers/${id}/results.md`;
}

// ---------------------------------------------------------------------------
// offers/strategy.md
// ---------------------------------------------------------------------------

const provenanceSchema = z.object({
  claim: z.string().min(1),
  origin: z.enum(["owner", "agent", "data"]),
});

const strategyFrontMatterSchema = z.object({
  incentives: z.array(
    z.object({
      type: z.string().min(1),
      rationale: z.string().min(1),
      brandRef: z.string().optional(),
    }),
  ),
  allowedPlacements: z.array(z.enum(["corner-card", "overlay"])),
  defaultConsentText: z.string().min(10),
  frequencyPosture: z.object({
    suppressAfterDismissDays: z.number().int().min(0),
    maxPerSession: z.number().int().min(1),
  }),
  darkPatternStance: z.string().min(1),
  provenance: z.array(provenanceSchema),
});

export function parseStrategy(raw: string): OfferStrategy {
  const { frontMatter } = splitFrontMatter(raw, STRATEGY_PATH);
  const fm = validate(strategyFrontMatterSchema, frontMatter, STRATEGY_PATH);
  return {
    incentives: fm.incentives,
    allowedPlacements: fm.allowedPlacements,
    defaultConsentText: fm.defaultConsentText,
    frequencyPosture: fm.frequencyPosture,
    darkPatternStance: fm.darkPatternStance,
    provenance: fm.provenance,
  };
}

export function serializeStrategy(strategy: OfferStrategy): string {
  const fm: Record<string, unknown> = {
    incentives: strategy.incentives,
    allowedPlacements: strategy.allowedPlacements,
    defaultConsentText: strategy.defaultConsentText,
    frequencyPosture: strategy.frequencyPosture,
    darkPatternStance: strategy.darkPatternStance,
    provenance: strategy.provenance,
  };
  return document(
    fm,
    "This document is the standing offer strategy — the incentives this brand will run, " +
      "and why. Edit the front matter directly, or co-create it in chat.",
  );
}

// ---------------------------------------------------------------------------
// offers/{id}/offer.md
// ---------------------------------------------------------------------------

const OFFER_STATUSES = ["proposed", "approved", "active", "paused", "retired"] as const satisfies readonly OfferStatus[];

const manifestVariantSchema = z.object({
  content: z.object({
    eyebrow: z.string().optional(),
    headline: z.string(),
    body: z.string(),
    placeholder: z.string().optional(),
    cta: z.string(),
    success: z.string(),
    consent: z.string(),
  }),
  style: z.object({
    bg: z.string(),
    ink: z.string(),
    ink2: z.string(),
    accent: z.string(),
    line: z.string(),
    font: z.string(),
  }),
});

export const offerManifestSchema = z.object({
  id: z.string(),
  type: z.literal("offer"),
  placement: z.enum(["corner-card", "overlay"]),
  trigger: z.object({
    kind: z.literal("delay"),
    seconds: z.number(),
    suppressAfterDismissDays: z.number(),
    maxPerSession: z.number(),
  }),
  audience: z.object({
    newVisitorsOnly: z.boolean(),
    excludeSubscribed: z.boolean(),
    pages: z.array(z.enum(["home", "collection", "product", "cart"])),
  }),
  experiment: z.object({
    id: z.string(),
    policy: z.enum(["fixed", "thompson"]),
    allocation: z.number(),
    arms: z.array(z.object({ key: z.string(), weight: z.number() })),
  }),
  variants: z.record(z.string(), manifestVariantSchema),
  consent: z.object({ capturesEmail: z.literal(true) }),
}) satisfies z.ZodType<OfferManifest>;

const offerFrontMatterSchema = z.object({
  id: z.string().regex(ID_RE),
  title: z.string().min(1),
  hypothesis: z.string().min(1),
  personaRef: z.string().optional(),
  status: z.enum(OFFER_STATUSES),
  manifest: offerManifestSchema,
  experimentId: z.string().nullable(),
  provenance: z.array(provenanceSchema),
});

export function parseOffer(raw: string): Offer {
  const { frontMatter, body } = splitFrontMatter(raw, "offers/*/offer.md");
  const fm = validate(offerFrontMatterSchema, frontMatter, "offers/*/offer.md");
  const offer: Offer = {
    id: fm.id,
    title: fm.title,
    hypothesis: fm.hypothesis,
    status: fm.status,
    manifest: fm.manifest,
    experimentId: fm.experimentId,
    provenance: fm.provenance,
    body: body.trim(),
  };
  if (fm.personaRef !== undefined) offer.personaRef = fm.personaRef;
  return offer;
}

export function serializeOffer(offer: Offer): string {
  const fm: Record<string, unknown> = {
    id: offer.id,
    title: offer.title,
    hypothesis: offer.hypothesis,
  };
  if (offer.personaRef !== undefined) fm.personaRef = offer.personaRef;
  fm.status = offer.status;
  fm.manifest = offer.manifest;
  fm.experimentId = offer.experimentId;
  fm.provenance = offer.provenance;
  return document(fm, offer.body);
}

// ---------------------------------------------------------------------------
// offers/{id}/results.md — append-only review log
// ---------------------------------------------------------------------------

const resultEntrySchema = z.object({
  at: z.string().datetime({ offset: true }),
  decision: z.enum(["promote", "reallocate", "continue", "wash", "retire"]),
  rationale: z.string().min(1),
  winner: z.string().nullable(),
  posteriors: z.record(z.string(), z.number()),
}) satisfies z.ZodType<OfferResultEntry>;

const resultsFrontMatterSchema = z.object({
  offerId: z.string().regex(ID_RE),
  entries: z.array(resultEntrySchema),
});

export function parseResults(raw: string): OfferResults {
  const { frontMatter } = splitFrontMatter(raw, "offers/*/results.md");
  const fm = validate(resultsFrontMatterSchema, frontMatter, "offers/*/results.md");
  return { offerId: fm.offerId, entries: fm.entries };
}

export function serializeResults(results: OfferResults): string {
  const fm: Record<string, unknown> = { offerId: results.offerId, entries: results.entries };
  return document(
    fm,
    "Append-only review log — one entry per `review_offer_experiment` read that produced a decision.",
  );
}

/** Append one entry to `offers/{id}/results.md`, creating the file if it
 * does not exist yet. Read-modify-write; callers under concurrent access
 * should treat a lost update as acceptable (the platform index is truth for
 * the CURRENT posteriors — this file is the historical narrative, not a
 * source other code reads back programmatically). */
export function appendResultEntry(existing: OfferResults | null, offerId: string, entry: OfferResultEntry): OfferResults {
  const base = existing ?? { offerId, entries: [] };
  return { offerId: base.offerId, entries: [...base.entries, entry] };
}
