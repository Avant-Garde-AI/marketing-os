/**
 * gateOfferContent — the mechanical pre-approval gate on an offer's copy
 * (spec 14 O4, spec 32 §3/§5's "structurally incapable of the sleaze the
 * category runs on").
 *
 * Layout/a11y are guaranteed by the audited runtime renderer, not gated here
 * — the meaningful pre-approval checks on an offer are its COPY and CONSENT.
 * This runs client-side (in the agent's turn, so it can revise and retry
 * before a proposal ever reaches a human) and again, independently, at
 * activation time on the platform. Never trust the first pass alone.
 */

import { checkDarkPatterns, type CaptureBundleRef } from "@avant-garde/design-loop";

// NOTE: design-loop 0.1.0 exports two colliding `GateResult` types (the
// mechanical gates' `{passed, findings}` shape vs. the release gate's
// `{pass, bench, report, ...}` shape) — the release one shadows the name at
// the package's public surface. Both original copies this pack consolidates
// worked around it with `ReturnType<typeof checkDarkPatterns>`; do the same
// until 0.1.1 renames one of them.
type DarkPatternResult = ReturnType<typeof checkDarkPatterns>;

export interface OfferGateResult {
  passed: boolean;
  darkPattern: {
    passed: boolean;
    findings: { code: string; message: string }[];
  };
  consentPresent: boolean;
  componentGuarantees: string[];
}

const COMPONENT_GUARANTEES = [
  "WCAG AA renderer",
  "zero layout shift",
  "one-tap dismiss, remembered",
];

export function gateOfferContent(
  variantsById: Record<string, Record<string, string>>,
): OfferGateResult {
  const texts = Object.values(variantsById).flatMap((c) => Object.values(c));
  const bundle = {
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

  const darkPattern: DarkPatternResult = checkDarkPatterns(bundle);
  const consentPresent = Object.values(variantsById).every(
    (c) => (c.consent ?? "").trim().length >= 10,
  );

  return {
    passed: darkPattern.passed && consentPresent,
    darkPattern: {
      passed: darkPattern.passed,
      findings: darkPattern.findings.map((f) => ({ code: f.code, message: f.message })),
    },
    consentPresent,
    componentGuarantees: COMPONENT_GUARANTEES,
  };
}
