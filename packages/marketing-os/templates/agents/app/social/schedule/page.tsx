import Link from "next/link";
import { socialRepo } from "../../../lib/social/repo";
import type { SocialPost } from "../../../lib/social/types";
import { parsePost } from "../../../lib/social/artifacts";
import { approvalHash } from "../../../lib/social/actions";
import { SocialScheduling } from "../../../components/review/social-scheduling";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function ScheduleReview({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const query = await searchParams, month = /^\d{4}-\d{2}$/.test(query.month ?? "") ? query.month! : new Date().toISOString().slice(0, 7);
  const paths = await socialRepo.list("social/posts/");
  const posts = (await Promise.all(paths.filter(path => path.endsWith("/post.md")).map(async path => {
    const raw = await socialRepo.readFile(path); return raw ? parsePost(raw) : null;
  }))).filter((post): post is SocialPost => !!post && !!post.plannedAt?.startsWith(month) && ["asset_ready", "scheduled", "published", "failed"].includes(post.status));
  const ready = posts.filter(post => post!.status === "asset_ready" && Date.parse(post!.plannedAt!) > Date.now() && (post!.renderedSequence || post!.renderedVideo));
  const entries = ready.map(post => ({ postId: post!.id, scheduledAt: post!.plannedAt!, expectedMaterialHash: approvalHash({ ...post!, scheduledAt: post!.plannedAt }) }));
  const timeZone = process.env.SOCIAL_CALENDAR_TIME_ZONE ?? "UTC";
  posts.sort((a, b) => a!.plannedAt!.localeCompare(b!.plannedAt!));
  return <main style={{ maxWidth: 1100, margin: "2rem auto", padding: "0 1rem" }}>
    <Link href={`/calendar?month=${month}`}>← Calendar</Link><h1>Social publishing · {month}</h1>
    <p>Planned posts become scheduled only after approval. All times shown in {timeZone}.</p>
    <SocialScheduling entries={entries} />
    {!posts.length && <p>No dated social posts are ready yet.</p>}
    {posts.map(post => { const p = post!; return <article key={p.id} style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: 8, marginBottom: "1.5rem" }}>
      <h2>{new Date(p.scheduledAt ?? p.plannedAt!).toLocaleString("en-US", { timeZone, dateStyle: "full", timeStyle: "short" })} · {p.renderedVideo ? "Artwork loop" : "Three-slide carousel"}</h2>
      <p>Instagram @{p.channelAccount?.username} · {p.status === "asset_ready" ? "Planned · awaiting approval" : p.status}</p>
      {p.renderedVideo ? <video controls loop playsInline preload="metadata" poster={p.renderedVideo.poster.url} src={p.renderedVideo.video.url} style={{ width: "min(100%, 300px)", aspectRatio: "9/16" }} /> :
        <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>{p.renderedSequence?.slides.map((s, i) => <figure key={s.sha256} style={{ margin: 0, flex: "1 0 220px", maxWidth: 340 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}<img src={s.url} alt={`Slide ${i + 1}`} style={{ width: "100%", aspectRatio: "4/5", objectFit: "contain" }} /><figcaption>Slide {i + 1}</figcaption></figure>)}</div>}
      <h3>Complete caption</h3><p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{p.copy}</p>
      {p.platform?.permalink && <a href={p.platform.permalink}>View published post</a>}
      {p.failure && <p role="status">{p.failure}</p>}
    </article>; })}
  </main>;
}
