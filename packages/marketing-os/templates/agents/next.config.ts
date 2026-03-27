import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@mastra/*"],

  // Allow Shopify Admin to embed our app in an iframe
  async headers() {
    if (process.env.SHOPIFY_EMBEDDED !== "true") return [];

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors https://*.myshopify.com https://admin.shopify.com;`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
