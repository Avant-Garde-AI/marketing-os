/**
 * VENDORED from packages/skills/offers/src/schema-v2.ts (spec 34).
 *
 * CANONICAL LOGIC lives in packages/skills/offers — this is a mechanical
 * copy so the scaffolded template stays self-contained (it ships into a
 * store's own repo, outside this monorepo, so it cannot `workspace:*`
 * depend on the pack). Mirrors lib/email/repo.ts's vendoring convention.
 * A change here belongs in the pack first, then copied down — see spec 32
 * §12 OQ4 (this sync is not yet scripted/CI-checked, for any pack).
 */
/**
 * Zod shapes for manifest v2 (spec 34 §2) and the harness's concept
 * authoring schema (spec 34 §3.2 / contract §8).
 *
 * SHAPE ONLY. The cross-field guarantees (email ⇒ consent in the same step,
 * progress on multi-step flows, CDN-only images, store-relative links, the
 * margin cap) are enforced by `checkManifestV2Structure`/
 * `compileOfferManifestV2` (manifest-v2.ts) and the copy rules by
 * `gateOfferManifestV2` (gates-v2.ts). Keeping refinements out of these
 * schemas keeps them representable as JSON Schema for a model's structured
 * output — the concept schema is what the harness hands the model.
 */

import { z } from "zod";
import type {
  ArchetypeId,
  Block,
  CompositionId,
  Incentive,
  OfferManifestV2,
  Placement,
  Step,
  TriggerSpec,
} from "./types";

export const PLACEMENTS = ["corner-card", "overlay", "takeover"] as const satisfies readonly Placement[];
export const COMPOSITIONS = [
  "split-image",
  "full-bleed-image",
  "editorial-type",
  "card",
] as const satisfies readonly CompositionId[];
export const ARCHETYPE_IDS = [
  "quiet-editorial",
  "zero-party-quiz",
  "learn-and-earn",
  "early-access",
  "threshold",
  "story",
] as const satisfies readonly ArchetypeId[];
export const INCENTIVE_TYPES = [
  "none",
  "content",
  "early-access",
  "free-shipping",
  "percent",
] as const satisfies readonly Incentive["type"][];

/** A choice's `answerKey` becomes a profile property name downstream. */
export const ANSWER_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;

const text = (max: number) => z.string().trim().min(1).max(max);

export const blockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("eyebrow"), text: text(40) }),
  z.object({ kind: z.literal("headline"), text: text(90), accent: text(70).optional() }),
  z.object({ kind: z.literal("body"), text: text(280) }),
  z.object({ kind: z.literal("points"), items: z.array(text(80)).min(1).max(3) }),
  z.object({
    kind: z.literal("image"),
    src: z.string().min(1),
    alt: text(160),
    focus: z.string().max(20).optional(),
    caption: text(60).optional(),
    mobile: z.enum(["keep", "drop"]).optional(),
  }),
  z.object({
    kind: z.literal("choice"),
    question: text(120),
    answerKey: z.string().regex(ANSWER_KEY_RE),
    options: z
      .array(z.object({ value: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/), label: text(40) }))
      .min(2)
      .max(4),
  }),
  z.object({ kind: z.literal("email"), placeholder: text(40).optional(), cta: text(30) }),
  z.object({ kind: z.literal("consent"), text: z.string().trim().min(10).max(240) }),
  z.object({ kind: z.literal("progress") }),
  z.object({ kind: z.literal("cta"), label: text(30) }),
  z.object({
    kind: z.literal("reward"),
    mode: z.enum(["message", "code", "picks"]),
    headline: text(90),
    body: text(240).optional(),
    picks: z
      .record(
        z.string(),
        z.array(z.object({ title: text(80), url: z.string().min(1), imageSrc: z.string().optional() })).max(4),
      )
      .optional(),
    link: z.object({ label: text(40), href: z.string().min(1) }).optional(),
  }),
  z.object({ kind: z.literal("decline"), text: text(40) }),
]) satisfies z.ZodType<Block>;

export const stepSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,23}$/),
  kind: z.enum(["hook", "ask", "reward"]),
  blocks: z.array(blockSchema).min(1).max(10),
}) satisfies z.ZodType<Step>;

export const incentiveSchema = z.object({
  type: z.enum(INCENTIVE_TYPES),
  value: z.number().positive().optional(),
  codeMode: z.enum(["unique", "shared"]).optional(),
}) satisfies z.ZodType<Incentive>;

export const triggerSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delay"), seconds: z.number().min(0) }),
  z.object({ kind: z.literal("exit-intent") }),
  z.object({ kind: z.literal("scroll-dwell"), percent: z.number().min(0).max(100), dwellSeconds: z.number().min(0) }),
  z.object({ kind: z.literal("product-views"), views: z.number().int().min(1) }),
]) satisfies z.ZodType<TriggerSpec>;

/**
 * The harness's concept authoring schema (contract §8): copy + structure
 * only. Style tokens come from DESIGN.md at compile time, never from the
 * model. `imageAlt` is an addition to the contract's field list — a concept
 * that names an image must be able to describe it.
 */
export const OfferConceptSchema = z.object({
  archetype: z.enum(ARCHETYPE_IDS),
  title: text(80),
  hypothesis: text(400),
  personaRef: z.string().max(200).optional(),
  composition: z.enum(COMPOSITIONS),
  steps: z.array(stepSchema).min(1).max(3),
  incentive: incentiveSchema,
  trigger: triggerSpecSchema.optional(),
  imageSrc: z.string().optional(),
  imageAlt: text(160).optional(),
});

export type OfferConcept = z.infer<typeof OfferConceptSchema>;

const targetingSchema = z.object({
  devices: z.array(z.enum(["desktop", "mobile"])).optional(),
  referrerContains: z.array(z.string()).optional(),
  utmSources: z.array(z.string()).optional(),
  countries: z.array(z.string()).optional(),
  returningOnly: z.boolean().optional(),
});

const styleSchema = z.object({
  bg: z.string(),
  ink: z.string(),
  ink2: z.string(),
  accent: z.string(),
  line: z.string(),
  font: z.string(),
  fontDisplay: z.string().optional(),
  fontMono: z.string().optional(),
});

const VENDORS = [
  "klaviyo",
  "privy",
  "justuno",
  "optimonk",
  "wisepops",
  "sleeknote",
  "omnisend",
  "shopify-forms",
  "alia",
  "unknown",
] as const;

export const CELL_KEY_RE = /^(mobile|desktop)\.(new|returning)\.(search|social|email|paid|direct|other)$/;

const weightsSchema = z.array(z.object({ key: z.string(), weight: z.number() }));

/** The v2 wire shape. `trigger` is flattened (TriggerSpec & frequency) —
 * zod's intersection of a discriminated union would reject extra keys, so
 * the four trigger kinds are each extended with the frequency fields. */
const frequency = { suppressAfterDismissDays: z.number().min(0), maxPerSession: z.number().int().min(1) };

export const offerManifestV2Schema = z.object({
  version: z.literal("2"),
  id: z.string().min(1),
  type: z.literal("offer"),
  title: z.string().optional(),
  placement: z.enum(PLACEMENTS),
  trigger: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("delay"), seconds: z.number().min(0), ...frequency }),
    z.object({ kind: z.literal("exit-intent"), ...frequency }),
    z.object({
      kind: z.literal("scroll-dwell"),
      percent: z.number().min(0).max(100),
      dwellSeconds: z.number().min(0),
      ...frequency,
    }),
    z.object({ kind: z.literal("product-views"), views: z.number().int().min(1), ...frequency }),
  ]),
  mobile: z.object({ searchArrival: z.enum(["teaser-first", "as-desktop"]) }).optional(),
  teaser: z.object({ enabled: z.boolean(), label: z.string().optional() }).optional(),
  audience: z.object({
    newVisitorsOnly: z.boolean(),
    excludeSubscribed: z.boolean(),
    pages: z.array(z.enum(["home", "collection", "product", "cart"])),
    targeting: targetingSchema.optional(),
  }),
  schedule: z.object({ from: z.string(), to: z.string() }).optional(),
  experiment: z.object({
    id: z.string().min(1),
    policy: z.enum(["fixed", "thompson"]),
    allocation: z.number().min(0).max(1),
    arms: z.array(
      z.object({
        key: z.string().min(1),
        weight: z.number(),
        kind: z.enum(["control", "variant", "incumbent"]).optional(),
        vendor: z.enum(VENDORS).optional(),
      }),
    ),
    cells: z.record(z.string().regex(CELL_KEY_RE), weightsSchema).optional(),
  }),
  variants: z.record(
    z.string(),
    z.object({
      composition: z.enum(COMPOSITIONS),
      steps: z.array(stepSchema),
      style: styleSchema,
      incentive: incentiveSchema.optional(),
      trigger: triggerSpecSchema.optional(),
      archetype: z.enum(ARCHETYPE_IDS).optional(),
    }),
  ),
  consent: z.object({ capturesEmail: z.literal(true) }),
});

// Compile-time proof the zod shape and the hand-written interface agree in
// the direction that matters (a parsed manifest is a valid OfferManifestV2).
type _ParsedIsV2 = z.infer<typeof offerManifestV2Schema> extends OfferManifestV2 ? true : never;
const _parsedIsV2: _ParsedIsV2 = true;
void _parsedIsV2;
