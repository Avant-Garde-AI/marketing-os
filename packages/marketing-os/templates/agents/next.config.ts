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
  async redirects() {
    return [
      // spec 32 D4/OF1: the console section renamed Surfaces -> Offers.
      // The framework keeps its name in code (lib/offers, config/surfaces.json,
      // the app-embed extension) — only the merchant-facing route moved.
      { source: "/surfaces", destination: "/offers", permanent: true },
      { source: "/surfaces/:path*", destination: "/offers/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
