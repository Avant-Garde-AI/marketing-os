/**
 * The social month sheet — every post group planned for a month
 * (spec 26 ⟨BUILD⟩ 2).
 *
 * A contact sheet, not a room: scan the month, see where the register drifts,
 * then open the group that needs discussion. Per D7 the sheet carries note
 * COUNTS only (one grouped query, never a per-card lookup) — composing a note
 * stays in the room, where the whole group is visible.
 */

import { loadCalendar } from "@/lib/social/console-data";
import { socialReviewLink, ttlRemaining, verifyLink } from "@/lib/social/review-links";
import { groupKey, groupPosts, postThumbnailUrl } from "@/lib/social/projection";
import { parsePost, postPath } from "@/lib/social/artifacts";
import { socialRepo } from "@/lib/social/repo";
import { countNotes } from "@/lib/review/notes";
import { loadGenerationJobsForMonth, type GenerationReview } from "@/lib/social/generation-review";
import { loadGenerationDelivery } from "@/lib/social/generation-delivery";
import { runWithTenant } from "@/lib/tenant-context";
import type { SocialPost } from "@/lib/social/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const SOCIAL_PACK_ID = "social-media";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
type Delivery = NonNullable<Awaited<ReturnType<typeof loadGenerationDelivery>>>;
type DeliveryResult = { delivery: Delivery | null; failed: boolean };

function sceneRenderUrl(shop: string, postId: string, ttl: number): string {
  const signed = new URL(socialReviewLink(shop, postId, ttl).url);
  return `/api/social/generation/render/${encodeURIComponent(postId)}?${signed.searchParams.toString()}`;
}

function one(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function Gate({ headline, sub }: { headline: string; sub: string }) {
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1.25rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.15rem", marginBottom: "0.5rem" }}>{headline}</h1>
      <p style={{ opacity: 0.75, lineHeight: 1.6 }}>{sub}</p>
    </main>
  );
}

export default async function SocialMonthSheet({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const shop = one(sp.shop) ?? process.env.SHOPIFY_STORE_URL ?? "";
  const month = one(sp.month) ?? "";
  const token = one(sp.t);
  const exp = one(sp.e);

  if (!shop || !MONTH_RE.test(month)) {
    return <Gate headline="This link is incomplete" sub="It is missing the store or the month. Ask for a fresh link." />;
  }
  const verdict = verifyLink("sheet", shop, month, token, exp);
  if (verdict === "expired") {
    return (
      <Gate
        headline="This review link has expired"
        sub="Review links are time-limited on purpose. Ask whoever shared it for a new one."
      />
    );
  }
  if (verdict !== "ok") {
    return <Gate headline="This link isn’t valid" sub="Check you copied the whole URL, or ask for a fresh link." />;
  }

  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  const publicUrl = (process.env.MOS_AGENTS_PUBLIC_URL ?? "").replace(/\/$/, "");
  const ttl = ttlRemaining(exp);

  const { groups, counts, unreadable, generationJobs, generationUnavailable, deliveries } = await runWithTenant({ shop, storeSlug }, async () => {
    // Read from the CALENDAR (the month's plan), then the artifacts it points
    // at — files are truth, so the sheet shows what would actually ship.
    const calendar = await loadCalendar(shop, month);
    const ids = [...new Set((calendar?.slots ?? []).map((s) => s.postId).filter((v): v is string => !!v))];
    const posts: SocialPost[] = [];
    let bad = 0;
    for (const id of ids) {
      try {
        const raw = await socialRepo.readFile(postPath(id));
        if (raw === null) continue;
        posts.push(parsePost(raw));
      } catch {
        bad++;
      }
    }
    const grouped = groupPosts(posts);
    let generationJobs: GenerationReview[] = [];
    let generationUnavailable = false;
    try { generationJobs = await loadGenerationJobsForMonth(month); }
    catch { generationUnavailable = true; }
    const deliveries = new Map<string, DeliveryResult>();
    // Bound concurrent repo reads for a full month; one bad receipt must not
    // hide other jobs or the ordinary calendar cards.
    for (let offset = 0; offset < generationJobs.length; offset += 4) {
      await Promise.all(generationJobs.slice(offset, offset + 4).map(async (job) => {
        try {
          const delivery = await loadGenerationDelivery(socialRepo, job);
          deliveries.set(job.id, { delivery, failed: false });
        } catch { deliveries.set(job.id, { delivery: null, failed: true }); }
      }));
    }
    return {
      groups: grouped,
      counts: await countNotes(SOCIAL_PACK_ID, grouped.map((g) => g.key)),
      unreadable: bad,
      generationJobs,
      generationUnavailable,
      deliveries,
    };
  });
  const postsInGroups = new Set(groups.flatMap((g) => g.posts.map((post) => post.id)));
  const standaloneJobs = generationJobs.filter((job) => !postsInGroups.has(job.postId));

  return (
    <main style={{ maxWidth: 1200, margin: "2.5rem auto 5rem", padding: "0 1.25rem", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ marginBottom: "1.75rem" }}>
        <p style={{ fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.6, margin: 0 }}>
          Social · month sheet
        </p>
        <h1 style={{ fontSize: "1.5rem", margin: "0.35rem 0 0" }}>{month}</h1>
      </header>

      {unreadable > 0 && (
        <p role="alert" style={{ color: "#a11", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
          {unreadable} post(s) planned this month could not be read and are not shown.
        </p>
      )}

      {generationUnavailable && (
        <p role="status" style={{ color: "#765b16", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
          Generation status is temporarily unavailable. Existing posts are still shown below.
        </p>
      )}

      {groups.length === 0 && standaloneJobs.length === 0 ? (
        <p style={{ opacity: 0.7 }}>
          Nothing is planned for {month} yet — or the month&rsquo;s calendar has no posts attached to its slots.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {groups.map(({ key, posts }) => {
            const lead = posts[0]!;
            const motion = generationJobs.filter((job) => posts.some((post) => post.id === job.postId));
            const leadJob = motion.find((job) => job.postId === lead.id) ?? motion[0];
            const sceneJob = motion.find((job) => job.mechanic === "collection-scene");
            const cardJob = sceneJob ?? leadJob;
            const sceneReceipt = sceneJob ? deliveries.get(sceneJob.id) : null;
            const sceneReady = !!sceneJob && sceneJob.state === "succeeded" && !!sceneJob.imageUrl && !!sceneReceipt?.delivery?.scene && !sceneReceipt.failed;
            const src = sceneJob ? (sceneReady ? sceneRenderUrl(shop, sceneJob.postId, ttl) : null)
              : leadJob?.thumbnailUrl ?? postThumbnailUrl(lead, publicUrl);
            const imageRatio = sceneJob ? "4 / 5" : leadJob?.thumbnailUrl ? "9 / 16" : "1 / 1";
            const n = counts.get(key);
            const when = posts.find((p) => p.scheduledAt)?.scheduledAt;
            const caption = cardJob ? deliveries.get(cardJob.id)?.delivery?.caption ?? cardJob.caption : lead.copy;
            return (
              <a
                key={key}
                href={socialReviewLink(shop, key, ttl).url}
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 8,
                  overflow: "hidden",
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
                }}
              >
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" style={{ width: "100%", aspectRatio: imageRatio, objectFit: "contain", display: "block", background: "#f4f2ef" }} />
                ) : (
                  <div style={{ aspectRatio: imageRatio, background: "#f4f2ef", display: "grid", placeItems: "center", fontSize: "0.8rem", opacity: 0.7, padding: "1rem", textAlign: "center" }}>
                    {sceneJob ? sceneReceipt?.failed ? "Final composition could not be verified" : "Exact artwork composition pending" : "No creative yet"}
                  </div>
                )}
                <div style={{ padding: "0.7rem 0.85rem" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>
                    {when ? new Date(when).toLocaleDateString() : "unscheduled"}
                    {posts.length > 1 ? ` · ${posts.length} variants` : ` · ${lead.channel}`}
                  </div>
                  <div style={{ fontSize: "0.88rem", marginTop: "0.3rem", lineHeight: 1.4 }}>
                    {(caption.split("\n").find((l) => l.trim()) ?? key).slice(0, 90)}
                  </div>
                  <div style={{ fontSize: "0.75rem", marginTop: "0.45rem", opacity: 0.7 }}>
                    {lead.status}
                    {n && n.total > 0 ? ` · ${n.open} open / ${n.total} note${n.total === 1 ? "" : "s"}` : ""}
                  </div>
                  {motion.length > 0 && (
                    <div style={{ fontSize: "0.75rem", marginTop: "0.45rem", fontWeight: 600 }}>
                      {motion.map((job) => `${job.mechanic === "collection-scene" ? "Collection scene" : "Artwork loop"} · ${job.state}`).join(", ")}
                    </div>
                  )}
                  {motion.some((job) => deliveries.get(job.id)?.failed) && (
                    <div role="status" style={{ fontSize: "0.75rem", marginTop: "0.45rem", color: "#765b16" }}>
                      A final creative receipt could not be verified. Open this review to check its status.
                    </div>
                  )}
                </div>
              </a>
            );
          })}
          {standaloneJobs.map((job) => {
            const delivery = deliveries.get(job.id);
            const scene = job.mechanic === "collection-scene";
            const sceneReady = scene && job.state === "succeeded" && !!job.imageUrl && !!delivery?.delivery?.scene && !delivery.failed;
            const image = scene ? sceneReady ? sceneRenderUrl(shop, job.postId, ttl) : null : job.thumbnailUrl;
            const ratio = scene ? "4 / 5" : "9 / 16";
            const label = scene ? "Collection scene" : "Artwork loop";
            return (
            <a key={`generation-${job.id}`} href={socialReviewLink(shop, job.postId, ttl).url}
              style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, overflow: "hidden", textDecoration: "none", color: "inherit", display: "block" }}>
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" style={{ width: "100%", aspectRatio: ratio, objectFit: "contain", display: "block", background: "#f4f2ef" }} />
              ) : (
                <div style={{ aspectRatio: ratio, background: "#f4f2ef", display: "grid", placeItems: "center", fontSize: "0.8rem", padding: "1rem", textAlign: "center" }}>
                  {scene ? delivery?.failed ? "Final composition could not be verified" : "Exact artwork composition pending" : `${label} · ${job.state}`}
                </div>
              )}
              <div style={{ padding: "0.7rem 0.85rem" }}>
                <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>{label} · {job.state}</div>
                <div style={{ fontSize: "0.88rem", marginTop: "0.3rem", lineHeight: 1.4 }}>
                  {((delivery?.delivery?.caption ?? job.caption).split("\n").find((line) => line.trim()) ?? job.postId).slice(0, 90)}
                </div>
                {delivery?.failed && <div role="status" style={{ fontSize: "0.75rem", marginTop: "0.45rem", color: "#765b16" }}>
                  Final creative receipt could not be verified.
                </div>}
              </div>
            </a>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: "0.75rem", opacity: 0.55, marginTop: "2.5rem" }}>
        This link works for about {ttl} more day{ttl === 1 ? "" : "s"}. Notes are left inside a group.
      </p>
    </main>
  );
}
