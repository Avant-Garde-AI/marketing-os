import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Brand Soul manifest (spec 22 D1): agents/brand/*.md are read with fs at
  // runtime; trace them into every serverless bundle or Vercel drops them.
  outputFileTracingIncludes: {
    "/**": ["./brand/**/*"],
  },
  serverExternalPackages: [
    "@mastra/*",
    // design-loop lazy-loads optional heavy adapters (playwright etc.)
    "@avant-garde/design-loop",
    "playwright",
    "playwright-core",
  ],
};

export default nextConfig;
