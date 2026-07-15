import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  dts: { entry: { index: "src/index.ts" } },
  splitting: false,
  sourcemap: true,
  // The Penpot builder is a large compiled bundle; keep it a runtime import.
  external: ["@penpot/library"],
});
