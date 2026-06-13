import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/contract.ts",
    "src/delegation/cli.ts",
    "src/delegation/mcp-server.ts",
  ],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  dts: false,
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
