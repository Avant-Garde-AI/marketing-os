import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compileDesignTokens,
  validateDtcgTokensFile,
  type DtcgGroup,
  type DtcgToken,
  type DtcgTokensFile,
} from "../src/dtcg";

const arthausDesignMd = readFileSync(
  fileURLToPath(new URL("../examples/arthaus/DESIGN.md", import.meta.url)),
  "utf8",
);

const at = (file: DtcgTokensFile, set: string, ...path: string[]): DtcgToken => {
  let node: unknown = file[set];
  for (const segment of path) node = (node as DtcgGroup)[segment];
  return node as DtcgToken;
};

describe("compileDesignTokens (Arthaus DESIGN.md fixture)", () => {
  const out = compileDesignTokens(arthausDesignMd, { compiledAt: "2026-07-15T00:00:00Z" });

  it("maps colors to DTCG color tokens with real values", () => {
    expect(at(out, "global", "colors", "warm-parchment")).toEqual({ $type: "color", $value: "#F5F2ED" });
    expect(at(out, "global", "colors", "charcoal")).toEqual({ $type: "color", $value: "#2D2D2D" });
    expect(at(out, "global", "colors", "bronze")).toEqual({ $type: "color", $value: "#B07D4F" });
    expect(at(out, "global", "colors", "background-transactional")).toEqual({ $type: "color", $value: "#FFFFFF" });
  });

  it("passes DESIGN.md aliases through as DTCG aliases, untouched", () => {
    expect(at(out, "global", "colors", "primary")).toEqual({ $type: "color", $value: "{colors.bronze}" });
    expect(at(out, "global", "colors", "background")).toEqual({ $type: "color", $value: "{colors.warm-parchment}" });
    expect(at(out, "global", "colors", "success")).toEqual({ $type: "color", $value: "{colors.sage}" });
  });

  it("maps typography styles to composite typography tokens", () => {
    const body = at(out, "global", "typography", "body");
    expect(body.$type).toBe("typography");
    expect(body.$value).toEqual({
      fontFamily: ["Inter", "Söhne", "Graphik", "system-ui", "sans-serif"],
      fontSize: "17px",
      lineHeight: 1.55,
      fontWeight: 400,
    });

    const title = at(out, "global", "typography", "artwork-title");
    expect(title.$value).toMatchObject({
      fontFamily: ["Canela", "Freight Display", "Noe Display", "Georgia", "serif"],
      fontSize: "26px",
      fontWeight: 500,
    });

    const label = at(out, "global", "typography", "label");
    expect((label.$value as Record<string, unknown>).letterSpacing).toBe("0.08em");

    const specs = at(out, "global", "typography", "specs");
    expect((specs.$value as Record<string, unknown>).fontFamily).toEqual([
      "IBM Plex Mono",
      "JetBrains Mono",
      "monospace",
    ]);
  });

  it("maps spacing and rounded to dimension tokens", () => {
    expect(at(out, "global", "spacing", "xs")).toEqual({ $type: "dimension", $value: "8px" });
    expect(at(out, "global", "spacing", "xl")).toEqual({ $type: "dimension", $value: "96px" });
    expect(at(out, "global", "rounded", "none")).toEqual({ $type: "dimension", $value: "0px" });
    expect(at(out, "global", "rounded", "subtle")).toEqual({ $type: "dimension", $value: "2px" });
  });

  it("maps component properties to typed per-property tokens", () => {
    expect(at(out, "global", "components", "button-primary", "backgroundColor")).toEqual({
      $type: "color",
      $value: "{colors.charcoal}",
    });
    expect(at(out, "global", "components", "button-primary", "height")).toEqual({
      $type: "dimension",
      $value: "52px",
    });
    expect(at(out, "global", "components", "button-primary", "rounded")).toEqual({
      $type: "dimension",
      $value: "{rounded.none}",
    });
    expect(at(out, "global", "components", "title-divider", "width")).toEqual({
      $type: "dimension",
      $value: "40px",
    });
    expect(at(out, "global", "components", "card", "padding")).toEqual({
      $type: "dimension",
      $value: "{spacing.md}",
    });
    expect(at(out, "global", "components", "badge-collector", "backgroundColor")).toEqual({
      $type: "color",
      $value: "{colors.deep-ink}",
    });
  });

  it("emits a single default set with Penpot-selectable theme metadata", () => {
    expect(out.$metadata).toEqual({ tokenSetOrder: ["global"] });
    expect(out.$themes).toEqual([
      { id: "default", name: "Default", selectedTokenSets: { global: "enabled" } },
    ]);
  });

  it("records provenance from the front matter plus caller-supplied compiledAt", () => {
    const prov = out.$extensions?.["com.marketingos"];
    expect(prov).toBeDefined();
    expect(prov?.source).toBe("DESIGN.md");
    expect(prov?.designMdName).toBe("Arthaus");
    expect(prov?.designMdVersion).toBe("alpha");
    expect(prov?.compiledAt).toBe("2026-07-15T00:00:00Z");
    // Every Arthaus front-matter field maps cleanly; no unmapped remainder.
    expect(prov?.unmapped).toBeUndefined();
    expect(out.$description).toMatch(/vision-PDP aesthetic/);
  });

  it("omits compiledAt when the caller does not supply one (never reads the clock)", () => {
    const bare = compileDesignTokens(arthausDesignMd);
    expect(bare.$extensions?.["com.marketingos"].compiledAt).toBeUndefined();
  });

  it("is deterministic for a given input", () => {
    expect(compileDesignTokens(arthausDesignMd, { compiledAt: "x" })).toEqual(
      compileDesignTokens(arthausDesignMd, { compiledAt: "x" }),
    );
  });

  it("produces a structurally valid DTCG file (validator finds nothing)", () => {
    expect(validateDtcgTokensFile(out)).toEqual([]);
  });

  it("every token in the set has $type and $value; groups never mix in token keys", () => {
    const walk = (node: DtcgGroup): void => {
      for (const [name, child] of Object.entries(node)) {
        if (name.startsWith("$") || !child || typeof child !== "object") continue;
        const c = child as Record<string, unknown>;
        if ("$value" in c || "$type" in c) {
          expect(c.$type, `token ${name} missing $type`).toBeTypeOf("string");
          expect(c.$value, `token ${name} missing $value`).toBeDefined();
          for (const key of Object.keys(c)) {
            expect(key.startsWith("$"), `token ${name} carries child ${key}`).toBe(true);
          }
        } else {
          walk(c as DtcgGroup);
        }
      }
    };
    walk(out.global as DtcgGroup);
  });
});

describe("compileDesignTokens (themes / two registers)", () => {
  const themed = `---
name: Testbrand
version: 3
colors:
  paper: "#FFFFFF"
  ink: "#111111"
spacing:
  md: 24px
themes:
  editorial:
    colors:
      background: "{colors.paper}"
  interactive:
    colors:
      background: "#FAFAFA"
---

## Overview

Two registers.
`;

  const out = compileDesignTokens(themed, { compiledAt: "2026-07-15T00:00:00Z" });

  it("compiles each theme to its own set layered over global", () => {
    expect(out.$metadata).toEqual({ tokenSetOrder: ["global", "editorial", "interactive"] });
    expect(at(out, "editorial", "colors", "background")).toEqual({ $type: "color", $value: "{colors.paper}" });
    expect(at(out, "interactive", "colors", "background")).toEqual({ $type: "color", $value: "#FAFAFA" });
    expect(out.$themes).toEqual([
      { id: "default", name: "Default", selectedTokenSets: { global: "enabled" } },
      { id: "editorial", name: "editorial", selectedTokenSets: { global: "source", editorial: "enabled" } },
      { id: "interactive", name: "interactive", selectedTokenSets: { global: "source", interactive: "enabled" } },
    ]);
  });

  it("theme aliases resolve against the global set (validator finds nothing)", () => {
    expect(validateDtcgTokensFile(out)).toEqual([]);
  });
});

describe("compileDesignTokens (unmapped front-matter fields)", () => {
  const withUnmappable = `---
name: Testbrand
version: 2
colors:
  a: "#FFFFFF"
elevation:
  low: "0 1px 2px rgba(0,0,0,.1)"
components:
  hero:
    backgroundColor: "{colors.a}"
    boxShadow: "0 1px 2px rgba(0,0,0,.1)"
---

## Overview

x
`;

  it("records fields with no clean DTCG mapping under provenance.unmapped", () => {
    const out = compileDesignTokens(withUnmappable);
    const prov = out.$extensions?.["com.marketingos"];
    expect(prov?.unmapped).toContain("elevation");
    expect(prov?.unmapped).toContain("components.hero.boxShadow");
    // The mappable sibling still compiles.
    expect(at(out, "global", "components", "hero", "backgroundColor")).toEqual({
      $type: "color",
      $value: "{colors.a}",
    });
  });
});

describe("validateDtcgTokensFile (negative cases)", () => {
  it("flags missing $type, token/group mixing, and dangling aliases", () => {
    const bad = {
      global: {
        colors: {
          "no-type": { $value: "#fff" },
          mixed: { $type: "color", $value: "#fff", child: { $type: "color", $value: "#000" } },
          dangling: { $type: "color", $value: "{colors.nope}" },
        },
      },
    } as unknown as DtcgTokensFile;
    const rules = validateDtcgTokensFile(bad).map((f) => f.rule);
    expect(rules).toContain("token-missing-type");
    expect(rules).toContain("token-has-children");
    expect(rules).toContain("dangling-alias");
  });

  it("flags unknown reserved keys in groups", () => {
    const bad = {
      global: { colors: { $value: undefined, ok: { $type: "color", $value: "#fff" } } },
    } as unknown as DtcgTokensFile;
    // colors has $value → treated as a token missing $type, with child mixing.
    const rules = validateDtcgTokensFile(bad).map((f) => f.rule);
    expect(rules).toContain("token-missing-type");
  });
});
