import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/contract.ts",
    "src/delegation/cli.ts",
    "src/delegation/mcp-server.ts",
    "src/bench/cli.ts",
    "src/release/cli.ts",
  ],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  // Ship type declarations for consumers (the scaffolded console imports types).
  dts: { entry: { index: "src/index.ts", contract: "src/contract.ts" } },
  splitting: false,
  sourcemap: true,
  // Optional adapters lazy-load these; keep them as runtime imports, never bundled.
  external: [
    "playwright",
    "pngjs",
    "pixelmatch",
    "@modelcontextprotocol/sdk",
    /^@modelcontextprotocol\/sdk\//,
  ],
  // CLI + MCP server entries carry their own shebang in source.
});
