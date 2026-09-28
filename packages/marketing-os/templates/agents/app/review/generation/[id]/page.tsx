import { verifyLink } from "@/lib/social/review-links";
import { socialRepo } from "@/lib/social/repo";
import { readGenerationInput } from "@/lib/social/generation-input";
import { runWithTenant } from "@/lib/tenant-context";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
const one = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] ?? null : v ?? null;

export default async function GenerationReview({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params; const sp = await searchParams;
  const shop = one(sp.shop) ?? ""; const hash = one(sp.hash);
  const githubRepo = one(sp.repo);
  const unavailable = <main><h1>Generation review unavailable</h1><p>The link expired or its source/creative changed. Ask for a fresh review.</p></main>;
  if (!process.env.ACTIONS_GATE_SECRET || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !hash || !/^[a-f0-9]{64}$/.test(hash) ||
      (process.env.MARKETING_OS_MODE === "hosted" && (!githubRepo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo))) ||
      (process.env.MARKETING_OS_MODE !== "hosted" && shop !== process.env.SHOPIFY_STORE_URL) ||
      verifyLink("review", shop, `generation:${id}:${hash}:${githubRepo ?? ""}`, one(sp.t), one(sp.e)) !== "ok") return unavailable;
  try {
    const input = await runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, ""), githubRepo },
      () => readGenerationInput(socialRepo, id));
    if (input.inputHash !== hash) return unavailable;
    return <main style={{ maxWidth: 960, margin: "2rem auto", padding: "1rem", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>Artwork loop · before generation</p><h1>Review the artwork and animation</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "2rem" }}>
        {/* Source bytes stay behind the signed review; no public master URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/jpeg;base64,${input.base64}`} alt="Complete artwork fitted into the proposed video canvas" style={{ width: "100%", maxHeight: 640, objectFit: "contain" }} />
        <section><h2>Motion</h2><p style={{ whiteSpace: "pre-wrap" }}>{input.plan.prompt}</p>
          <h2>Caption</h2><p>{input.plan.caption}</p><h2>Source treatment</h2>
          <p>The complete artwork is fitted into the video canvas with padding. Its edges are preserved.</p>
          <p>This is the proposed input, not a generated video. Review the credit limit in the authenticated approval card before approving generation. Publishing requires a separate approval.</p>
        </section>
      </div>
    </main>;
  } catch { return unavailable; }
}
