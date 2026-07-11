// /brand → this store's Brand Portal. The client-owned deployment serves one
// store; its slug comes from the same env the tenant context uses.
import { redirect } from "next/navigation";

export default function BrandIndex() {
  const shop = process.env.SHOPIFY_STORE_URL ?? "";
  const slug = process.env.STORE_SLUG ?? (shop ? shop.replace(/\.myshopify\.com$/, "") : "");
  if (!slug) redirect("/");
  redirect(`/brand/${slug}`);
}
