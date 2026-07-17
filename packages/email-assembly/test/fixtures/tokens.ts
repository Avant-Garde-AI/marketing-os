/**
 * DTCG token fixture, modeled byte-for-byte on the shape
 * @avant-garde/brand-md's `compileDesignTokens` emits for the Arthaus
 * DESIGN.md (single `global` set, `$themes` metadata, provenance under
 * `$extensions["com.marketingos"]`, aliases in DESIGN.md's own syntax).
 */

import type { DtcgTokensFile } from "../src/types";

export const arthausTokens: DtcgTokensFile = {
  $description: "Arthaus design tokens compiled from DESIGN.md",
  $extensions: {
    "com.marketingos": { source: "DESIGN.md", designMdName: "Arthaus", designMdVersion: "2.0" },
  },
  $metadata: { tokenSetOrder: ["global"] },
  $themes: [{ id: "default", name: "Default", selectedTokenSets: { global: "enabled" } }],
  global: {
    colors: {
      bronze: { $type: "color", $value: "#8a6d3b" },
      ink: { $type: "color", $value: "#1f1c17" },
      paper: { $type: "color", $value: "#faf7f2" },
      background: { $type: "color", $value: "{colors.paper}" },
      text: { $type: "color", $value: "{colors.ink}" },
      "background-dark": { $type: "color", $value: "#181511" },
      "text-dark": { $type: "color", $value: "#efe9df" },
    },
    typography: {
      heading: {
        $type: "typography",
        $value: {
          fontFamily: ["Canela", "Georgia", "serif"],
          fontSize: "32px",
          fontWeight: 600,
          lineHeight: 1.2,
        },
      },
      body: {
        $type: "typography",
        $value: {
          fontFamily: ["Untitled Sans", "Helvetica", "Arial", "sans-serif"],
          fontSize: "16px",
          fontWeight: 400,
          lineHeight: 1.5,
        },
      },
    },
    spacing: {
      gutter: { $type: "dimension", $value: "24px" },
      sm: { $type: "dimension", $value: "8px" },
      md: { $type: "dimension", $value: "16px" },
    },
    rounded: {
      button: { $type: "dimension", $value: "4px" },
    },
    components: {
      button: {
        backgroundColor: { $type: "color", $value: "{colors.bronze}" },
        textColor: { $type: "color", $value: "#ffffff" },
        rounded: { $type: "dimension", $value: "4px" },
      },
    },
  },
};

/** A sparse palette with no dark pair — exercises graceful degradation. */
export const sparseTokens: DtcgTokensFile = {
  $metadata: { tokenSetOrder: ["global"] },
  global: {
    colors: {
      primary: { $type: "color", $value: "#2b4c7e" },
    },
  },
};
