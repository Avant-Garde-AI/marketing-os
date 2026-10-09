import { readPostObservations } from "@/lib/social/observations";
import { socialRepo } from "@/lib/social/repo";
import type { SocialPost } from "@/lib/social/types";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", {
  timeZone: process.env.SOCIAL_CALENDAR_TIME_ZONE ?? "UTC", timeZoneName: "short",
});

/** Stored evidence only; rendering never calls providers or changes a post/approval. */
export async function PostObservations({ post, tenant }: { post: SocialPost; tenant: TenantContext }) {
  let data: Awaited<ReturnType<typeof readPostObservations>>;
  try { data = await runWithTenant(tenant, () => readPostObservations(socialRepo, post)); }
  catch { return <section aria-label="Quality and outcomes" className="mt-5 text-sm"><p role="status">Quality and outcome records could not be loaded.</p></section>; }
  const motion = data.motion?.motion, outcomes = data.outcomes?.outcomes;
  return <section aria-label="Quality and outcomes" className="mt-5 border-t border-hairline pt-4 text-sm">
    <h2 className="mb-3 font-medium">Quality and outcomes</h2>
    {post.renderedVideo && <div className="mb-4">
      <h3 className="font-medium">Motion check</h3>
      {motion ? <>
        <p>{motion.meanStepPercent < motion.littleChangeThresholdPercent ? "Little frame change detected. Review the motion before reusing this direction." : "Frame changes detected. Review whether the movement serves the story."}</p>
        <p className="mt-1 text-ink-3">Story progression, loop continuity and artwork fidelity still need visual review. This check is not a creative approval.</p>
        <details className="mt-2 text-xs text-ink-3"><summary>Frame diagnostics · {when(data.motion!.observedAt)}</summary>
          <p className="mt-1">{motion.frames} frames at {motion.sampleFps} samples/sec. Mean adjacent change: {motion.meanStepPercent.toFixed(2)}%. First-to-last change: {motion.firstLastPercent.toFixed(2)}%. Grayscale differences can include compression noise, drift or camera movement.</p>
        </details>
      </> : <p className="text-ink-3">No frame check recorded for this video. Generation completion does not establish motion or a seamless return.</p>}
    </div>}
    {outcomes ? <div>
      <h3 className="font-medium">Instagram results</h3>
      <p className="mb-3 text-xs text-ink-3">Lifetime totals at {outcomes.ageHours.toFixed(1)} hours after publication · captured {when(data.outcomes!.observedAt)}. Compare posts at similar ages and in the same format.</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(["views", "reach", "saves", "shares", "likes", "comments"] as const).map(key => {
          const metric = outcomes.metrics[key];
          return <div key={key}><dt className="capitalize text-ink-3">{key}</dt><dd className="font-medium">{metric.status === "available" ? metric.value.toLocaleString("en-US") : "Unavailable"}</dd>
            {metric.status === "unavailable" && <p className="text-xs text-ink-3">{metric.reason === "provider-rejected" ? "Instagram did not grant this metric." : metric.reason === "request-failed" ? "The request could not complete." : "Instagram did not return this metric."}</p>}
          </div>;
        })}
      </dl>
      <p className="mt-3 text-xs text-ink-3">These observations do not establish a winning archetype or explain why engagement changed.</p>
    </div> : <p className="text-ink-3">{post.platform ? "No outcome snapshot recorded for this published revision. Missing metrics are not zero." : "Instagram outcomes become available after publication; no snapshot recorded yet."}</p>}
    {data.historical > 0 && <p className="mt-3 text-xs text-ink-3">{data.historical} older or different-revision observation(s) retained in the record; only matching media/content results are shown.</p>}
    {data.unreadable > 0 && <p role="status" className="mt-3 text-xs">{data.unreadable} observation record(s) could not be verified.</p>}
  </section>;
}
