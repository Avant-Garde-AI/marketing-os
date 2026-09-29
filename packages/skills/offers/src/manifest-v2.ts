/**
 * compileOfferManifestV2 — harness concepts → a v2 manifest (spec 34 §2/§3,
 * contract §1). v1's `compileOfferManifest` (manifest.ts) is untouched.
 *
 * The compiler owns every mechanical guarantee that does not need a browser
 * (contract §1.1): a concept that breaks one is refused here with a message
 * naming the exact block, so the harness's bounded repair has something
 * precise to patch. Copy rules (dark patterns, decline framing) are the
 * gate's job (`gateOfferManifestV2`), because the harness scores them as a
 * critic rather than treating them as a compile error.
 */

import { OFFER_IMAGE_ORIGIN } from "./manifest";
import { ANSWER_KEY_RE, CELL_KEY_RE, OfferConceptSchema, type OfferConcept } from "./schema-v2";
import type {
  ArmKind,
  ArmV2,
  Block,
  IncumbentVendor,
  OfferManifestV2,
  OfferTargeting,
  Placement,
  TriggerSpec,
  VariantV2,
  VariantV2Style,
} from "./types";

const ID_RE = /^[a-z0-9_-]{4,48}$/;

export const MAX_STEPS = 3;
/** Percent cap when no margin policy is given (contract §1.1). */
export const DEFAULT_PERCENT_CAP = 20;
/** Vendors the runtime can suppress + observe (contract §4). Anything else
 * gets a sequential test, never an incumbent arm. */
export const HEAD_TO_HEAD_VENDORS: readonly IncumbentVendor[] = ["klaviyo"];
/** Compositions whose layout is built around an image in the hook step. */
export const IMAGE_COMPOSITIONS = ["split-image", "full-bleed-image"] as const;

export interface MarginPolicy {
  grossMarginPct: number;
  floorPct: number;
}

export interface CompileOfferManifestV2Input {
  slug: string;
  title?: string;
  /** Default "corner-card", as v1. */
  placement?: Placement;
  /** 1 or 2 concepts, which become arms `v1` and `v2` in order. */
  concepts: OfferConcept[];
  /** DESIGN.md tokens merged over the neutral defaults — never from the model. */
  style?: Partial<VariantV2Style>;
  /** Default 0.34, or 0.25 with an incumbent (four equal arms). 0.1–0.5 —
   * below 0.1 the holdback read takes too long to mean anything. */
  controlWeight?: number;
  incumbent?: { vendor: IncumbentVendor };
  margin?: MarginPolicy;
  /** Default { kind: "delay", seconds: 10 }. */
  trigger?: TriggerSpec;
  suppressAfterDismissDays?: number;
  maxPerSession?: number;
  policy?: "fixed" | "thompson";
  targeting?: OfferTargeting;
  schedule?: { from: string; to: string };
  pages?: ("home" | "collection" | "product" | "cart")[];
  /** Default on for corner-card and whenever mobile search arrival is
   * teaser-first (the teaser IS that state). */
  teaser?: boolean | { enabled: boolean; label?: string };
  /** Default teaser-first for overlay/takeover, as-desktop for corner-card. */
  mobileSearchArrival?: "teaser-first" | "as-desktop";
}

export const DEFAULT_STYLE_V2: VariantV2Style = {
  bg: "#ffffff",
  ink: "#1a1a1a",
  ink2: "rgba(26,26,26,.72)",
  accent: "#8d6c42",
  line: "rgba(26,26,26,.16)",
  font: "inherit",
};

/** One structural problem, addressed to the field that caused it. */
export interface ManifestV2Problem {
  code: string;
  message: string;
  path: string;
  variant?: string;
}

export interface StructureCheckOptions {
  /** When given, `percent` incentives must be ≤ this. Without it only the
   * 0 < value ≤ 100 sanity bound applies — the margin policy is a compile
   * input and does not travel on the manifest. */
  percentCap?: number;
}

/** Store-relative path only: "/x", never "//host" or "/\host" (both are
 * protocol-relative to a browser) and never a scheme. */
export function isStoreRelativePath(href: string): boolean {
  return /^\/(?![/\\])[^\s:]*$/.test(href);
}

export function resolveArmKind(arm: ArmV2): ArmKind {
  if (arm.kind) return arm.kind;
  if (arm.key === "control") return "control";
  if (arm.key === "incumbent") return "incumbent";
  return "variant";
}

export function percentCapFor(margin?: MarginPolicy): number {
  return margin ? margin.grossMarginPct - margin.floorPct : DEFAULT_PERCENT_CAP;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
const WEIGHT_TOLERANCE = 0.001;

function checkVariant(key: string, v: VariantV2, opts: StructureCheckOptions): ManifestV2Problem[] {
  const problems: ManifestV2Problem[] = [];
  const base = `variants.${key}`;
  const add = (code: string, path: string, message: string) =>
    problems.push({ code: `structure/${code}`, path, message, variant: key });

  if (v.steps.length < 1 || v.steps.length > MAX_STEPS) {
    add("step-count", `${base}.steps`, `needs 1–${MAX_STEPS} steps, has ${v.steps.length}`);
  }
  const ids = new Set<string>();
  const optionValues = new Set<string>();
  let emails = 0;
  let hasChoice = false;
  const multi = v.steps.length > 1;

  v.steps.forEach((step, i) => {
    const sp = `${base}.steps[${i}]`;
    if (ids.has(step.id)) add("step-id", `${sp}.id`, `duplicate step id "${step.id}"`);
    ids.add(step.id);
    if (step.blocks.length === 0) add("empty-step", sp, "step has no blocks");

    const kinds = step.blocks.map((b) => b.kind);
    const count = (k: Block["kind"]) => kinds.filter((x) => x === k).length;
    const isLast = i === v.steps.length - 1;

    if (count("choice") > 1) add("choice-count", sp, `at most one choice per step, has ${count("choice")}`);
    if (count("email") > 0 && count("consent") === 0) {
      add("consent-missing", sp, "a step with an email field must carry consent text in the same step");
    }
    if (multi && step.kind !== "reward" && count("progress") === 0) {
      add("progress-missing", sp, `a ${v.steps.length}-step flow needs a progress block in every non-reward step`);
    }
    if (step.kind === "reward") {
      if (!isLast) add("reward-position", sp, "a reward step must be the last step");
      if (count("reward") === 0) add("reward-missing", sp, "a reward step needs a reward block");
      if (count("email") + count("choice") > 0) add("reward-inputs", sp, "a reward step cannot ask for input");
    } else if (count("reward") > 0) {
      add("reward-placement", sp, `reward blocks belong in a step of kind "reward", not "${step.kind}"`);
    }
    if (!isLast && count("choice") + count("cta") + count("email") === 0) {
      add("dead-end", sp, "every step before the last needs a choice, cta, or email to advance");
    }

    step.blocks.forEach((b, j) => {
      const bp = `${sp}.blocks[${j}]`;
      switch (b.kind) {
        case "email":
          emails += 1;
          break;
        case "consent":
          if (b.text.trim().length < 10) add("consent-short", `${bp}.text`, "consent text must be at least 10 characters");
          break;
        case "points":
          if (b.items.length < 1 || b.items.length > 3) add("points-count", `${bp}.items`, `points needs 1–3 items, has ${b.items.length}`);
          break;
        case "choice": {
          hasChoice = true;
          if (!ANSWER_KEY_RE.test(b.answerKey)) {
            add("answer-key", `${bp}.answerKey`, `answerKey "${b.answerKey}" must match ${ANSWER_KEY_RE}`);
          }
          if (b.options.length < 2 || b.options.length > 4) {
            add("choice-options", `${bp}.options`, `a choice needs 2–4 options, has ${b.options.length}`);
          }
          const seen = new Set<string>();
          for (const o of b.options) {
            if (seen.has(o.value)) add("choice-duplicate", `${bp}.options`, `duplicate option value "${o.value}"`);
            seen.add(o.value);
            optionValues.add(o.value);
          }
          break;
        }
        case "image":
          if (!b.src.startsWith(OFFER_IMAGE_ORIGIN)) {
            add("image-origin", `${bp}.src`, `image must be on the store's Shopify CDN (${OFFER_IMAGE_ORIGIN}…), got "${b.src}"`);
          }
          break;
        case "reward":
          if (b.link && !isStoreRelativePath(b.link.href)) {
            add("reward-link", `${bp}.link.href`, `reward link must be a store-relative path starting with "/", got "${b.link.href}"`);
          }
          if (b.mode === "picks" && (!b.picks || Object.keys(b.picks).length === 0)) {
            add("picks-missing", `${bp}.picks`, 'mode "picks" needs picks keyed by a choice option value');
          }
          for (const [answer, picks] of Object.entries(b.picks ?? {})) {
            picks.forEach((p, k) => {
              if (!isStoreRelativePath(p.url)) {
                add("pick-url", `${bp}.picks.${answer}[${k}].url`, `pick url must be a store-relative path, got "${p.url}"`);
              }
              if (p.imageSrc !== undefined && !p.imageSrc.startsWith(OFFER_IMAGE_ORIGIN)) {
                add("image-origin", `${bp}.picks.${answer}[${k}].imageSrc`, `pick image must be on ${OFFER_IMAGE_ORIGIN}…, got "${p.imageSrc}"`);
              }
            });
          }
          break;
        default:
          break;
      }
    });
  });

  if (emails !== 1) add("email-count", `${base}.steps`, `an offer captures exactly one email; found ${emails} email blocks`);

  // Picks must be keyed by a real answer, or the reward renders empty.
  v.steps.forEach((step, i) =>
    step.blocks.forEach((b, j) => {
      if (b.kind !== "reward" || !b.picks) return;
      if (!hasChoice) {
        add("picks-without-choice", `${base}.steps[${i}].blocks[${j}].picks`, "picks need a choice earlier in the flow");
        return;
      }
      for (const answer of Object.keys(b.picks)) {
        if (!optionValues.has(answer)) {
          add("picks-key", `${base}.steps[${i}].blocks[${j}].picks.${answer}`, `"${answer}" is not a value of any choice option`);
        }
      }
    }),
  );

  if ((IMAGE_COMPOSITIONS as readonly string[]).includes(v.composition)) {
    const first = v.steps[0];
    if (first && !first.blocks.some((b) => b.kind === "image")) {
      add("composition-image", `${base}.steps[0]`, `composition "${v.composition}" needs an image block in the first step`);
    }
  }

  const inc = v.incentive;
  if (inc?.type === "percent") {
    const cap = opts.percentCap ?? 100;
    if (inc.value === undefined || !(inc.value > 0)) {
      add("incentive-value", `${base}.incentive.value`, "a percent incentive needs a value > 0");
    } else if (inc.value > cap) {
      add(
        "incentive-cap",
        `${base}.incentive.value`,
        opts.percentCap === undefined
          ? `${inc.value}% is not a valid percent`
          : `${inc.value}% exceeds the ${round2(cap)}% cap (margin policy, or ${DEFAULT_PERCENT_CAP}% when none is given)`,
      );
    }
  }

  for (const [token, val] of Object.entries(v.style)) {
    if (val !== undefined && (typeof val !== "string" || val.trim() === "")) {
      add("style-token", `${base}.style.${token}`, "style tokens must be non-empty strings");
    }
  }
  return problems;
}

/**
 * Every structural guarantee of contract §1.1 that is checkable without a
 * browser, over a whole v2 manifest. Returns problems; never throws. Shared
 * by the compiler (which throws on any), the gate and the validator (which
 * report them).
 */
export function checkManifestV2Structure(
  m: OfferManifestV2,
  opts: StructureCheckOptions = {},
): ManifestV2Problem[] {
  const problems: ManifestV2Problem[] = [];
  const add = (code: string, path: string, message: string) =>
    problems.push({ code: `structure/${code}`, path, message });

  const arms = m.experiment.arms;
  const keys = arms.map((a) => a.key);
  if (new Set(keys).size !== keys.length) add("arm-keys", "experiment.arms", "arm keys must be unique");
  const byKind = (k: ArmKind) => arms.filter((a) => resolveArmKind(a) === k);
  if (byKind("control").length !== 1) {
    add("control-arm", "experiment.arms", `exactly one control arm required, found ${byKind("control").length}`);
  }
  if (byKind("variant").length < 1) add("variant-arm", "experiment.arms", "at least one variant arm required");
  const incumbents = byKind("incumbent");
  if (incumbents.length > 1) add("incumbent-arm", "experiment.arms", `at most one incumbent arm, found ${incumbents.length}`);
  for (const a of incumbents) {
    if (!a.vendor || !HEAD_TO_HEAD_VENDORS.includes(a.vendor)) {
      add(
        "incumbent-vendor",
        `experiment.arms.${a.key}.vendor`,
        `head-to-head supports ${HEAD_TO_HEAD_VENDORS.join(", ")} only; "${a.vendor ?? "none"}" needs a sequential test`,
      );
    }
  }
  for (const a of arms) {
    if (!Number.isFinite(a.weight) || a.weight < 0) add("arm-weight", `experiment.arms.${a.key}.weight`, "weights must be ≥ 0");
    const kind = resolveArmKind(a);
    if (kind === "variant" && !m.variants[a.key]) {
      add("arm-variant", `experiment.arms.${a.key}`, `variant arm "${a.key}" has no entry in variants`);
    }
    if (kind !== "variant" && m.variants[a.key]) {
      add("arm-variant", `variants.${a.key}`, `${kind} arm "${a.key}" must not carry a variant`);
    }
  }
  for (const k of Object.keys(m.variants)) {
    const arm = arms.find((a) => a.key === k);
    if (!arm || resolveArmKind(arm) !== "variant") add("orphan-variant", `variants.${k}`, `variant "${k}" has no variant arm`);
  }
  const total = sum(arms.map((a) => a.weight));
  if (Math.abs(total - 1) > WEIGHT_TOLERANCE) add("weights-sum", "experiment.arms", `arm weights sum to ${round2(total)}, not 1`);

  for (const [cell, weights] of Object.entries(m.experiment.cells ?? {})) {
    if (!CELL_KEY_RE.test(cell)) add("cell-key", `experiment.cells.${cell}`, `"${cell}" is not device.visit.source`);
    const ws = weights ?? [];
    for (const w of ws) {
      if (!keys.includes(w.key)) add("cell-arm", `experiment.cells.${cell}`, `unknown arm "${w.key}"`);
    }
    const t = sum(ws.map((w) => w.weight));
    if (Math.abs(t - 1) > WEIGHT_TOLERANCE) add("cell-weights", `experiment.cells.${cell}`, `weights sum to ${round2(t)}, not 1`);
  }

  if (!(m.experiment.allocation >= 0 && m.experiment.allocation <= 1)) {
    add("allocation", "experiment.allocation", "allocation must be within 0–1");
  }
  if (m.mobile?.searchArrival === "teaser-first" && !m.teaser?.enabled) {
    add("teaser-first", "teaser", 'mobile.searchArrival "teaser-first" needs the teaser enabled (or set "as-desktop")');
  }
  if (m.schedule) {
    const from = Date.parse(m.schedule.from);
    const to = Date.parse(m.schedule.to);
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) {
      add("schedule", "schedule", "schedule needs valid ISO datetimes with from < to");
    }
  }
  if (m.consent?.capturesEmail !== true) add("consent-flag", "consent.capturesEmail", "must be true");

  for (const [k, v] of Object.entries(m.variants)) problems.push(...checkVariant(k, v, opts));
  return problems;
}

function formatProblems(problems: ManifestV2Problem[]): string {
  return problems.map((p) => `${p.path}: ${p.message}`).join("; ");
}

function hasImage(steps: VariantV2["steps"]): boolean {
  return steps.some((s) => s.blocks.some((b) => b.kind === "image"));
}

function normalizeIncentive(inc: OfferConcept["incentive"]): NonNullable<VariantV2["incentive"]> {
  const out: NonNullable<VariantV2["incentive"]> = { type: inc.type };
  if (inc.value !== undefined) out.value = inc.value;
  if (inc.type === "free-shipping" || inc.type === "percent") out.codeMode = inc.codeMode ?? "unique";
  return out;
}

function conceptToVariant(c: OfferConcept, style: VariantV2Style): VariantV2 {
  const steps: VariantV2["steps"] = structuredClone(c.steps);
  if (c.imageSrc && !hasImage(steps) && steps[0]) {
    steps[0].blocks.unshift({ kind: "image", src: c.imageSrc, alt: c.imageAlt ?? c.title });
  }
  const v: VariantV2 = {
    composition: c.composition,
    steps,
    style: { ...style },
    incentive: normalizeIncentive(c.incentive),
    archetype: c.archetype,
  };
  if (c.trigger) v.trigger = c.trigger;
  return v;
}

function splitWeights(controlWeight: number, shares: number): { control: number; share: number } {
  const share = round2((1 - controlWeight) / shares);
  // Control absorbs the rounding so the arms always sum to exactly 1.
  return { control: round2(1 - share * shares), share };
}

export function compileOfferManifestV2(input: CompileOfferManifestV2Input): OfferManifestV2 {
  const fail = (msg: string): never => {
    throw new Error(`compileOfferManifestV2: ${msg}`);
  };

  if (!ID_RE.test(input.slug)) fail(`slug "${input.slug}" must match ${ID_RE}`);
  const count = input.concepts?.length ?? 0;
  if (count < 1 || count > 2) fail(`needs 1 or 2 concepts (they become arms v1, v2), got ${count}`);

  const concepts = input.concepts.map((raw, i) => {
    const parsed = OfferConceptSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`).join("; ");
      return fail(`concept ${i + 1} ("${(raw as { title?: string })?.title ?? "untitled"}") is malformed — ${issues}`);
    }
    return parsed.data;
  });

  if (input.incumbent && !HEAD_TO_HEAD_VENDORS.includes(input.incumbent.vendor)) {
    fail(
      `head-to-head supports ${HEAD_TO_HEAD_VENDORS.join(", ")} only; "${input.incumbent.vendor}" cannot be ` +
        "suppressed and observed cleanly, so it gets a sequential test instead of an incumbent arm",
    );
  }
  if (input.margin) {
    const { grossMarginPct: g, floorPct: f } = input.margin;
    if (!(g > 0 && g <= 100) || !(f >= 0 && f < g)) {
      fail(`margin policy needs 0 < grossMarginPct ≤ 100 and 0 ≤ floorPct < grossMarginPct (got ${g}/${f})`);
    }
  }
  const controlWeight = input.controlWeight ?? (input.incumbent ? 0.25 : 0.34);
  if (!(controlWeight >= 0.1 && controlWeight <= 0.5)) fail(`controlWeight must be within 0.1–0.5, got ${controlWeight}`);

  const placement = input.placement ?? "corner-card";
  const style: VariantV2Style = { ...DEFAULT_STYLE_V2, ...(input.style ?? {}) };
  const variantKeys = concepts.map((_, i) => `v${i + 1}`);
  const { control, share } = splitWeights(controlWeight, variantKeys.length + (input.incumbent ? 1 : 0));

  const arms: ArmV2[] = [
    { key: "control", weight: control, kind: "control" },
    ...variantKeys.map((key) => ({ key, weight: share, kind: "variant" as const })),
  ];
  if (input.incumbent) arms.push({ key: "incumbent", weight: share, kind: "incumbent", vendor: input.incumbent.vendor });

  const searchArrival = input.mobileSearchArrival ?? (placement === "corner-card" ? "as-desktop" : "teaser-first");
  const teaserInput =
    typeof input.teaser === "boolean" ? { enabled: input.teaser } : input.teaser;
  if (searchArrival === "teaser-first" && teaserInput && !teaserInput.enabled) {
    fail('mobile search arrival "teaser-first" shows the teaser — it cannot be disabled; pass mobileSearchArrival "as-desktop" to override');
  }
  const teaserEnabled = teaserInput?.enabled ?? (placement === "corner-card" || searchArrival === "teaser-first");

  const trigger = input.trigger ?? { kind: "delay" as const, seconds: 10 };
  const manifest: OfferManifestV2 = {
    version: "2",
    id: input.slug,
    type: "offer",
    placement,
    trigger: {
      ...trigger,
      suppressAfterDismissDays: input.suppressAfterDismissDays ?? 14,
      maxPerSession: input.maxPerSession ?? 1,
    },
    mobile: { searchArrival },
    audience: {
      newVisitorsOnly: true,
      excludeSubscribed: true,
      pages: input.pages ?? ["home", "collection", "product"],
    },
    experiment: { id: `exp_${input.slug}`, policy: input.policy ?? "fixed", allocation: 1, arms },
    variants: Object.fromEntries(concepts.map((c, i) => [variantKeys[i]!, conceptToVariant(c, style)])),
    consent: { capturesEmail: true },
  };
  if (teaserEnabled) {
    manifest.teaser = { enabled: true };
    if (teaserInput?.label) manifest.teaser.label = teaserInput.label;
  }
  if (input.title) manifest.title = input.title;
  if (input.targeting) manifest.audience.targeting = input.targeting;
  if (input.schedule) manifest.schedule = input.schedule;

  if (trigger.kind === "delay" && !(trigger.seconds >= 0)) fail("trigger.seconds must be ≥ 0");

  const problems = checkManifestV2Structure(manifest, { percentCap: percentCapFor(input.margin) });
  if (problems.length > 0) fail(formatProblems(problems));
  return manifest;
}
