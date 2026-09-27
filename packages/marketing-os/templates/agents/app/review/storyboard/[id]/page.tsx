/** Signed, read-only planning review. Selection authority stays in the Action gate. */
import { verifyLink } from "@/lib/social/review-links";
import { socialRepo } from "@/lib/social/repo";
import { readStoryboardReview, type DurableStoryboardReview } from "@/lib/storyboard/reviews";
import { runWithTenant } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
function Gate({ message }: { message: string }) {
  return <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}><h1 style={{ fontSize: "1.3rem" }}>Storyboard review unavailable</h1><p>{message}</p></main>;
}
function Field({ label, value }: { label: string; value: string | undefined }) {
  return <div style={{ margin: "0.75rem 0" }}><strong>{label}</strong><p style={{ margin: "0.2rem 0", whiteSpace: "pre-wrap" }}>{value ?? "Not supplied"}</p></div>;
}

export default async function StoryboardReviewRoom({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const shop = one(sp.shop) ?? process.env.SHOPIFY_STORE_URL ?? "";
  const hash = one(sp.hash);
  if (!shop || !hash || !/^[a-f0-9]{64}$/.test(hash)) return <Gate message="This link is incomplete. Ask for a fresh storyboard review link." />;
  const verdict = verifyLink("review", shop, `storyboard:${id}`, one(sp.t), one(sp.e));
  if (verdict !== "ok") return <Gate message={verdict === "expired" ? "This review link has expired. Ask for a fresh link." : "This review link is invalid. Check the complete URL or ask for a fresh link."} />;
  let artifact: DurableStoryboardReview;
  try {
    artifact = await runWithTenant({ shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") }, () => readStoryboardReview(socialRepo, id, hash, { tenant: shop }));
  } catch {
    return <Gate message="This planning material is unavailable or its sources have changed. Ask for a fresh planning review before selecting a storyboard." />;
  }
  return (
    <main style={{ maxWidth: 1100, margin: "2rem auto 4rem", padding: "0 1rem", fontFamily: "system-ui, sans-serif", lineHeight: 1.6, overflowWrap: "anywhere" }}>
      <header>
        <p style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Storyboard planning review · 3 alternatives</p>
        <h1 style={{ fontSize: "1.6rem" }}>Choose the story before generating imagery</h1>
        <Field label="Brief" value={artifact.brief} />
        <p>This public link is read-only. Selection requires an authenticated <code>storyboard.select</code> proposal through the existing Action gate. An option marked reviewable still requires human selection; it is not approval to publish.</p>
        <p>Status: <strong>{artifact.review.status}</strong> · Imagery calls: {artifact.review.imageryCalls}</p>
        {artifact.review.missing.length > 0 && <div role="alert"><strong>Missing planning evidence</strong><ul>{artifact.review.missing.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
      </header>
      <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
        {artifact.review.options.map((option, index) => {
          const story = option.storyboard;
          return <article key={story.id} style={{ minWidth: 0, border: "1px solid #d4d1cb", borderRadius: 8, padding: "1rem" }}>
            <h2 style={{ fontSize: "1.15rem", marginTop: 0 }}>Alternative {index + 1} · {story.id}</h2>
            <p><strong>{option.status}</strong> · {story.format} · Evidence: <strong>{option.evidenceStatus}</strong></p>
            <p style={{ fontSize: "0.85rem" }}>{option.evidenceStatus === "observed" ? "Supported by observed planning evidence; inspect the sources below." : "A creative hypothesis, not an observed performance claim."}</p>
            <Field label="Premise" value={story.premise} />
            <Field label="Payoff" value={story.payoff} />
            {story.conceptId && <Field label="Concept" value={story.conceptId} />}
            {story.subjectHandles && <Field label="Catalog subjects" value={story.subjectHandles.join(", ")} />}
            {story.needAssessments?.map((need) => <div key={need.needId}><Field label={`Need ${need.needId} · ${need.met ? "met" : "unmet"}`} value={need.reason} /><Field label="Sources" value={need.sourceRefs.join("\n")} /></div>)}
            <h3 style={{ fontSize: "1rem" }}>Beats in exact order</h3>
            <ol style={{ paddingLeft: "1.3rem" }}>
              {story.beats.map((beat, beatIndex) => <li key={beat.id} style={{ marginBottom: "1.5rem" }}>
                <strong>Beat {beatIndex + 1} · {beat.id} · {beat.role}</strong>
                <Field label="Assertion" value={beat.assertion} />
                <Field label="Transition" value={beat.transition?.change ?? (beatIndex === 0 ? "Opening beat" : "Not supplied")} />
                {beat.transition && <><Field label="Why the transition matters" value={beat.transition.why} /><Field label="Pattern references" value={beat.transition.patternRefs.join(", ")} /></>}
                <Field label="Visual brief · shows" value={beat.brief.shows} />
                <Field label="Feels" value={beat.brief.feels} />
                <Field label="Avoid" value={beat.brief.avoid.join("\n")} />
                <Field label="Sourcing" value={beat.brief.sourcing} />
                {beat.brief.aspect && <Field label="Aspect" value={beat.brief.aspect} />}
                {beat.brief.seconds !== undefined && <Field label="Duration" value={`${beat.brief.seconds} seconds`} />}
                {beat.brief.asset && <Field label="Asset" value={`${beat.brief.asset.ref} · ${beat.brief.asset.use}`} />}
                <Field label="On-slide copy" value={beat.copy} />
                <strong>Assertion evidence</strong>
                <ul style={{ paddingLeft: "1.1rem" }}>{beat.evidence.map((e, i) => <li key={i}>{e.claim}<br /><small>Origin: {e.origin} · Source: {e.source ?? "Not supplied"}</small></li>)}</ul>
              </li>)}
            </ol>
            <Field label="Caption" value={story.caption} />
            {story.copyFormulaRef && <Field label="Brand copy formula" value={story.copyFormulaRef} />}
            {story.continuity.length > 0 && <><h3 style={{ fontSize: "1rem" }}>Continuity</h3><ul>{story.continuity.map((c, i) => <li key={i}>{c.what} · {c.binding}{c.ref ? ` · ${c.ref}` : ""}</li>)}</ul></>}
            <h3 style={{ fontSize: "1rem" }}>Independent critic reasons</h3>
            <ul style={{ paddingLeft: "1.1rem" }}>{option.verdicts.map((v, i) => <li key={i} style={{ marginBottom: "0.75rem" }}><strong>{v.kill ? "Eliminate" : "Pass"}{v.beatId ? ` · Beat ${v.beatId}` : ""}{v.candidateId ? ` · Candidate ${v.candidateId}` : ""}</strong><p style={{ margin: "0.2rem 0", whiteSpace: "pre-wrap" }}>{v.reason}</p>{v.score !== undefined && <small>Comparator score: {v.score}</small>}</li>)}</ul>
          </article>;
        })}
      </div>
      <details style={{ marginTop: "2rem" }}><summary>Planning provenance</summary><Field label="Review ID" value={artifact.reviewId} /><Field label="Created" value={artifact.createdAt} /><Field label="Review hash" value={artifact.reviewHash} /><Field label="Context hash" value={artifact.contextHash} /><Field label="Brand source" value={artifact.context.brand.source} /><ul>{artifact.sources.map((source) => <li key={source.path}>{source.path} · {source.hash ?? "Absent at planning"}</li>)}</ul></details>
    </main>
  );
}
