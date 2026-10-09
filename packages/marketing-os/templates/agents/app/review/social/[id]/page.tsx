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
import { socialCarouselSheetLink, socialReviewLink, socialSheetLink, ttlRemaining, verifyCarouselReviewLink, verifyLink } from "@/lib/social/review-links";
import { listNotes } from "@/lib/review/notes";
import { runWithTenant } from "@/lib/tenant-context";
import { SocialReviewNotes } from "@/components/review/social-review";
import { loadGenerationJobForPost, type GenerationReview } from "@/lib/social/generation-review";
import { generationDeliveryRepoFromPreview, loadGenerationDelivery } from "@/lib/social/generation-delivery";
import { socialRepo } from "@/lib/social/repo";
import { parsePost, postPath } from "@/lib/social/artifacts";
import type { SocialPost } from "@/lib/social/types";
import { PostDecision } from "@/components/review/post-decision";
import { SocialPublishing } from "@/components/review/social-publishing";
import { carouselManifestHash } from "@/lib/social/generation-publishing";
import { loadGenerationCarousel, readPersistedCarouselImage, type GenerationCarousel } from "@/lib/social/generation-carousel";
import { readGenerationInput } from "@/lib/social/generation-input";
import { loadVerifiedLoopExport, loopExportManifestPath } from "@/lib/social/generation-export";

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

/** What a person would call this post, not its storage id. */
function postKind(post: SocialPost): string {
  const channel = post.channel.charAt(0).toUpperCase() + post.channel.slice(1);
  if (post.renderedVideo) return `${channel} Reel`;
  if (post.renderedSequence) return `${channel} carousel`;
  return `${channel} post`;
}

function reviewTitle(post: SocialPost | null, id: string): string {
  return post ? postKind(post) : id;
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
type LoopExportView = { state: "verified" | "legacy" | "invalid"; sourceWidth?: number; sourceHeight?: number;
  sourceUpscaled?: boolean; reelWidth?: number; reelHeight?: number; fit?: string };

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

function loopExportUrl(shop: string, postId: string, ttl: number, variant: "reel" | "feed"): string {
  const signed = new URL(socialReviewLink(shop, postId, ttl).url);
  return `/api/social/generation/export/${encodeURIComponent(postId)}/${variant}?${signed.searchParams.toString()}`;
}

function GenerationPanel({ job, delivery, deliveryFailed, renderUrl, reelUrl, feedUrl, exportState }: {
  job: GenerationReview; delivery: Delivery | null; deliveryFailed: boolean; renderUrl: string;
  reelUrl: string; feedUrl: string; exportState: LoopExportView | null;
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
          {exportState?.state === "verified" && <p style={{ fontSize: "0.8rem" }}>
            Verified {exportState.reelWidth} × {exportState.reelHeight} Reel export. Derived from a {exportState.sourceWidth} × {exportState.sourceHeight} provider render{exportState.sourceUpscaled ? "; upscaled" : ""}{exportState.fit?.includes("no crop") ? ", full frame retained" : ""}. Review motion and loop seam before publishing.
          </p>}
          <video controls loop playsInline preload="metadata" poster={job.thumbnailUrl ?? undefined}
            style={{ width: "min(100%, 420px)", aspectRatio: "9 / 16", objectFit: "contain", background: "#151515", display: "block" }}>
            <source src={exportState?.state === "verified" ? reelUrl : job.videoUrl} type="video/mp4" />
            Your browser cannot play this video.
          </video>
          <p style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
            <a href={exportState?.state === "verified" ? reelUrl : job.videoUrl} target="_blank" rel="noopener noreferrer">{exportState?.state === "verified" ? "Open or download Reel MP4" : "Open or download video"}</a>
            {exportState?.state === "verified" && <> · <a href={feedUrl} target="_blank" rel="noopener noreferrer">Download 4:5 feed MP4</a></>}
            {job.durationSec ? ` · ${job.durationSec} seconds` : ""}
          </p>
          {exportState?.state === "verified" && <details style={{ fontSize: "0.78rem" }}><summary>Provider source</summary>
            <p>The exports were derived from the provider render. <a href={job.videoUrl} target="_blank" rel="noopener noreferrer">Open original provider video</a>.</p>
          </details>}
          {exportState?.state === "invalid" && <p role="status" style={{ fontSize: "0.8rem", color: "#765b16" }}>
            The saved video export could not be verified. The original provider preview is shown above.
          </p>}
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

type CarouselSlideView = { state: "ready" | "preview" | "pending" | "failed"; detail: string; job: GenerationReview | null };
const carouselBeats = ["Setup", "Turn", "Payoff"] as const;

async function CarouselReviewRoom({ shop, parentPostId, githubRepo, token, exp }: {
  shop: string; parentPostId: string; githubRepo: string; token: string; exp: string;
}) {
  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  let manifest: GenerationCarousel | null = null;
  let views: CarouselSlideView[] = [];
  let boundPost: SocialPost | null = null;
  let notes: Awaited<ReturnType<typeof listNotes>> = [];
  try {
    ({ manifest, views, notes, boundPost } = await runWithTenant({ shop, storeSlug, githubRepo }, async () => {
      const manifest = await loadGenerationCarousel(socialRepo, parentPostId);
      if (!manifest) return { manifest: null, views: [], notes: [], boundPost: null };
      const views = await Promise.all(manifest.slides.map(async (slide): Promise<CarouselSlideView> => {
        try {
          const input = await readGenerationInput(socialRepo, slide.artifactId);
          if (input.inputHash !== slide.inputHash || input.plan.postId !== slide.postId ||
              input.plan.mechanic !== "collection-scene" || input.plan.sceneComposition !== "single-artwork")
            throw new Error("Carousel source binding changed");
          const job = await loadGenerationJobForPost(slide.postId);
          if (!job) return { state: "pending", detail: "Generation has not started.", job: null };
          if (job.artifactId !== slide.artifactId || job.inputHash !== slide.inputHash ||
              job.mechanic !== "collection-scene" || generationDeliveryRepoFromPreview(job) !== githubRepo)
            throw new Error("Carousel job binding changed");
          if (job.state === "failed" || job.state === "declined")
            return { state: "failed", detail: "Generation stopped before this slide was ready.", job };
          if (job.state !== "succeeded" || !job.imageUrl)
            return { state: "pending", detail: "Generation is in progress. Reload to check status.", job };
          const delivery = await loadGenerationDelivery(socialRepo, job);
          if (!delivery?.scene) return { state: "pending", detail: "Background rendered; exact artwork composition is pending.", job };
          if (slide.finalImage) {
            await readPersistedCarouselImage(socialRepo, slide);
            return { state: "ready", detail: "Final image ready for review.", job };
          }
          return { state: "preview", detail: "Composed preview available; the immutable final image is still pending.", job };
        } catch {
          return { state: "failed", detail: "This slide's source or delivery receipt could not be verified.", job: null };
        }
      }));
      const bound = await socialRepo.readFile(postPath(parentPostId));
      return { manifest, views, notes: await listNotes(SOCIAL_PACK_ID, parentPostId), boundPost: bound ? parsePost(bound) : null };
    }));
  } catch { return <Gate headline="Carousel review unavailable" sub="The ordered slides could not be verified. Reload this page or ask for a fresh link." />; }
  if (!manifest) return <Gate headline="Carousel review unavailable" sub="No carousel manifest is available for this post yet." />;
  const ttl = ttlRemaining(exp);
  const month = manifest.parentPostId.match(/^(\d{4}-(?:0[1-9]|1[0-2]))-/)?.[1];
  const sheet = month ? socialCarouselSheetLink(shop, month, githubRepo, ttl) : null;
  const qs = new URLSearchParams({ shop, repo: githubRepo, t: token, e: exp });
  const ready = views.filter(v => v.state === "ready").length;
  return <main style={{ maxWidth: 1100, margin: "2.5rem auto 5rem", padding: "0 1.25rem", fontFamily: "system-ui, sans-serif" }}>
    <header style={{ marginBottom: "1.5rem" }}>
      <p style={{ fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.6 }}>Social review · three-slide carousel</p>
      <h1 style={{ fontSize: "1.5rem", margin: "0.35rem 0" }}>{parentPostId}</h1>
      {sheet && <p style={{ fontSize: "0.85rem" }}><a href={sheet.url}>See the whole month ({month})</a></p>}
      <p role="status" style={{ fontSize: "0.9rem" }}>{ready === 3 ? "All three slides are ready for review." : `${ready} of 3 final slides ready. The carousel is incomplete.`}</p>
      {boundPost && <p style={{ fontSize: "0.9rem" }}>Instagram {boundPost.channelAccount ? `@${boundPost.channelAccount.username}` : ""} · {boundPost.status}
        {boundPost.scheduledAt && boundPost.status === "scheduled" ? ` · ${boundPost.scheduledAt}` : ""}
        {boundPost.platform?.permalink && <> · <a href={boundPost.platform.permalink}>View published carousel</a></>}</p>}
    </header>
    <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }}>
      {manifest.slides.map((slide, index) => {
        const view = views[index]!;
        const url = `/api/social/carousel/render/${encodeURIComponent(parentPostId)}/${index + 1}?${qs}`;
        return <article key={slide.artifactId} style={{ border: "1px solid rgba(0,0,0,0.14)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "0.7rem 0.9rem", fontSize: "0.85rem" }}><strong>Slide {index + 1} · {carouselBeats[index]}</strong>{slide.artistCredit && <span> · {slide.artistCredit}</span>}</div>
          {(view.state === "ready" || view.state === "preview") ? <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Slide ${index + 1} of the carousel: verified artwork in its composed scene`} width={1080} height={1350}
              style={{ display: "block", width: "100%", height: "auto", aspectRatio: "4 / 5", objectFit: "contain", background: "#f4f2ef" }} />
            <p style={{ padding: "0.7rem 0.9rem", margin: 0, fontSize: "0.8rem" }}><a href={url} target="_blank" rel="noopener noreferrer">{view.state === "ready" ? "Open or download final image" : "Open composed preview"}</a></p>
            {view.state === "preview" && <p role="status" style={{ padding: "0 0.9rem", fontSize: "0.8rem", color: "#765b16" }}>{view.detail}</p>}
          </> : <div role="status" style={{ aspectRatio: "4 / 5", background: "#f4f2ef", padding: "1rem", display: "grid", placeItems: "center", fontSize: "0.85rem", textAlign: "center" }}>{view.detail}</div>}
          {view.job?.sourcePreviewUrl && <p style={{ padding: "0 0.9rem", fontSize: "0.75rem" }}><a href={view.job.sourcePreviewUrl} target="_blank" rel="noopener noreferrer">Review verified artwork source</a></p>}
        </article>;
      })}
    </div>
    <section style={{ maxWidth: 720, marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1rem" }}>Caption for the complete carousel</h2>
      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{manifest.caption}</p>
      <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>Review all three slides in order. Publishing requires a separate approval.</p>
    </section>
    {ready === 3 && <SocialPublishing postId={parentPostId} manifestHash={carouselManifestHash(manifest)} />}
    <SocialReviewNotes groupKey={parentPostId} shop={shop} token={token} exp={exp} repo={githubRepo}
      endpoint="/api/social/carousel/review-notes" initial={notes} slots={manifest.slides.map((slide) => slide.postId)} />
    <p style={{ fontSize: "0.75rem", opacity: 0.55, marginTop: "2rem" }}>This link works for about {ttl} more day{ttl === 1 ? "" : "s"}.</p>
  </main>;
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
  const githubRepo = one(sp.repo);

  if (!shop) {
    return <Gate headline="This link is incomplete" sub="It is missing the store it belongs to. Ask for a fresh link." />;
  }
  const verdict = githubRepo !== null
    ? verifyCarouselReviewLink(shop, id, githubRepo, token, exp)
    : verifyLink("review", shop, id, token, exp);
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

  if (githubRepo !== null) return <CarouselReviewRoom shop={shop} parentPostId={id} githubRepo={githubRepo} token={token!} exp={exp!} />;

  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  const publicUrl = (process.env.MOS_AGENTS_PUBLIC_URL ?? "").replace(/\/$/, "");
  const { group, notes, generationJobs, generationUnavailable, deliveries, loopExports } = await runWithTenant({ shop, storeSlug }, async () => {
    const group = await loadPostGroup(shop, id);
    const postIds = group.posts.length > 0 ? [...new Set(group.posts.map((member) => member.post.id))] : [id];
    let generationUnavailable = false;
    const lookedUp = await Promise.all(postIds.map(async (postId) => {
      try { return await loadGenerationJobForPost(postId); }
      catch { generationUnavailable = true; return null; }
    }));
    const generationJobs = lookedUp.filter((job): job is GenerationReview => job !== null);
    const deliveries = new Map<string, DeliveryResult>();
    const loopExports = new Map<string, LoopExportView>();
    for (const job of generationJobs) {
      try {
        const delivery = await loadGenerationDelivery(socialRepo, job);
        deliveries.set(job.id, { delivery, failed: false });
      } catch { deliveries.set(job.id, { delivery: null, failed: true }); }
      if (job.mechanic === "artwork-loop" && job.state === "succeeded" && job.videoUrl) {
        try {
          const githubRepo = generationDeliveryRepoFromPreview(job);
          const result = await runWithTenant({ shop, storeSlug, githubRepo }, async () => {
            const raw = await socialRepo.readFile(loopExportManifestPath(job.artifactId));
            if (raw === null) return { state: "legacy" as const };
            const reel = await loadVerifiedLoopExport(socialRepo, job, "reel");
            await loadVerifiedLoopExport(socialRepo, job, "feed");
            return { state: "verified" as const, sourceWidth: reel.sourceWidth, sourceHeight: reel.sourceHeight,
              sourceUpscaled: reel.sourceUpscaled, reelWidth: reel.width, reelHeight: reel.height, fit: reel.fit };
          });
          loopExports.set(job.id, result);
        } catch { loopExports.set(job.id, { state: "invalid" }); }
      }
    }
    return { group, notes: await listNotes(SOCIAL_PACK_ID, id), generationJobs, generationUnavailable, deliveries, loopExports };
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

  const boundArtifacts = new Set(group.posts.flatMap(({ post }) =>
    post.renderedVideo && "origin" in post.renderedVideo ? [post.renderedVideo.artifactId] : []));
  const generationPanel = (job: GenerationReview) => <GenerationPanel key={job.id} job={job}
    delivery={deliveries.get(job.id)?.delivery ?? null} deliveryFailed={deliveries.get(job.id)?.failed ?? false}
    renderUrl={sceneRenderUrl(shop, job.postId, ttl)}
    reelUrl={loopExportUrl(shop, job.postId, ttl, "reel")} feedUrl={loopExportUrl(shop, job.postId, ttl, "feed")}
    exportState={loopExports.get(job.id) ?? null} />;

  return (
    <main style={{ maxWidth: 1100, margin: "2.5rem auto 5rem", padding: "0 1.25rem", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ marginBottom: "1.75rem" }}>
        <p style={{ fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.6, margin: 0 }}>
          {group.posts.length > 1 ? `Social review · ${group.posts.length} versions` : "Social review"}
        </p>
        <h1 style={{ fontSize: "1.5rem", margin: "0.35rem 0 0" }}>{reviewTitle(group.posts[0]?.post ?? null, id)}</h1>
        {sheet && (
          <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
            <a href={sheet.url}>See the whole month ({month})</a>
          </p>
        )}
      </header>

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

      {/* Once a post carries the finished creative, the brief, source and export
          receipts are reference material — one link, below the decision. */}
      {generationJobs.filter((job) => !boundArtifacts.has(job.artifactId)).map((job) => generationPanel(job))}

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
              <PostDecision postId={post.id} kind={postKind(post)} account={post.channelAccount?.username ?? null}
                status={post.status} when={post.platform?.publishedAt ?? post.scheduledAt ?? post.plannedAt ?? null}
                caption={latestCopy} permalink={post.platform?.permalink ?? null} />
              {assets.length > 0 ? (
                <section aria-label={`${post.channel} final creative`}>
                  {video && (
                    <div>
                      <video controls loop playsInline preload="metadata" poster={video.poster.url}
                        width={video.video.width} height={video.video.height}
                        style={{ width: "100%", maxWidth: 420, height: "auto", margin: "0 auto", background: "#111", display: "block" }}>
                        <source src={video.video.url} type={video.video.mimeType} />
                        Your browser cannot play this video.
                      </video>
                      <p style={{ padding: "0.7rem 0.85rem", margin: 0, fontSize: "0.85rem" }}>
                        <a href={video.video.url} target="_blank" rel="noopener noreferrer">Open or download video</a>
                      </p>
                      <details style={{ padding: "0 0.85rem 0.85rem", fontSize: "0.8rem", overflowWrap: "anywhere" }}>
                        <summary>Details</summary>
                        <p>1080 × 1920 Reel · {(video.video.durationMs / 1000).toFixed(1)} seconds · {"origin" in video ? video.artifactId : video.storyboardId}</p>
                        <p>Input hash: <code>{"origin" in video ? video.inputHash : video.storyboardHash}</code></p>
                        <p>Review hash: <code>{"origin" in video ? video.deliveryHash : video.reviewHash}</code></p>
                        <p>Video SHA-256: <code>{video.video.sha256}</code></p>
                        <p>Cover SHA-256: <code>{video.poster.sha256}</code></p>
                        <p>{video.sources.length} source artwork{video.sources.length === 1 ? "" : "s"} bound in the render receipt</p>
                        {generation && generationPanel(generation)}
                      </details>
                    </div>
                  )}
                  {sequence && (
                    <div style={{ padding: "0.85rem", background: "#f4f2ef", fontSize: "0.8rem", lineHeight: 1.5, overflowWrap: "anywhere" }}>
                      <strong>{assets.length} slide{assets.length === 1 ? "" : "s"} · publication order</strong>
                      <p style={{ margin: "0.25rem 0 0" }}>{"origin" in sequence ? "Verified generation delivery" : `Storyboard: ${sequence.storyboardId}`}</p>
                      <p style={{ margin: "0.25rem 0 0" }}>These rendered slides are the final creative for review.</p>
                      <details style={{ marginTop: "0.5rem" }}>
                        <summary>Render provenance</summary>
                        <dl style={{ marginBottom: 0 }}>
                          <dt>{"origin" in sequence ? "Manifest hash" : "Storyboard hash"}</dt>
                          <dd style={{ margin: "0 0 0.5rem", fontFamily: "monospace" }}>{"origin" in sequence ? sequence.manifestHash : sequence.storyboardHash}</dd>
                          <dt>{"origin" in sequence ? "Delivery hashes" : "Review hash"}</dt>
                          <dd style={{ margin: 0, fontFamily: "monospace" }}>{"origin" in sequence ? sequence.deliveryHashes.join(" · ") : sequence.reviewHash}</dd>
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
                <p style={{ fontSize: "0.8rem", margin: 0, opacity: 0.75, wordBreak: "break-all" }}>
                  Links to {post.targetLink}
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
