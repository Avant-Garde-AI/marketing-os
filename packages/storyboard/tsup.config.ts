import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  dts: { entry: { index: "src/index.ts" } },
  splitting: false,
  sourcemap: true,
  // Deliberately NO renderer externals. This package has no renderer
  // dependency and must not acquire one — that is what makes a canvas/Figma
  // exporter a swap rather than a rewrite (spec 33 §5). An `external` entry
  // for a renderer here would be the first quiet step toward coupling.
});
