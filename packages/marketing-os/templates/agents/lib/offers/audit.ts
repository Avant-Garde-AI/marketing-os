/**
 * VENDORED from packages/skills/offers/src/audit.ts (spec 34).
 *
 * CANONICAL LOGIC lives in packages/skills/offers — this is a mechanical
 * copy so the scaffolded template stays self-contained (it ships into a
 * store's own repo, outside this monorepo, so it cannot `workspace:*`
 * depend on the pack). Mirrors lib/email/repo.ts's vendoring convention.
 * A change here belongs in the pack first, then copied down — see spec 32
 * §12 OQ4 (this sync is not yet scripted/CI-checked, for any pack).
 */
/**
 * The incumbent audit's published rubric (spec 34 §4.1, contract §4/§7).
 *
 * The render worker (marketing-os-app's `offer_audit` job) visits the store
 * as a fresh first-time visitor at desktop and mobile widths, fingerprints
 * the popup vendor with `VENDOR_FINGERPRINTS`, measures `AuditFacts`, and
 * hands them here. Grading is pure and lives in the MIT pack so the rubric
 * is inspectable by the merchant being graded — every line cites the
 * measured number it was decided on.
 */

import { scanDeclineCopy, scanOfferCopy } from "./gates-v2";
import type { AuditFacts, IncumbentVendor, OfferAuditGrade, OfferAuditReport, RubricLine } from "./types";

export interface VendorFingerprint {
  label: string;
  /** Substrings of a `<script src>`. */
  scriptSrc: string[];
  /** RegExp sources tested against each script src (strings, so the table
   * can be passed into a browser context unchanged). */
  scriptSrcPatterns?: string[];
  /** Window globals whose presence identifies the vendor. */
  globals?: string[];
  /** DOM selectors that identify the vendor's popup. */
  selectors?: string[];
}

export const VENDOR_FINGERPRINTS: Record<Exclude<IncumbentVendor, "unknown">, VendorFingerprint> = {
  klaviyo: {
    label: "Klaviyo",
    scriptSrc: ["static.klaviyo.com/onsite"],
    globals: ["_klOnsite"],
    selectors: ['[aria-label="POPUP Form"]', '[data-testid="POPUP"]', '[data-testid="FLYOUT"]'],
  },
  privy: { label: "Privy", scriptSrc: ["widget.privy.com"] },
  justuno: { label: "Justuno", scriptSrc: ["justuno.com"] },
  optimonk: { label: "OptiMonk", scriptSrc: ["optimonk.com"] },
  wisepops: { label: "Wisepops", scriptSrc: ["wisepops."] },
  sleeknote: { label: "Sleeknote", scriptSrc: ["sleeknote.com"] },
  omnisend: { label: "Omnisend", scriptSrc: ["omnisnippet", "omnisend.com"] },
  "shopify-forms": { label: "Shopify Forms", scriptSrc: ["forms.shopifyapps.com", "shopify-forms"] },
  alia: { label: "Alia", scriptSrc: [], scriptSrcPatterns: ["[./]alia[.-]"], selectors: ['[id^="alia-"]'] },
};

/** How `unknown` is decided (contract §4) — a rule for the worker, not a
 * fingerprint: a fixed-position element containing an email input that
 * appears within 20 s and is not ours. */
export const UNKNOWN_VENDOR_RULE = {
  withinMs: 20_000,
  ownSurfaceSelector: "[data-mos-surface]",
  description: "a fixed-position element containing an email input, appearing within 20 s, that is not a Marketing OS surface",
} as const;

export const VENDOR_LABELS: Record<IncumbentVendor, string> = {
  ...Object.fromEntries(Object.entries(VENDOR_FINGERPRINTS).map(([k, v]) => [k, v.label])),
  unknown: "current",
} as Record<IncumbentVendor, string>;

/**
 * Match observed signals against the fingerprints, in table order. Returns
 * null when nothing matches — the caller decides `unknown` by
 * `UNKNOWN_VENDOR_RULE`, which needs the live DOM.
 */
export function matchVendorFingerprint(signals: {
  scriptSrcs: string[];
  globals?: string[];
  matchedSelectors?: string[];
}): Exclude<IncumbentVendor, "unknown"> | null {
  const globals = new Set(signals.globals ?? []);
  const selectors = new Set(signals.matchedSelectors ?? []);
  for (const [vendor, fp] of Object.entries(VENDOR_FINGERPRINTS) as [Exclude<IncumbentVendor, "unknown">, VendorFingerprint][]) {
    const patterns = (fp.scriptSrcPatterns ?? []).map((p) => new RegExp(p));
    const bySrc = signals.scriptSrcs.some(
      (src) => fp.scriptSrc.some((s) => src.includes(s)) || patterns.some((re) => re.test(src)),
    );
    if (bySrc) return vendor;
    if ((fp.globals ?? []).some((g) => globals.has(g))) return vendor;
    if ((fp.selectors ?? []).some((s) => selectors.has(s))) return vendor;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The rubric
// ---------------------------------------------------------------------------

/** Line weights for the 0–100 score. Informational lines weigh 0: they are
 * reported, never scored. Per-viewport lines split their weight across the
 * viewports the popup appeared on. */
export const RUBRIC_WEIGHTS: Record<string, number> = {
  "shows-too-early": 10,
  "mobile-interstitial-on-arrival": 15,
  "close-target": 10,
  "cta-target": 10,
  "cta-contrast": 10,
  "consent-microcopy": 10,
  image: 0,
  "step-count": 7,
  "incentive-type": 0,
  "dark-patterns": 20,
  "close-visible-at-first-paint": 10,
  "vendor-script-weight": 5,
};

export const MIN_TARGET_PX = 44;
export const MIN_CONTRAST = 4.5;
export const EARLY_SHOW_MS = 5_000;
export const VERY_EARLY_SHOW_MS = 2_000;
export const INTERSTITIAL_COVER = 0.5;
export const INTERSTITIAL_WINDOW_MS = 8_000;
export const SCRIPT_WEIGHT_WARN_KB = 100;
/** A popup that uses dark patterns cannot grade above D, however polished. */
export const DARK_PATTERN_SCORE_CAP = 69;

const DISCOUNT_RE = /(\d+\s*%|%\s*off|\$\s*\d+\s*off|£\s*\d+\s*off|€\s*\d+\s*off|\bpercent\b|\bdiscount\b|\boff your (first )?order\b)/i;

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const px = (t: { w: number; h: number }) => `${Math.round(t.w)}×${Math.round(t.h)} px`;

export function gradeFromScore(score: number): Exclude<OfferAuditGrade, "none"> {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function perViewportLines(f: AuditFacts): RubricLine[] {
  const vp = f.viewport;
  const lines: RubricLine[] = [];

  const t = f.timeToShowMs;
  lines.push({
    id: "shows-too-early",
    label: "Waits before interrupting",
    viewport: vp,
    ...(t === null
      ? { verdict: "n/a", detail: "Time to show was not measured." }
      : t < VERY_EARLY_SHOW_MS
        ? { verdict: "fail", detail: `Appeared ${secs(t)} after arrival — before a visitor can see what the store sells.` }
        : t < EARLY_SHOW_MS
          ? { verdict: "warn", detail: `Appeared ${secs(t)} after arrival; under ${secs(EARLY_SHOW_MS)} interrupts before interest forms.` }
          : { verdict: "pass", detail: `Appeared ${secs(t)} after arrival.` }),
  });

  if (vp === "mobile") {
    const c = f.coversPct;
    lines.push({
      id: "mobile-interstitial-on-arrival",
      label: "No intrusive interstitial on mobile arrival",
      viewport: "mobile",
      ...(c === null || t === null
        ? { verdict: "n/a", detail: "Coverage or timing was not measured." }
        : c > INTERSTITIAL_COVER && t < INTERSTITIAL_WINDOW_MS
          ? {
              verdict: "fail",
              detail:
                `Covers ${pct(c)} of the phone screen ${secs(t)} after arrival. Google treats an interstitial ` +
                "like this as a page-experience negative for visitors arriving from search.",
            }
          : { verdict: "pass", detail: `Covers ${pct(c)} of the screen, ${secs(t)} after arrival.` }),
    });
  }

  lines.push({
    id: "close-target",
    label: `Close button at least ${MIN_TARGET_PX}×${MIN_TARGET_PX} px`,
    viewport: vp,
    ...(f.closeTarget === null
      ? { verdict: "warn", detail: "No close control could be measured." }
      : Math.min(f.closeTarget.w, f.closeTarget.h) >= MIN_TARGET_PX
        ? { verdict: "pass", detail: `Close target is ${px(f.closeTarget)}.` }
        : { verdict: "fail", detail: `Close target is ${px(f.closeTarget)} — below ${MIN_TARGET_PX} px, hard to hit on a phone.` }),
  });

  lines.push({
    id: "cta-target",
    label: `Signup button at least ${MIN_TARGET_PX} px tall`,
    viewport: vp,
    ...(f.ctaTarget === null
      ? { verdict: "n/a", detail: "No signup button was measured." }
      : Math.min(f.ctaTarget.w, f.ctaTarget.h) >= MIN_TARGET_PX
        ? { verdict: "pass", detail: `Signup button is ${px(f.ctaTarget)}.` }
        : { verdict: "fail", detail: `Signup button is ${px(f.ctaTarget)} — below ${MIN_TARGET_PX} px.` }),
  });

  lines.push({
    id: "cta-contrast",
    label: `Signup button contrast at least ${MIN_CONTRAST}:1`,
    viewport: vp,
    ...(f.ctaContrast === null
      ? { verdict: "n/a", detail: "Button contrast was not measured." }
      : f.ctaContrast >= MIN_CONTRAST
        ? { verdict: "pass", detail: `Button text contrast is ${f.ctaContrast.toFixed(1)}:1.` }
        : f.ctaContrast >= 3
          ? { verdict: "warn", detail: `Button text contrast is ${f.ctaContrast.toFixed(1)}:1 — passes only for large text.` }
          : { verdict: "fail", detail: `Button text contrast is ${f.ctaContrast.toFixed(1)}:1 — below WCAG AA (${MIN_CONTRAST}:1).` }),
  });

  lines.push({
    id: "close-visible-at-first-paint",
    label: "Close button visible immediately",
    viewport: vp,
    ...(f.closeVisibleAtFirstPaint === null
      ? { verdict: "n/a", detail: "Not measured." }
      : f.closeVisibleAtFirstPaint
        ? { verdict: "pass", detail: "The close button was visible from the popup's first paint." }
        : { verdict: "fail", detail: "The close button appeared after the popup — a delayed close forces visitors to read before they may leave." }),
  });

  return lines;
}

function contentLines(shown: AuditFacts[]): RubricLine[] {
  const lines: RubricLine[] = [];
  const any = (p: (f: AuditFacts) => boolean) => shown.some(p);

  lines.push({
    id: "consent-microcopy",
    label: "Tells visitors what they are signing up for",
    viewport: "both",
    ...(any((f) => f.hasConsentText)
      ? { verdict: "pass", detail: "Consent or privacy microcopy is shown near the email field." }
      : { verdict: "fail", detail: "No consent or privacy microcopy near the email field." }),
  });

  const desktop = shown.find((f) => f.viewport === "desktop");
  lines.push({
    id: "image",
    label: "Uses product or brand imagery",
    viewport: "desktop",
    ...(desktop === undefined
      ? { verdict: "n/a", detail: "Did not appear on desktop." }
      : desktop.hasImage
        ? { verdict: "pass", detail: "Shows an image on desktop." }
        : { verdict: "warn", detail: "Text only on desktop — informational, not scored." }),
  });

  const steps = shown.map((f) => f.stepCount).filter((n): n is number => n !== null);
  const maxSteps = steps.length ? Math.max(...steps) : null;
  lines.push({
    id: "step-count",
    label: "Learns something about the visitor",
    viewport: "both",
    ...(maxSteps === null
      ? { verdict: "n/a", detail: "Step count was not measured." }
      : maxSteps <= 1
        ? { verdict: "warn", detail: "One step, email only — no zero-party data about what the visitor wants." }
        : { verdict: "pass", detail: `${maxSteps} steps.` }),
  });

  const incentive = shown.map((f) => f.incentiveText).find((t): t is string => !!t && t.trim() !== "");
  lines.push({
    id: "incentive-type",
    label: "Incentive",
    viewport: "both",
    ...(incentive === undefined
      ? { verdict: "n/a", detail: "No incentive text found." }
      : DISCOUNT_RE.test(incentive)
        ? { verdict: "warn", detail: `Leads with a discount ("${incentive.trim()}") — informational: it trains visitors to wait for codes and costs margin on every capture.` }
        : { verdict: "pass", detail: `Incentive: "${incentive.trim()}".` }),
  });

  const texts = [...new Set(shown.map((f) => f.visibleText).filter((t) => t.trim() !== ""))];
  const findings = texts.flatMap((t) => [...scanOfferCopy(t), ...declineFindings(t)]);
  const unique = [...new Map(findings.map((f) => [f.message, f])).values()];
  lines.push({
    id: "dark-patterns",
    label: "No dark patterns",
    viewport: "both",
    ...(texts.length === 0
      ? { verdict: "n/a", detail: "No visible text was captured." }
      : unique.length === 0
        ? { verdict: "pass", detail: "No confirmshaming, fake urgency, or chance mechanics found." }
        : { verdict: "fail", detail: `${unique.map((f) => f.message).join("; ")}. Dark patterns cap the grade at D.` }),
  });

  const kb = shown.map((f) => f.vendorScriptKb).filter((n): n is number => n !== null);
  const maxKb = kb.length ? Math.max(...kb) : null;
  lines.push({
    id: "vendor-script-weight",
    label: `Adds under ${SCRIPT_WEIGHT_WARN_KB} KB of script`,
    viewport: "both",
    ...(maxKb === null
      ? { verdict: "n/a", detail: "Script weight was not measured." }
      : maxKb > SCRIPT_WEIGHT_WARN_KB
        ? { verdict: "warn", detail: `The popup vendor loads ${Math.round(maxKb)} KB of script on every page view.` }
        : { verdict: "pass", detail: `The popup vendor loads ${Math.round(maxKb)} KB of script.` }),
  });

  return lines;
}

/** Confirmshame hides in the decline link of a rival popup; the visible
 * text is one blob, so only the unambiguous decline phrasings are applied
 * (not the full neutral-decline rule, which would flag "save 10%" copy). */
function declineFindings(text: string) {
  const declines = text.match(/\bno,?\s+thanks?[^.!?\n]*/gi) ?? [];
  return declines.flatMap((d) => (/\b(full[\s-]+price|hate|don'?t\s+want\s+to\s+save)\b/i.test(d) ? scanDeclineCopy(d) : []));
}

function scoreLines(lines: RubricLine[]): number {
  const perId = new Map<string, RubricLine[]>();
  for (const l of lines) perId.set(l.id, [...(perId.get(l.id) ?? []), l]);
  let earned = 0;
  let possible = 0;
  for (const [id, group] of perId) {
    const weight = RUBRIC_WEIGHTS[id] ?? 0;
    const scored = group.filter((l) => l.verdict !== "n/a");
    if (weight === 0 || scored.length === 0) continue;
    const each = weight / scored.length;
    for (const l of scored) {
      possible += each;
      earned += l.verdict === "pass" ? each : l.verdict === "warn" ? each / 2 : 0;
    }
  }
  return possible === 0 ? 0 : Math.round((earned / possible) * 100);
}

export const NO_OFFER_SUMMARY = "No welcome offer detected — every visitor leaves without a way to hear from you.";

export function gradeOfferAudit(facts: AuditFacts[], opts: { now?: Date } = {}): OfferAuditReport {
  const createdAt = (opts.now ?? new Date()).toISOString();
  const shown = facts.filter((f) => f.appeared);

  if (shown.length === 0) {
    return {
      vendor: null,
      grade: "none",
      score: 0,
      lines: [
        {
          id: "popup-present",
          label: "Has a welcome offer",
          verdict: "fail",
          detail: `No email-capture popup appeared within ${UNKNOWN_VENDOR_RULE.withinMs / 1000} s on ${
            facts.length ? [...new Set(facts.map((f) => f.viewport))].join(" or ") : "any viewport"
          }.`,
          viewport: "both",
        },
      ],
      facts,
      summary: NO_OFFER_SUMMARY,
      createdAt,
    };
  }

  const vendor = shown.map((f) => f.vendor).find((v): v is IncumbentVendor => v !== null) ?? "unknown";
  const order = { desktop: 0, mobile: 1 } as const;
  const lines = [
    ...[...shown].sort((a, b) => order[a.viewport] - order[b.viewport]).flatMap(perViewportLines),
    ...contentLines(shown),
  ];

  let score = scoreLines(lines);
  if (lines.some((l) => l.id === "dark-patterns" && l.verdict === "fail")) score = Math.min(score, DARK_PATTERN_SCORE_CAP);
  const grade = gradeFromScore(score);

  const worst = [
    ...lines.filter((l) => l.verdict === "fail"),
    ...lines.filter((l) => l.verdict === "warn" && (RUBRIC_WEIGHTS[l.id] ?? 0) > 0),
  ];
  const issues = [...new Set(worst.map((l) => l.label.toLowerCase()))].slice(0, 3);
  const name = vendor === "unknown" ? "Your current popup" : `Your ${VENDOR_LABELS[vendor]} popup`;
  const missed = [...new Set(facts.filter((f) => !f.appeared).map((f) => f.viewport))];
  const summary =
    `${name} grades ${grade} (${score}/100).` +
    (issues.length ? ` Falls short on: ${issues.join("; ")}.` : " It clears every scored line.") +
    (missed.length ? ` It did not appear on ${missed.join(" or ")}.` : "");

  return { vendor, grade, score, lines, facts, summary, createdAt };
}
