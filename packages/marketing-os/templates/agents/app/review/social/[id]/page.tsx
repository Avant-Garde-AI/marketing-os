/**
 * The social review room — one post GROUP (spec 26 ⟨BUILD⟩ 2, D3).
 *
 * A post is not an email. The thing worth reviewing is the GROUP: every
 * platform variant of one creative idea, side by side, each at its own aspect
 * ratio with its own scheduled time and its caption in reading order. Reviewed
 * apart, a brand's register drifts between platforms and nobody sees it.
 *
 * Token-gated and public: someone with the link needs no console account. The
 * room shows approval STATE and stops — it has no control that could advance a
 * lifecycle, because a token proves possession of a link, not identity
 * (spec 26 §0.1). The only write is a note.
 */

import { loadPostGroup } from "@/lib/social/console-data";
import { postReviewAssets } from "@/lib/social/projection";
import { socialReviewLink, socialSheetLink, ttlRemaining, verifyLink } from "@/lib/social/review-links";
import { listNotes } from "@/lib/review/notes";
import { runWithTenant } from "@/lib/tenant-context";
import { SocialReviewNotes } from "@/components/review/social-review";
import { loadGenerationJobForPost, type GenerationReview } from "@/lib/social/generation-review";
import { loadGenerationDelivery } from "@/lib/social/generation-delivery";
import { socialRepo } from "@/lib/social/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const SOCIAL_PACK_ID = "social-media";

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

/** Portrait/story/square all read correctly if the frame keeps the platform's
 * own ratio — a square crop of a story is a different design. */
function aspectFor(channel: string): string {
  const c = channel.toLowerCase();
  if (c.includes("story") || c.includes("reel") || c.includes("tiktok")) return "9 / 16";
  if (c.includes("pinterest")) return "2 / 3";
  return "1 / 1";
}

type Delivery = NonNullable<Awaited<ReturnType<typeof loadGenerationDelivery>>>;
type DeliveryResult = { delivery: Delivery | null; failed: boolean };

function generationStatus(state: string): string {
  if (state === "awaiting_approval") return "Ready to generate";
  if (["preparing", "submitting", "submitted"].includes(state)) return "Rendering in progress";
  if (state === "succeeded") return "Rendered · ready for fidelity and loop review";
  if (state === "unknown") return "Status needs checking";
  if (state === "failed") return "Generation stopped";
  if (state === "declined") return "Generation declined";
  return state;
}

function sceneRenderUrl(shop: string, postId: string, ttl: number): string {
  const signed = new URL(socialReviewLink(shop, postId, ttl).url);
  return `/api/social/generation/render/${encodeURIComponent(postId)}?${signed.searchParams.toString()}`;
}

function GenerationPanel({ job, delivery, deliveryFailed, renderUrl }: {
  job: GenerationReview; delivery: Delivery | null; deliveryFailed: boolean; renderUrl: string;
}) {
  const scene = job.mechanic === "collection-scene";
  const sceneReady = scene && job.state === "succeeded" && !!job.imageUrl && !!delivery?.scene && !deliveryFailed;
  const label = scene ? "Collection scene" : "Artwork loop";
  return (
    <section style={{ border: "1px solid rgba(0,0,0,0.14)", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
      <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.35rem" }}>{label} · {sceneReady ? "Composed for review"
        : scene && deliveryFailed ? "Composition unavailable"
        : scene && job.state === "succeeded" ? "Background rendered · composition pending"
        : generationStatus(job.state)}</h2>
      <p style={{ fontSize: "0.8rem", opacity: 0.7, margin: "0 0 0.75rem" }}>
        {job.postId} · {job.estimatedCredits} estimated / {job.maximumCredits} maximum Higgsfield credits
      </p>
      {sceneReady ? (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={renderUrl} alt="Three complete artworks placed in the collection scene"
            width={1080} height={1350}
            style={{ width: "min(100%, 540px)", aspectRatio: "4 / 5", objectFit: "contain", background: "#f4f2ef", display: "block" }} />
          <p style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
            <a href={renderUrl} target="_blank" rel="noopener noreferrer">Open or download final 4:5 image</a>
          </p>
        </div>
      ) : scene ? (
        <p role="status" style={{ fontSize: "0.85rem" }}>
          {deliveryFailed ? "The final composition could not be verified. Reload this page or ask for a new review link."
            : job.state === "succeeded" ? "Background rendered; exact artwork composition is pending. Reload this page to check status."
            : "The final composition is not ready yet. Reload this page to check status."}
        </p>
      ) : job.videoUrl ? (
        <div>
          <video controls loop playsInline preload="metadata" poster={job.thumbnailUrl ?? undefined}
            style={{ width: "min(100%, 420px)", aspectRatio: "9 / 16", objectFit: "contain", background: "#151515", display: "block" }}>
            <source src={job.videoUrl} type="video/mp4" />
            Your browser cannot play this video.
          </video>
          <p style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
            <a href={job.videoUrl} target="_blank" rel="noopener noreferrer">Open or download video</a>
            {job.durationSec ? ` · ${job.durationSec} seconds` : ""}
          </p>
        </div>
      ) : job.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={job.thumbnailUrl} alt="Artwork loop poster" style={{ width: "min(100%, 420px)", aspectRatio: "9 / 16", objectFit: "contain", background: "#f4f2ef" }} />
      ) : (
        <p style={{ fontSize: "0.85rem" }}>No rendered video is available yet. Reload this page to check status.</p>
      )}
      <p style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem", lineHeight: 1.5 }}><strong>Caption</strong><br />{delivery?.caption ?? job.caption}</p>
      {deliveryFailed && !scene && (
        <p role="status" style={{ fontSize: "0.8rem", color: "#765b16" }}>
          The latest caption receipt could not be verified. The original caption is shown above.
        </p>
      )}
      <p style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", lineHeight: 1.5 }}><strong>{scene ? "Scene brief" : "Motion brief"}</strong><br />{job.prompt}</p>
      <p style={{ fontSize: "0.8rem" }}><a href={job.sourcePreviewUrl} target="_blank" rel="noopener noreferrer">Review verified source artwork</a></p>
      {(job.state === "unknown" || job.state === "failed") && (
        <p role="status" style={{ fontSize: "0.8rem", color: "#765b16" }}>
          {job.state === "unknown"
            ? "Generation status needs checking before another attempt."
            : `Generation stopped before a usable ${scene ? "image" : "video"} was ready.`}
        </p>
      )}
      <p style={{ fontSize: "0.78rem", opacity: 0.7, marginBottom: 0 }}>
        {scene ? "Review all three complete artworks in the final scene." : "Review the full artwork, motion, and loop seam."} Leave feedback below. Publishing requires a separate approval.
      </p>
    </section>
  );
}

export default async function SocialReviewRoom({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const shop = one(sp.shop) ?? process.env.SHOPIFY_STORE_URL ?? "";
  const token = one(sp.t);
  const exp = one(sp.e);

  if (!shop) {
    return <Gate headline="This link is incomplete" sub="It is missing the store it belongs to. Ask for a fresh link." />;
  }
  const verdict = verifyLink("review", shop, id, token, exp);
  if (verdict === "expired") {
    return (
      <Gate
        headline="This review link has expired"
        sub="Review links are time-limited on purpose. Ask whoever shared it for a new one — nothing is lost."
      />
    );
  }
  if (verdict !== "ok") {
    return <Gate headline="This link isn’t valid" sub="Check you copied the whole URL, or ask for a fresh link." />;
  }

  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  const publicUrl = (process.env.MOS_AGENTS_PUBLIC_URL ?? "").replace(/\/$/, "");
  const { group, notes, generationJobs, generationUnavailable, deliveries } = await runWithTenant({ shop, storeSlug }, async () => {
    const group = await loadPostGroup(shop, id);
    const postIds = group.posts.length > 0 ? [...new Set(group.posts.map((member) => member.post.id))] : [id];
    let generationUnavailable = false;
    const lookedUp = await Promise.all(postIds.map(async (postId) => {
      try { return await loadGenerationJobForPost(postId); }
      catch { generationUnavailable = true; return null; }
    }));
    const generationJobs = lookedUp.filter((job): job is GenerationReview => job !== null);
    const deliveries = new Map<string, DeliveryResult>();
    for (const job of generationJobs) {
      try {
        const delivery = await loadGenerationDelivery(socialRepo, job);
        deliveries.set(job.id, { delivery, failed: false });
      } catch { deliveries.set(job.id, { delivery: null, failed: true }); }
    }
    return { group, notes: await listNotes(SOCIAL_PACK_ID, id), generationJobs, generationUnavailable, deliveries };
  });

  if (group.posts.length === 0 && generationJobs.length === 0) {
    return (
      <Gate
        headline={generationUnavailable ? "Generation status unavailable" : "Nothing to review here yet"}
        sub={
          generationUnavailable
            ? "The generation status could not be loaded. Reload this page or try again later."
            : group.unreadable > 0
            ? `This group has ${group.unreadable} post(s) that could not be read. That is a problem to fix, not an empty group — tell whoever shared the link.`
            : "No posts are in this group. It may have been renamed or not created yet."
        }
      />
    );
  }

  const ttl = ttlRemaining(exp);
  const postMonth = generationJobs[0]?.postId.match(/^(\d{4}-(?:0[1-9]|1[0-2]))-/)?.[1] ?? null;
  const month = group.posts.find((p) => p.post.scheduledAt)?.post.scheduledAt?.slice(0, 7) ??
    postMonth ?? generationJobs[0]?.createdAt.slice(0, 7) ?? null;
  const sheet = month ? socialSheetLink(shop, month, ttl) : null;
  const anyApproved = group.posts.some((p) => p.post.status === "scheduled" || p.post.status === "published");

  return (
    <main style={{ maxWidth: 1100, margin: "2.5rem auto 5rem", padding: "0 1.25rem", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ marginBottom: "1.75rem" }}>
        <p style={{ fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.6, margin: 0 }}>
          {group.posts.length > 0
            ? `Social review · ${group.posts.length} variant${group.posts.length === 1 ? "" : "s"}`
            : `Social review · ${generationJobs[0]?.mechanic === "collection-scene" ? "collection scene" : "artwork loop"}`}
        </p>
        <h1 style={{ fontSize: "1.5rem", margin: "0.35rem 0 0" }}>{id}</h1>
        {sheet && (
          <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
            <a href={sheet.url}>See the whole month ({month})</a>
          </p>
        )}
      </header>

      {anyApproved && (
        <p
          style={{
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 6,
            padding: "0.65rem 0.9rem",
            fontSize: "0.85rem",
            marginBottom: "1.5rem",
          }}
        >
          Part of this group is already scheduled or published. Notes remain useful; changing what ships
          requires a separate approval.
        </p>
      )}

      {group.unreadable > 0 && (
        <p role="alert" style={{ color: "#a11", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          {group.unreadable} post(s) in this group could not be read and are not shown below.
        </p>
      )}

      {generationUnavailable && (
        <p role="status" style={{ color: "#765b16", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          Generation status is temporarily unavailable. Existing post details and notes are still shown.
        </p>
      )}

      {generationJobs.map((job) => <GenerationPanel key={job.id} job={job}
        delivery={deliveries.get(job.id)?.delivery ?? null} deliveryFailed={deliveries.get(job.id)?.failed ?? false}
        renderUrl={sceneRenderUrl(shop, job.postId, ttl)} />)}

      {group.posts.length > 0 && <div
        style={{
          display: "grid",
          gap: "1.5rem",
          gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${group.posts.length > 1 ? "300px" : "420px"}), 1fr))`,
        }}
      >
        {group.posts.map(({ post, studioPath }) => {
          const assets = postReviewAssets(post, publicUrl);
          const sequence = post.renderedSequence;
          const video = post.renderedVideo;
          const generation = generationJobs.find((job) => job.postId === post.id);
          const latestCopy = generation ? deliveries.get(generation.id)?.delivery?.caption ?? generation.caption : post.copy;
          return (
            <article key={post.id} style={{ minWidth: 0, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "0.6rem 0.85rem", borderBottom: "1px solid rgba(0,0,0,0.08)", fontSize: "0.8rem" }}>
                <strong>{post.channel}</strong>
                <span style={{ opacity: 0.65 }}>
                  {" · "}
                  {post.scheduledAt ? new Date(post.scheduledAt).toLocaleString() : "unscheduled"}
                  {" · "}
                  {post.status}
                </span>
              </div>
              {assets.length > 0 ? (
                <section aria-label={`${post.channel} final creative`}>
                  {video && (
                    <div>
                      <div style={{ padding: "0.85rem", background: "#f4f2ef", fontSize: "0.8rem", overflowWrap: "anywhere" }}>
                        <strong>Rendered video · final creative for review</strong>
                        <p>Storyboard: {video.storyboardId} · {(video.video.durationMs / 1000).toFixed(1)} seconds</p>
                        <p>Video publishing is not available yet.</p>
                        <details>
                          <summary>Render provenance</summary>
                          <p>Storyboard hash: <code>{video.storyboardHash}</code></p>
                          <p>Review hash: <code>{video.reviewHash}</code></p>
                          <p>Video SHA-256: <code>{video.video.sha256}</code></p>
                          <p>Poster SHA-256: <code>{video.poster.sha256}</code></p>
                          <p>{video.sources.length} source asset{video.sources.length === 1 ? "" : "s"} bound in the render receipt</p>
                        </details>
                      </div>
                      <video controls loop playsInline preload="metadata" poster={video.poster.url}
                        width={video.video.width} height={video.video.height}
                        style={{ width: "100%", height: "auto", background: "#111", display: "block" }}>
                        <source src={video.video.url} type={video.video.mimeType} />
                        Your browser cannot play this video.
                      </video>
                      <p style={{ padding: "0.7rem 0.85rem", margin: 0, fontSize: "0.85rem" }}>
                        <a href={video.video.url} target="_blank" rel="noopener noreferrer">Open or download video</a>
                      </p>
                    </div>
                  )}
                  {sequence && (
                    <div style={{ padding: "0.85rem", background: "#f4f2ef", fontSize: "0.8rem", lineHeight: 1.5, overflowWrap: "anywhere" }}>
                      <strong>{assets.length} slide{assets.length === 1 ? "" : "s"} · publication order</strong>
                      <p style={{ margin: "0.25rem 0 0" }}>Storyboard: {sequence.storyboardId}</p>
                      <p style={{ margin: "0.25rem 0 0" }}>These rendered slides are the final creative for review.</p>
                      <details style={{ marginTop: "0.5rem" }}>
                        <summary>Render provenance</summary>
                        <dl style={{ marginBottom: 0 }}>
                          <dt>Storyboard hash</dt>
                          <dd style={{ margin: "0 0 0.5rem", fontFamily: "monospace" }}>{sequence.storyboardHash}</dd>
                          <dt>Review hash</dt>
                          <dd style={{ margin: 0, fontFamily: "monospace" }}>{sequence.reviewHash}</dd>
                        </dl>
                      </details>
                    </div>
                  )}
                  {!video && <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {assets.map((src, index) => {
                      const slide = sequence?.slides[index];
                      return (
                        <li key={`${index}-${src}`} style={{ borderTop: index > 0 ? "1px solid rgba(0,0,0,0.12)" : undefined }}>
                          <figure style={{ margin: 0 }}>
                            <figcaption style={{ padding: "0.65rem 0.85rem", fontSize: "0.8rem", lineHeight: 1.5, overflowWrap: "anywhere" }}>
                              <strong>Slide {index + 1} of {assets.length}</strong>
                              {slide && <span> · {slide.boardName}<br />Beat: {slide.beatId}</span>}
                            </figcaption>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt={`${post.channel} slide ${index + 1} of ${assets.length}${slide ? `: ${slide.boardName} (beat ${slide.beatId})` : ` for ${post.id}`}`}
                              width={slide?.width}
                              height={slide?.height}
                              style={{ width: "100%", height: "auto", aspectRatio: slide ? `${slide.width} / ${slide.height}` : aspectFor(post.channel), objectFit: "contain", background: "#f4f2ef", display: "block" }}
                            />
                            {slide && (
                              <details style={{ padding: "0.5rem 0.85rem", fontSize: "0.75rem", overflowWrap: "anywhere" }}>
                                <summary>Slide provenance · {slide.width} × {slide.height}</summary>
                                <p style={{ fontFamily: "monospace", marginBottom: 0 }}>SHA-256: {slide.sha256}</p>
                              </details>
                            )}
                          </figure>
                        </li>
                      );
                    })}
                  </ol>}
                </section>
              ) : (
                <div
                  style={{
                    aspectRatio: aspectFor(post.channel),
                    background: "#f4f2ef",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "0.85rem",
                    opacity: 0.6,
                  }}
                >
                  No creative composed yet
                </div>
              )}
              <div style={{ padding: "0.85rem" }}>
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.92rem", lineHeight: 1.5, margin: 0 }}>{latestCopy}</p>
                <p style={{ fontSize: "0.8rem", marginTop: "0.6rem", opacity: 0.75, wordBreak: "break-all" }}>
                  → {post.targetLink}
                </p>
                {studioPath && (
                  <p style={{ fontSize: "0.8rem", marginTop: "0.4rem" }}>
                    <a href={studioPath}>Open in Design Studio</a>
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>}

      {group.posts.some((p) => p.post.body.trim()) && (
        <section style={{ marginTop: "2.5rem" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Why these posts</h2>
          {group.posts
            .filter((p) => p.post.body.trim())
            .map(({ post }) => (
              <div key={post.id} style={{ marginBottom: "1rem" }}>
                <p style={{ fontSize: "0.78rem", opacity: 0.6, margin: "0 0 0.25rem" }}>{post.channel}</p>
                <div style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem", lineHeight: 1.6 }}>{post.body}</div>
                {post.provenance.length > 0 && (
                  <ul style={{ fontSize: "0.8rem", opacity: 0.75, marginTop: "0.4rem" }}>
                    {post.provenance.map((c, i) => (
                      <li key={i}>
                        {c.claim} <em>({c.origin})</em>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
        </section>
      )}

      <SocialReviewNotes
        groupKey={id}
        shop={shop}
        token={token ?? ""}
        exp={exp ?? ""}
        initial={notes}
        slots={group.posts.length > 0 ? group.posts.map((p) => p.post.id) : generationJobs.map((job) => job.postId)}
      />

      <p style={{ fontSize: "0.75rem", opacity: 0.55, marginTop: "2.5rem" }}>
        This link works for about {ttl} more day{ttl === 1 ? "" : "s"}.
      </p>
    </main>
  );
}
