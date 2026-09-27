import { describe, expect, it } from "vitest";
import { gateOfferContent } from "../src/gates";

const CLEAN = {
  v1: {
    headline: "Join the collector's list",
    body: "Early access to new drops, first look at the maker's story.",
    cta: "Join",
    success: "You're on the list.",
    consent: "By joining you agree to receive marketing emails from us.",
  },
};

describe("gateOfferContent", () => {
  it("passes clean copy with consent text present", () => {
    const g = gateOfferContent(CLEAN);
    expect(g.passed).toBe(true);
    expect(g.darkPattern.passed).toBe(true);
    expect(g.darkPattern.findings).toHaveLength(0);
    expect(g.consentPresent).toBe(true);
  });

  it("fails on fake-urgency copy (countdown)", () => {
    const g = gateOfferContent({
      v1: { ...CLEAN.v1!, body: "Hurry, offer ends soon — countdown is on." },
    });
    expect(g.passed).toBe(false);
    expect(g.darkPattern.passed).toBe(false);
    expect(g.darkPattern.findings.some((f) => f.code.includes("dark-pattern"))).toBe(true);
  });

  it("fails on confirmshame dismiss copy", () => {
    const g = gateOfferContent({
      v1: { ...CLEAN.v1!, cta: "No thanks, I hate saving money" },
    });
    expect(g.passed).toBe(false);
    expect(g.darkPattern.passed).toBe(false);
  });

  it("fails when consent text is missing or too short", () => {
    const g = gateOfferContent({ v1: { ...CLEAN.v1!, consent: "ok" } });
    expect(g.passed).toBe(false);
    expect(g.consentPresent).toBe(false);
    expect(g.darkPattern.passed).toBe(true); // independent of the dark-pattern check
  });

  it("checks every variant, not just the first", () => {
    const g = gateOfferContent({
      v1: CLEAN.v1!,
      v2: { ...CLEAN.v1!, body: "Only 3 left in stock!" },
    });
    expect(g.passed).toBe(false);
  });

  it("always reports the component guarantees", () => {
    const g = gateOfferContent(CLEAN);
    expect(g.componentGuarantees).toEqual([
      "WCAG AA renderer",
      "zero layout shift",
      "one-tap dismiss, remembered",
    ]);
  });
});
