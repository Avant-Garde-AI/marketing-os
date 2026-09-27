import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/vertex.ts", "src/cli.ts", "src/cli-v2.ts", "src/cli-recover.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
});
