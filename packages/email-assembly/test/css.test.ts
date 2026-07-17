import { describe, expect, it } from "vitest";
import {
  approxLuminance,
  emitEmailStyles,
  resolveEmailTheme,
  toCssFontStack,
} from "../src/css";
import { arthausTokens, sparseTokens } from "./fixtures/tokens";

describe("resolveEmailTheme — token lookups", () => {
  const theme = resolveEmailTheme(arthausTokens);

  it("resolves colors through DTCG aliases ({colors.text} → {colors.ink})", () => {
    expect(theme.textColor).toBe("#1f1c17");
    expect(theme.backgroundColor).toBe("#faf7f2"); // {colors.paper}
  });

  it("prefers the component button tokens for the accent", () => {
    expect(theme.accentColor).toBe("#8a6d3b"); // components.button.backgroundColor → bronze
    expect(theme.accentTextColor).toBe("#ffffff");
    expect(theme.buttonRadiusPx).toBe(4);
  });

  it("compiles typography tokens (stacks, sizes, weights, line-height)", () => {
    expect(theme.headingFontStack).toBe("Canela, Georgia, serif");
    expect(theme.bodyFontStack).toBe("'Untitled Sans', Helvetica, Arial, sans-serif");
    expect(theme.headingFontSize).toBe(32);
    expect(theme.bodyFontSize).toBe(16);
    expect(theme.bodyLineHeight).toBe(1.5);
    expect(theme.headingWeight).toBe(600);
  });

  it("reads spacing.gutter for the block gutter", () => {
    expect(theme.gutterPx).toBe(24);
  });

  it("detects the explicit dark-safe pair (colors.*-dark)", () => {
    expect(theme.dark).toEqual({ textColor: "#efe9df", backgroundColor: "#181511" });
  });
});

describe("resolveEmailTheme — graceful degradation", () => {
  it("falls back to email-safe defaults on a sparse palette", () => {
    const theme = resolveEmailTheme(sparseTokens);
    expect(theme.textColor).toBe("#1a1a1a");
    expect(theme.backgroundColor).toBe("#ffffff");
    expect(theme.accentColor).toBe("#2b4c7e"); // colors.primary
    expect(theme.accentTextColor).toBe("#ffffff"); // dark accent → white ink by luminance
    expect(theme.bodyFontStack).toBe("Helvetica, Arial, sans-serif");
    expect(theme.headingFontStack).toBe("Georgia, 'Times New Roman', serif");
    expect(theme.dark).toBeNull();
  });

  it("works with no tokens at all", () => {
    const theme = resolveEmailTheme(undefined);
    expect(theme.bodyFontSize).toBe(16);
    expect(theme.gutterPx).toBe(24);
    expect(theme.dark).toBeNull();
  });

  it("finds a dark pair supplied as a *dark* token SET (brand-md theme sets)", () => {
    const theme = resolveEmailTheme({
      $metadata: { tokenSetOrder: ["global", "dark"] },
      global: {
        colors: {
          text: { $type: "color", $value: "#222222" },
          background: { $type: "color", $value: "#ffffff" },
        },
      },
      dark: {
        colors: {
          text: { $type: "color", $value: "#eeeeee" },
          background: { $type: "color", $value: "#111111" },
        },
      },
    });
    expect(theme.textColor).toBe("#222222"); // dark set must not pollute base lookups
    expect(theme.dark).toEqual({ textColor: "#eeeeee", backgroundColor: "#111111" });
  });
});

describe("toCssFontStack — Outlook fallback discipline", () => {
  it("appends a sans fallback when the stack lacks a generic family", () => {
    expect(toCssFontStack(["Inter"], "sans-serif")).toBe("Inter, Helvetica, Arial, sans-serif");
  });

  it("sniffs serif-looking families and appends the serif fallback", () => {
    expect(toCssFontStack(["Canela Display"], "sans-serif")).toBe(
      "'Canela Display', Georgia, 'Times New Roman', serif",
    );
  });

  it("leaves stacks that already end in a generic family untouched", () => {
    expect(toCssFontStack(["Untitled Sans", "Helvetica", "Arial", "sans-serif"], "serif")).toBe(
      "'Untitled Sans', Helvetica, Arial, sans-serif",
    );
  });
});

describe("emitEmailStyles", () => {
  it("always emits the mobile-stacking media query", () => {
    const css = emitEmailStyles(resolveEmailTheme(sparseTokens));
    expect(css).toContain("@media only screen and (max-width:480px)");
    expect(css).toContain(".eab-col{width:100% !important");
  });

  it("emits prefers-color-scheme overrides only when a dark pair exists", () => {
    const withDark = emitEmailStyles(resolveEmailTheme(arthausTokens));
    expect(withDark).toContain("@media (prefers-color-scheme: dark)");
    expect(withDark).toContain("color:#efe9df !important");

    const withoutDark = emitEmailStyles(resolveEmailTheme(sparseTokens));
    expect(withoutDark).not.toContain("prefers-color-scheme");
  });
});

describe("approxLuminance", () => {
  it("orders colors sensibly and expands shorthand hex", () => {
    expect(approxLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(approxLuminance("#000000")).toBe(0);
    expect(approxLuminance("#fff")).toBeCloseTo(1, 10);
    expect(approxLuminance("not-a-color")).toBeUndefined();
  });
});
