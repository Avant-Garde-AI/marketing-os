import { describe, expect, it } from "vitest";
import {
  DARK_PATTERN_SCORE_CAP,
  NO_OFFER_SUMMARY,
  VENDOR_FINGERPRINTS,
  gradeFromScore,
  gradeOfferAudit,
  matchVendorFingerprint,
} from "../src/audit";
import type { AuditFacts, RubricLine } from "../src/types";

const NOW = new Date("2026-09-28T12:00:00Z");

function facts(viewport: "mobile" | "desktop", over: Partial<AuditFacts> = {}): AuditFacts {
  return {
    viewport,
    vendor: "klaviyo",
    appeared: true,
    timeToShowMs: 9000,
    coversPct: viewport === "mobile" ? 0.3 : 0.25,
    closeTarget: { w: 44, h: 44 },
    ctaTarget: { w: 280, h: 48 },
    ctaContrast: 7.1,
    hasImage: true,
    hasConsentText: true,
    stepCount: 2,
    incentiveText: "Early access to new editions",
    visibleText: "Join the collector's list. Early access to new editions. No thanks",
    closeVisibleAtFirstPaint: true,
    vendorScriptKb: 60,
    renderId: `r_${viewport}`,
    ...over,
  };
}

const line = (lines: RubricLine[], id: string, viewport?: RubricLine["viewport"]) =>
  lines.find((l) => l.id === id && (viewport === undefined || l.viewport === viewport));

describe("VENDOR_FINGERPRINTS / matchVendorFingerprint", () => {
  it("lists every named vendor from the contract", () => {
    expect(Object.keys(VENDOR_FINGERPRINTS).sort()).toEqual(
      ["alia", "justuno", "klaviyo", "omnisend", "optimonk", "privy", "shopify-forms", "sleeknote", "wisepops"].sort(),
    );
  });

  it.each([
    [["https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=X"], "klaviyo"],
    [["https://widget.privy.com/assets/widget.js"], "privy"],
    [["https://cdn.justuno.com/vck.js"], "justuno"],
    [["https://onsite.optimonk.com/script.js"], "optimonk"],
    [["https://loader.wisepops.com/get-loader.js"], "wisepops"],
    [["https://sleeknotecustomerscripts.sleeknote.com/1.js"], "sleeknote"],
    [["https://omnisnippet1.com/inshop/launcher-v2.js"], "omnisend"],
    [["https://forms.shopifyapps.com/assets/loader.js"], "shopify-forms"],
    [["https://cdn.alia-cloudflare.com/alia.js"], "alia"],
    [["https://cdn.shopify.com/extensions/x/assets/alia.bundle.js"], "alia"],
  ] as const)("matches %s → %s", (srcs, vendor) => {
    expect(matchVendorFingerprint({ scriptSrcs: [...srcs] })).toBe(vendor);
  });

  it("matches klaviyo by global or DOM, alia by DOM id, and returns null otherwise", () => {
    expect(matchVendorFingerprint({ scriptSrcs: [], globals: ["_klOnsite"] })).toBe("klaviyo");
    expect(matchVendorFingerprint({ scriptSrcs: [], matchedSelectors: ['[data-testid="FLYOUT"]'] })).toBe("klaviyo");
    expect(matchVendorFingerprint({ scriptSrcs: [], matchedSelectors: ['[id^="alia-"]'] })).toBe("alia");
    expect(matchVendorFingerprint({ scriptSrcs: ["https://cdn.shopify.com/s/files/theme.js", "https://example.com/italian.js"] })).toBeNull();
  });
});

describe("gradeOfferAudit", () => {
  it("grades a clean popup A, citing measured numbers", () => {
    const r = gradeOfferAudit([facts("desktop"), facts("mobile")], { now: NOW });
    expect(r.grade).toBe("A");
    expect(r.score).toBe(100);
    expect(r.vendor).toBe("klaviyo");
    expect(r.createdAt).toBe(NOW.toISOString());
    expect(r.facts).toHaveLength(2);
    expect(line(r.lines, "shows-too-early", "mobile")!.detail).toMatch(/9\.0 s/);
    expect(line(r.lines, "cta-contrast", "desktop")!.detail).toMatch(/7\.1:1/);
    expect(line(r.lines, "close-target", "mobile")!.detail).toMatch(/44×44 px/);
    expect(r.summary).toMatch(/^Your Klaviyo popup grades A \(100\/100\)/);
  });

  it("flags showing too early: < 2 s fail, < 5 s warn", () => {
    const r = gradeOfferAudit([facts("desktop", { timeToShowMs: 1200 }), facts("mobile", { timeToShowMs: 4000 })]);
    expect(line(r.lines, "shows-too-early", "desktop")).toMatchObject({ verdict: "fail" });
    expect(line(r.lines, "shows-too-early", "desktop")!.detail).toMatch(/1\.2 s/);
    expect(line(r.lines, "shows-too-early", "mobile")).toMatchObject({ verdict: "warn" });
  });

  it("fails a mobile interstitial on arrival (covers > 50% within 8 s)", () => {
    const r = gradeOfferAudit([facts("mobile", { coversPct: 0.92, timeToShowMs: 3000 })]);
    const l = line(r.lines, "mobile-interstitial-on-arrival")!;
    expect(l.verdict).toBe("fail");
    expect(l.detail).toMatch(/92%.*3\.0 s/);
    const late = gradeOfferAudit([facts("mobile", { coversPct: 0.92, timeToShowMs: 12000 })]);
    expect(line(late.lines, "mobile-interstitial-on-arrival")!.verdict).toBe("pass");
    const desktop = gradeOfferAudit([facts("desktop", { coversPct: 0.92, timeToShowMs: 1000 })]);
    expect(line(desktop.lines, "mobile-interstitial-on-arrival")).toBeUndefined();
  });

  it("checks close and CTA targets at 44 px and CTA contrast at 4.5", () => {
    const r = gradeOfferAudit([
      facts("mobile", { closeTarget: { w: 24, h: 24 }, ctaTarget: { w: 200, h: 36 }, ctaContrast: 3.2 }),
      facts("desktop", { ctaContrast: 2.1, closeTarget: null }),
    ]);
    expect(line(r.lines, "close-target", "mobile")).toMatchObject({ verdict: "fail" });
    expect(line(r.lines, "close-target", "mobile")!.detail).toMatch(/24×24 px/);
    expect(line(r.lines, "close-target", "desktop")).toMatchObject({ verdict: "warn" });
    expect(line(r.lines, "cta-target", "mobile")).toMatchObject({ verdict: "fail" });
    expect(line(r.lines, "cta-contrast", "mobile")).toMatchObject({ verdict: "warn" });
    expect(line(r.lines, "cta-contrast", "desktop")).toMatchObject({ verdict: "fail" });
  });

  it("reports consent, image (informational), step count and discount-first incentive", () => {
    const r = gradeOfferAudit([
      facts("desktop", { hasConsentText: false, hasImage: false, stepCount: 1, incentiveText: "Get 15% off your first order" }),
    ]);
    expect(line(r.lines, "consent-microcopy")).toMatchObject({ verdict: "fail" });
    expect(line(r.lines, "image")).toMatchObject({ verdict: "warn", viewport: "desktop" });
    expect(line(r.lines, "step-count")!.detail).toMatch(/no zero-party data/);
    expect(line(r.lines, "incentive-type")).toMatchObject({ verdict: "warn" });
    expect(line(r.lines, "incentive-type")!.detail).toMatch(/15% off/);
  });

  it("informational lines do not move the score", () => {
    const withImage = gradeOfferAudit([facts("desktop")]);
    const without = gradeOfferAudit([facts("desktop", { hasImage: false, incentiveText: "10% off" })]);
    expect(without.score).toBe(withImage.score);
  });

  it("fails dark patterns with findings and caps the grade at D", () => {
    const r = gradeOfferAudit([
      facts("desktop", { visibleText: "Unlock 10% off. Spin to win! No thanks, I'll pay full price" }),
      facts("mobile", { visibleText: "Unlock 10% off. Spin to win! No thanks, I'll pay full price" }),
    ]);
    const l = line(r.lines, "dark-patterns")!;
    expect(l.verdict).toBe("fail");
    expect(l.detail).toMatch(/Chance mechanic/);
    expect(l.detail).toMatch(/Confirmshaming/);
    expect(r.score).toBeLessThanOrEqual(DARK_PATTERN_SCORE_CAP);
    expect(r.grade).toBe("D");
  });

  it("does not flag ordinary discount copy as a dark pattern", () => {
    const r = gradeOfferAudit([facts("desktop", { visibleText: "Save 10% on your first order. No thanks" })]);
    expect(line(r.lines, "dark-patterns")!.verdict).toBe("pass");
  });

  it("fails a delayed close and warns on heavy vendor script", () => {
    const r = gradeOfferAudit([facts("desktop", { closeVisibleAtFirstPaint: false, vendorScriptKb: 240 })]);
    expect(line(r.lines, "close-visible-at-first-paint")).toMatchObject({ verdict: "fail" });
    expect(line(r.lines, "vendor-script-weight")).toMatchObject({ verdict: "warn" });
    expect(line(r.lines, "vendor-script-weight")!.detail).toMatch(/240 KB/);
  });

  it("grades a poor popup and names what it falls short on", () => {
    const r = gradeOfferAudit([
      facts("mobile", {
        vendor: "privy",
        timeToShowMs: 800,
        coversPct: 0.95,
        closeTarget: { w: 20, h: 20 },
        ctaContrast: 2.5,
        hasConsentText: false,
        closeVisibleAtFirstPaint: false,
      }),
    ]);
    expect(r.vendor).toBe("privy");
    expect(r.grade).toBe("F");
    expect(r.summary).toMatch(/^Your Privy popup grades F/);
    expect(r.summary).toMatch(/Falls short on:/);
  });

  it("says so honestly when no popup is found", () => {
    const r = gradeOfferAudit(
      [facts("desktop", { vendor: null, appeared: false }), facts("mobile", { vendor: null, appeared: false })],
      { now: NOW },
    );
    expect(r).toMatchObject({ vendor: null, grade: "none", score: 0, summary: NO_OFFER_SUMMARY });
    expect(r.summary).toBe("No welcome offer detected — every visitor leaves without a way to hear from you.");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.detail).toMatch(/desktop or mobile/);
    expect(gradeOfferAudit([]).grade).toBe("none");
  });

  it("uses 'unknown' for an unfingerprinted popup and notes a viewport it skipped", () => {
    const r = gradeOfferAudit([facts("desktop", { vendor: "unknown" }), facts("mobile", { vendor: null, appeared: false })]);
    expect(r.vendor).toBe("unknown");
    expect(r.summary).toMatch(/^Your current popup/);
    expect(r.summary).toMatch(/did not appear on mobile/);
  });

  it("maps scores to grades", () => {
    expect([95, 90, 89, 80, 79, 70, 69, 60, 59, 0].map(gradeFromScore)).toEqual(["A", "A", "B", "B", "C", "C", "D", "D", "F", "F"]);
  });
});
