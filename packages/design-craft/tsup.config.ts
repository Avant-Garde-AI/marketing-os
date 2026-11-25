import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts", "adapters/playwright-capture": "src/adapters/playwright-capture.ts" },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts", "adapters/playwright-capture": "src/adapters/playwright-capture.ts" } },
  clean: true,
  external: ["playwright"],
});
