/**
 * VENDORED from packages/skills/offers/src/gates-v2.ts (spec 34).
 *
 * CANONICAL LOGIC lives in packages/skills/offers — this is a mechanical
 * copy so the scaffolded template stays self-contained (it ships into a
 * store's own repo, outside this monorepo, so it cannot `workspace:*`
 * depend on the pack). Mirrors lib/email/repo.ts's vendoring convention.
 * A change here belongs in the pack first, then copied down — see spec 32
 * §12 OQ4 (this sync is not yet scripted/CI-checked, for any pack).
 */
/**
 * gateOfferManifestV2 + validateOfferManifest (spec 34 §2.4/§7, contract
 * §1.1).
 *
 * The v2 gate scans EVERY piece of copy a shopper can read — each block's
 * text, choice questions and labels, CTA labels, consent, decline, reward
 * headline/body/pick titles, captions, the teaser label — through
 * design-loop's `checkDarkPatterns`, plus the refusals spec 34 §7 adds that
 * design-loop's list does not cover (chance mechanics; more fabricated
 * urgency; the commonest confirmshame phrasings). Decline copy is held to a
 * stricter rule still: no value framing at all.
 *
 * `validateOfferManifest` is the runtime-agnostic entry point for anything
 * that receives a manifest over the wire (the platform's surface validator):
 * v1 or v2, shape + structure + copy, one list of errors.
 */

import { checkDarkPatterns, type CaptureBundleRef } from "@avant-garde/design-loop";
import { offerManifestSchema } from "./artifacts";
import { gateOfferContent, type OfferGateResult } from "./gates";
import { OFFER_IMAGE_ORIGIN } from "./manifest";
import { checkManifestV2Structure, percentCapFor, type MarginPolicy } from "./manifest-v2";
import { offerManifestV2Schema } from "./schema-v2";
import type { OfferManifest, OfferManifestV2, VariantV2 } from "./types";

export interface CopyFinding {
  code: string;
  message: string;
}

export interface OfferV2Finding extends CopyFinding {
  path: string;
}

/** Spec 34 §7 refusals beyond design-loop 0.1's blocklist. */
const CHANCE_MECHANIC_PATTERNS: RegExp[] = [
  /\bspin[\s-]+(to[\s-]+)?win\b/i,
  /\bspin\s+the\s+wheel\b/i,
  /\bwheel\s+of\s+(fortune|prizes|savings|discounts?)\b/i,
  /\bscratch[\s-]*(card|off|to\s+win|and\s+win)\b/i,
  /\bmystery\s+(discount|gift|reward|prize)\b/i,
  /\btry\s+your\s+luck\b/i,
];

const EXTRA_URGENCY_PATTERNS: RegExp[] = [
  /\bonly\s+\d+\s+(left|remaining)\b/i,
  /\blast\s+chance\b/i,
  /\b(ends|expires)\s+(tonight|today|at\s+midnight|in\s+\d+)\b/i,
  /\bbefore\s+it'?s\s+gone\b/i,
];

const EXTRA_CONFIRMSHAME_PATTERNS: RegExp[] = [
  /\b(i'?ll|i\s+will|i'?d\s+rather|i\s+prefer\s+to)\s+pay\s+full\s+price\b/i,
  /\bi\s+(don'?t|do\s+not)\s+(want|like)\s+(to\s+)?(save|saving|savings|discounts?|free\b)/i,
  /\bi\s+hate\s+(saving|money|discounts?|deals|free)\b/i,
];

/** Decline copy must be neutral: no value framing whatsoever (contract §1.1). */
const DECLINE_VALUE_FRAMING: RegExp[] = [
  /\bfull[\s-]+price\b/i,
  /\b(don'?t|do\s+not)\s+want\s+to\s+save\b/i,
  /\bhate\b/i,
  /\bno,?\s+i\b/i,
  /\b(save|saving|savings|discount|deal|free|money|miss\s+out)\b/i,
  /\b(rather|prefer)\s+(to\s+)?pay\b/i,
];

function bundleOf(texts: string[]): CaptureBundleRef {
  return {
    location: "content://offer-proposal",
    manifest: {
      page: "-",
      themeRef: "-",
      commit: null,
      capturedAt: "-",
      versionVector: { agent: "offer-engine", skillset: "none", mcpSnapshot: "none", brandDoc: "none" },
    },
    screenshots: {},
    tokens: {},
    domSegments: [],
    observations: { texts, inputs: [], images: [], contrast: [], markers: [] },
  } as unknown as CaptureBundleRef;
}

const quote = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}…` : s);

/**
 * Dark-pattern scan of one piece of copy: design-loop's blocklist plus the
 * spec 34 §7 additions. Shared with the incumbent audit (audit.ts), which
 * runs it over the text a rival popup shows.
 */
export function scanOfferCopy(text: string): CopyFinding[] {
  const out: CopyFinding[] = checkDarkPatterns(bundleOf([text])).findings.map((f) => ({
    code: f.code,
    message: f.message,
  }));
  const codes = new Set(out.map((f) => f.code));
  const extra = (code: string, patterns: RegExp[], what: string) => {
    if (codes.has(code)) return;
    if (patterns.some((re) => re.test(text))) out.push({ code, message: `${what}: "${quote(text)}"` });
  };
  extra("dark-pattern/chance-mechanic", CHANCE_MECHANIC_PATTERNS, "Chance mechanic (spin/scratch/mystery reward)");
  extra("dark-pattern/fake-urgency", EXTRA_URGENCY_PATTERNS, "Fabricated scarcity/urgency copy");
  extra("dark-pattern/confirmshame", EXTRA_CONFIRMSHAME_PATTERNS, "Confirmshaming copy");
  return out;
}

/** Value-framing refusal for decline copy only. */
export function scanDeclineCopy(text: string): CopyFinding[] {
  return DECLINE_VALUE_FRAMING.some((re) => re.test(text))
    ? [{ code: "decline/value-framing", message: `Decline copy must be neutral, not value-framed: "${quote(text)}"` }]
    : [];
}

interface CopyItem {
  path: string;
  text: string;
  decline: boolean;
}

/** Every shopper-visible string in one variant, with its path. */
export function collectVariantCopy(key: string, v: VariantV2): CopyItem[] {
  const out: CopyItem[] = [];
  const push = (path: string, text: string | undefined, decline = false) => {
    if (text !== undefined && text.trim() !== "") out.push({ path, text, decline });
  };
  v.steps.forEach((step, i) =>
    step.blocks.forEach((b, j) => {
      const p = `variants.${key}.steps[${i}].blocks[${j}]`;
      switch (b.kind) {
        case "eyebrow":
        case "body":
        case "consent":
          push(`${p}.text`, b.text);
          break;
        case "headline":
          push(`${p}.text`, b.text);
          push(`${p}.accent`, b.accent);
          break;
        case "points":
          b.items.forEach((t, k) => push(`${p}.items[${k}]`, t));
          break;
        case "image":
          push(`${p}.caption`, b.caption);
          push(`${p}.alt`, b.alt);
          break;
        case "choice":
          push(`${p}.question`, b.question);
          b.options.forEach((o, k) => push(`${p}.options[${k}].label`, o.label));
          break;
        case "email":
          push(`${p}.cta`, b.cta);
          push(`${p}.placeholder`, b.placeholder);
          break;
        case "cta":
          push(`${p}.label`, b.label);
          break;
        case "reward":
          push(`${p}.headline`, b.headline);
          push(`${p}.body`, b.body);
          push(`${p}.link.label`, b.link?.label);
          for (const [answer, picks] of Object.entries(b.picks ?? {})) {
            picks.forEach((pk, k) => push(`${p}.picks.${answer}[${k}].title`, pk.title));
          }
          break;
        case "decline":
          push(`${p}.text`, b.text, true);
          break;
        case "progress":
          break;
      }
    }),
  );
  return out;
}

export interface OfferGateV2Result extends OfferGateResult {
  /** Structural guarantees (contract §1.1), re-checked — the manifest may
   * have been edited after compile. */
  structure: { passed: boolean; findings: OfferV2Finding[] };
  /** Every finding (copy + structure) attributed to its variant. */
  variants: Record<string, { passed: boolean; findings: OfferV2Finding[] }>;
  /** Findings on manifest-level copy/fields (teaser label, arms, cells). */
  manifestFindings: OfferV2Finding[];
}

export interface GateOfferManifestV2Options {
  /** Apply the margin cap to percent incentives. Without it only a 0–100
   * sanity bound applies (the policy is a compile input, not manifest data). */
  margin?: MarginPolicy;
}

const V2_COMPONENT_GUARANTEES = [
  "WCAG AA renderer",
  "zero layout shift",
  "one-tap dismiss from first paint, remembered",
  "44px touch targets",
];

export function gateOfferManifestV2(
  manifest: OfferManifestV2,
  opts: GateOfferManifestV2Options = {},
): OfferGateV2Result {
  const variants: OfferGateV2Result["variants"] = {};
  const copyFindings: OfferV2Finding[] = [];
  const manifestFindings: OfferV2Finding[] = [];

  for (const [key, v] of Object.entries(manifest.variants)) {
    const findings: OfferV2Finding[] = [];
    for (const item of collectVariantCopy(key, v)) {
      for (const f of scanOfferCopy(item.text)) findings.push({ ...f, path: item.path });
      if (item.decline) for (const f of scanDeclineCopy(item.text)) findings.push({ ...f, path: item.path });
    }
    copyFindings.push(...findings);
    variants[key] = { passed: findings.length === 0, findings };
  }

  if (manifest.teaser?.label) {
    for (const f of scanOfferCopy(manifest.teaser.label)) {
      const finding = { ...f, path: "teaser.label" };
      manifestFindings.push(finding);
      copyFindings.push(finding);
    }
  }

  const structural = checkManifestV2Structure(
    manifest,
    opts.margin ? { percentCap: percentCapFor(opts.margin) } : {},
  ).map((p) => ({ code: p.code, message: p.message, path: p.path, variant: p.variant }));
  for (const p of structural) {
    const slot = p.variant ? variants[p.variant] : undefined;
    const { variant: _v, ...finding } = p;
    if (slot) {
      slot.findings.push(finding);
      slot.passed = false;
    } else {
      manifestFindings.push(finding);
    }
  }

  const consentPresent = Object.values(manifest.variants).every((v) =>
    v.steps.every((s) => {
      const hasEmail = s.blocks.some((b) => b.kind === "email");
      return !hasEmail || s.blocks.some((b) => b.kind === "consent" && b.text.trim().length >= 10);
    }),
  );

  const darkPassed = copyFindings.length === 0;
  return {
    passed: darkPassed && structural.length === 0 && consentPresent,
    darkPattern: { passed: darkPassed, findings: copyFindings.map(({ code, message }) => ({ code, message })) },
    consentPresent,
    componentGuarantees: V2_COMPONENT_GUARANTEES,
    structure: {
      passed: structural.length === 0,
      findings: structural.map(({ variant: _v, ...f }) => f),
    },
    variants,
    manifestFindings,
  };
}

export type OfferManifestValidation =
  | { ok: true; version: "1"; manifest: OfferManifest; errors: [] }
  | { ok: true; version: "2"; manifest: OfferManifestV2; errors: [] }
  | { ok: false; version: "1" | "2" | null; errors: string[] };

/**
 * Accepts a v1 or v2 manifest of unknown provenance and says whether it may
 * be stored/served. v1: shape, CDN-only images, consent + dark-pattern gate
 * (exactly what the v1 path always enforced). v2: shape, every structural
 * guarantee, the full v2 gate.
 */
export function validateOfferManifest(
  input: unknown,
  opts: GateOfferManifestV2Options = {},
): OfferManifestValidation {
  if (typeof input !== "object" || input === null) {
    return { ok: false, version: null, errors: ["manifest must be an object"] };
  }
  const version = (input as { version?: unknown }).version;

  if (version === undefined) {
    const parsed = offerManifestSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, version: "1", errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
    }
    const m = parsed.data;
    const errors: string[] = [];
    for (const [k, v] of Object.entries(m.variants)) {
      if (v.content.imageSrc && !v.content.imageSrc.startsWith(OFFER_IMAGE_ORIGIN)) {
        errors.push(`variants.${k}.content.imageSrc: must be on ${OFFER_IMAGE_ORIGIN}…`);
      }
    }
    const gate = gateOfferContent(
      Object.fromEntries(
        Object.entries(m.variants).map(([k, v]) => [
          k,
          Object.fromEntries(Object.entries(v.content).filter(([, s]) => typeof s === "string")) as Record<string, string>,
        ]),
      ),
    );
    errors.push(...gate.darkPattern.findings.map((f) => `${f.code}: ${f.message}`));
    if (!gate.consentPresent) errors.push("consent: every variant needs consent text (≥ 10 characters)");
    return errors.length === 0 ? { ok: true, version: "1", manifest: m, errors: [] } : { ok: false, version: "1", errors };
  }

  if (version !== "2") return { ok: false, version: null, errors: [`unsupported manifest version ${JSON.stringify(version)}`] };

  const parsed = offerManifestV2Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, version: "2", errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const m = parsed.data as OfferManifestV2;
  const gate = gateOfferManifestV2(m, opts);
  if (gate.passed) return { ok: true, version: "2", manifest: m, errors: [] };
  const errors = [
    ...gate.structure.findings.map((f) => `${f.path}: ${f.message}`),
    ...Object.values(gate.variants).flatMap((v) =>
      v.findings.filter((f) => !f.code.startsWith("structure/")).map((f) => `${f.path}: ${f.code}: ${f.message}`),
    ),
    ...gate.manifestFindings.filter((f) => !f.code.startsWith("structure/")).map((f) => `${f.path}: ${f.code}: ${f.message}`),
  ];
  if (!gate.consentPresent && errors.length === 0) errors.push("consent: a step with email needs consent text");
  return { ok: false, version: "2", errors };
}
