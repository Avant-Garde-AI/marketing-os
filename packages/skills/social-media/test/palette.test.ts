import { describe, expect, it } from "vitest";
import { checkPostClaims } from "../src/claims";
import { checkColorClaims, chroma, colorClaimsIn, colorWordsIn, deltaE, type PaletteColor } from "../src/palette";

/**
 * Real palettes, extracted from the actual Arthaus artworks (12-colour median
 * cut over the master image). The captions below are the ones that SHIPPED —
 * this suite is the regression test for five posts that described artworks
 * that were not there.
 */
const PALETTES: Record<string, PaletteColor[]> = {
  // Shelly Bremmer, "Vent Stripe" — violet/magenta/cyan/amber arcs on white.
  ventStripe: [
    { hex: "#8356CB", share: 0.163 },
    { hex: "#E82069", share: 0.142 },
    { hex: "#30A8CA", share: 0.139 },
    { hex: "#FBB159", share: 0.131 },
    { hex: "#FFFFFF", share: 0.113 },
    { hex: "#E45948", share: 0.098 },
    { hex: "#A2C371", share: 0.094 },
  ],
  // Kaethe Butcher, "We Don't Talk About That" — black ink on cream.
  weDontTalk: [
    { hex: "#BFBAA0", share: 0.139 },
    { hex: "#F8F2D4", share: 0.123 },
    { hex: "#F8F0D2", share: 0.088 },
    { hex: "#F2ECCE", share: 0.084 },
    { hex: "#3D3C34", share: 0.074 },
  ],
  // 83 Oranges, "Art of Nature" — deep teal ground, sage foliage.
  artOfNature: [
    { hex: "#025C65", share: 0.488 },
    { hex: "#CDC8A3", share: 0.098 },
    { hex: "#94B275", share: 0.066 },
    { hex: "#156464", share: 0.065 },
    { hex: "#CB2C72", share: 0.045 },
  ],
  // Benjamin McKay, "BM12" — black and pale grey-green, heavily textured.
  bm12: [
    { hex: "#171618", share: 0.116 },
    { hex: "#7C9CA0", share: 0.115 },
    { hex: "#B3BCC1", share: 0.107 },
    { hex: "#D1DAD1", share: 0.102 },
    { hex: "#EFEDDB", share: 0.066 },
  ],
};

describe("the five captions that shipped", () => {
  it("refuses black and white on a work of violet, magenta and amber", () => {
    const problems = checkColorClaims(
      'Bold black and white stripes make a striking graphic statement in "Vent Stripe".',
      PALETTES.ventStripe!,
    );
    expect(problems.map((p) => p.word)).toContain("black");
  });

  it("refuses dusty rose and pale yellow on a black-ink drawing", () => {
    const problems = checkColorClaims(
      "Soft swaths of dusty rose, sage, and pale yellow create a gentle, abstract mood.",
      PALETTES.weDontTalk!,
    );
    expect(problems.map((p) => p.word)).toEqual(
      expect.arrayContaining(["dusty rose", "pale yellow"]),
    );
  });

  it("refuses terracotta and ochre on a deep-teal botanical", () => {
    const problems = checkColorClaims(
      "Warm terracotta and ochre shapes suggest a sun-drenched landscape.",
      PALETTES.artOfNature!,
    );
    expect(problems.map((p) => p.word)).toEqual(
      expect.arrayContaining(["warm terracotta", "ochre"]),
    );
  });

  it("refuses deep indigo on a black-and-grey-green work", () => {
    const problems = checkColorClaims(
      "A field of deep indigo is broken by a sweep of textured white.",
      PALETTES.bm12!,
    );
    expect(problems.map((p) => p.word)).toContain("deep indigo");
  });
});

describe("true descriptions are left alone", () => {
  const cases: [string, keyof typeof PALETTES][] = [
    ["A deep teal ground with sage green foliage.", "artOfNature"],
    ["Black ink linework on cream paper.", "weDontTalk"],
    ["Magenta, violet and coral arcs on white.", "ventStripe"],
    ["Black and pale green, heavily textured.", "bm12"],
  ];
  for (const [copy, key] of cases) {
    it(`accepts "${copy}"`, () => {
      expect(checkColorClaims(copy, PALETTES[key]!)).toEqual([]);
    });
  }
});

describe("modifiers change what is claimed", () => {
  it("reads 'pale green' as paler and less saturated than 'green'", () => {
    const [plain] = colorClaimsIn("green");
    const [pale] = colorClaimsIn("pale green");
    expect(chroma(pale!.hex)).toBeLessThan(chroma(plain!.hex));
    // Without this, "pale green" is checked as a saturated mid-green and
    // refused on a work that is genuinely a pale grey-green.
    expect(checkColorClaims("pale green", PALETTES.bm12!)).toEqual([]);
    expect(checkColorClaims("green", PALETTES.bm12!)).not.toEqual([]);
  });

  it("prefers the longer name — 'dusty rose' is not checked as 'rose'", () => {
    expect(colorWordsIn("a dusty rose ground")).toEqual(["dusty rose"]);
  });
});

describe("the guard's own limits", () => {
  it("says nothing about subject or composition", () => {
    // The fifth real fabrication: a graphite PORTRAIT sold as "tight geometry".
    // Its colour words are true, so this check passes it. Documented, not fixed.
    const beehive: PaletteColor[] = [
      { hex: "#595345", share: 0.108 },
      { hex: "#1F1C15", share: 0.103 },
      { hex: "#464136", share: 0.091 },
    ];
    expect(checkColorClaims("Warm, earthy tones and tight geometry.", beehive)).toEqual([]);
  });

  it("checks nothing when no palette was supplied, and does not pretend otherwise", () => {
    expect(checkColorClaims("vivid magenta everywhere", [])).toEqual([]);
    const report = checkPostClaims({ copy: "vivid magenta everywhere" }, {});
    expect(report.checked).not.toContain("unsupported-color-claim");
  });

  it("ignores colours occupying a trivial share of the work", () => {
    const mostlyTeal: PaletteColor[] = [
      { hex: "#025C65", share: 0.97 },
      { hex: "#CB2C72", share: 0.005 },
    ];
    expect(checkColorClaims("a magenta field", mostlyTeal).length).toBe(1);
  });
});

describe("checkPostClaims integration", () => {
  it("blocks the write, alongside the attribution checks", () => {
    const report = checkPostClaims(
      { copy: "Warm terracotta and ochre shapes.", targetLink: "/products/21343-art-of-nature" },
      { palette: PALETTES.artOfNature },
    );
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.id === "unsupported-color-claim" && p.severity === "blocking")).toBe(true);
    expect(report.checked).toContain("unsupported-color-claim");
  });
});

describe("deltaE", () => {
  it("is zero for a colour against itself and large across hues", () => {
    expect(deltaE("#025C65", "#025C65")).toBe(0);
    expect(deltaE("#025C65", "#CC7722")).toBeGreaterThan(40);
  });
});
