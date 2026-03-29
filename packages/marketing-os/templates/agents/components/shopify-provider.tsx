"use client";

/**
 * ShopifyProvider — wraps the app with Shopify App Bridge when embedded.
 *
 * When NEXT_PUBLIC_SHOPIFY_EMBEDDED=true AND a shop param is present,
 * this initializes App Bridge so the app renders correctly inside
 * Shopify Admin. Otherwise it renders children directly (standalone mode).
 */

import { AppProvider } from "@shopify/app-bridge-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ShopifyProviderInner({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const isEmbedded = process.env.NEXT_PUBLIC_SHOPIFY_EMBEDDED === "true";
  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_CLIENT_ID ?? "";

  // App Bridge needs the host param that Shopify injects into the iframe URL
  const host = searchParams.get("host") ?? undefined;

  if (!isEmbedded || !apiKey || !host) {
    // Standalone mode — no App Bridge wrapper needed
    return <>{children}</>;
  }

  return (
    <AppProvider apiKey={apiKey} host={host}>
      {children}
    </AppProvider>
  );
}

export function ShopifyProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ShopifyProviderInner>{children}</ShopifyProviderInner>
    </Suspense>
  );
}
