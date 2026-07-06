import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@mastra/*",
    // design-loop lazy-loads optional heavy adapters (playwright etc.)
    "@avant-garde/design-loop",
    "playwright",
    "playwright-core",
  ],
};

export default nextConfig;
