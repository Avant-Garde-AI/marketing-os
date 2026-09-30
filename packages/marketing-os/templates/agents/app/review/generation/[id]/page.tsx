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
    const isScene = input.plan.mechanic === "collection-scene";
    return <main style={{ maxWidth: 960, margin: "2rem auto", padding: "1rem", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>{isScene ? "Three-source scene · verified source contact sheet" : "Artwork loop · before generation"}</p>
      <h1>{isScene ? "Review the three artworks and scene direction" : "Review the artwork and animation"}</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "2rem" }}>
        {/* Source bytes stay behind the signed review; no public master URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/jpeg;base64,${input.base64}`} alt={isScene ? "Ordered contact sheet of three complete source artworks, left to right" : "Complete artwork fitted into the proposed video canvas"} style={{ width: "100%", maxHeight: 640, objectFit: "contain" }} />
        <section>{isScene && <p>Scene: {input.plan.scene === "real-home" ? "real home" : "imagined world"}</p>}
          <h2>{isScene ? "Empty-frame environment prompt" : "Motion"}</h2><p style={{ whiteSpace: "pre-wrap" }}>{input.plan.prompt}</p>
          <h2>Caption</h2><p>{input.plan.caption}</p><h2>Source treatment</h2>
          {isScene ? <p>The contact sheet shows all three verified artworks in source order, left to right, with their full edges preserved. It is source-review proof, not the generated scene or a placement preview. The provider generates a text-only empty-frame environment; the artworks are composited afterward and are not redrawn by the provider.</p>
            : <p>The complete artwork is fitted into the video canvas with padding. Its edges are preserved.</p>}
          {isScene && <ol>{input.plan.sources.map((source) => <li key={source.sourceSha256}>{source.sourceRef} · receipt {source.verificationRef}</li>)}</ol>}
          <p>{isScene ? "This is source proof, not generated output." : "This is proposed input, not generated output."} An explicit authenticated run with a credit ceiling proceeds through the Action gate; no separate artwork preapproval is required. Publishing remains a separate action.</p>
        </section>
      </div>
    </main>;
  } catch { return unavailable; }
}
