import Link from "next/link";
import { PageHeader, Chip, EmptyState } from "@/components/primitives";
import { CopyLink } from "@/components/copy-link";
import { getTenant } from "@/lib/tenant-context";
import { socialSheetLink } from "@/lib/social/review-links";
import { calendarHrefFor } from "@/lib/calendar/review-routes";
import { postMonth, postThumbnailUrl } from "@/lib/social/projection";
import { listPostIds, parsePost, postPath } from "@/lib/social/artifacts";
import { socialRepo } from "@/lib/social/repo";
import { SOCIAL_STAGES, SOCIAL_STAGE_LABELS, socialWorkflow, socialStoryPrompt } from "@/lib/social/workflow";
import type { SocialStage } from "@/lib/social/workflow";
import type { SocialPost } from "@/lib/social/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function monthLabel(month: string) {
  return MONTH_RE.test(month) ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "Undated work";
}
function headline(post: SocialPost) {
  return post.copy.split("\n").map(line => line.trim()).find(Boolean) || `Post ${post.id}`;
}
export default async function SocialPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams, value = (key: string) => Array.isArray(sp[key]) ? sp[key][0] : sp[key];
  const { shop } = getTenant(), timeZone = process.env.SOCIAL_CALENDAR_TIME_ZONE ?? "UTC", now = Date.now();
  const ids = await listPostIds(socialRepo), posts: SocialPost[] = []; let unreadable = 0;
  // Posts are truth, including work that has never entered a calendar slot.
  for (const id of ids) {
    try { const raw = await socialRepo.readFile(postPath(id)); if (raw !== null) posts.push(parsePost(raw)); }
    catch { unreadable++; }
  }
  const months = [...new Set(posts.map(postMonth))].sort().reverse();
  const current = new Date(now).toLocaleDateString("en-CA", { timeZone }).slice(0, 7);
  const requested = value("month"), month = requested && (MONTH_RE.test(requested) || requested === "unscheduled") ? requested : months.includes(current) ? current : months[0] ?? current;
  const requestedStage = value("stage"), stage = SOCIAL_STAGES.includes(requestedStage as SocialStage) ? requestedStage as SocialStage : "all";
  const monthPosts = posts.filter(post => postMonth(post) === month);
  const counts = Object.fromEntries(SOCIAL_STAGES.map(s => [s, monthPosts.filter(post => socialWorkflow(post, now).stage === s).length]));
  const visible = monthPosts.filter(post => stage === "all" || socialWorkflow(post, now).stage === stage)
    .sort((a, b) => (a.scheduledAt ?? a.plannedAt ?? a.id).localeCompare(b.scheduledAt ?? b.plannedAt ?? b.id));
  const href = (s: string, m = month) => `/social?${new URLSearchParams({ month: m, stage: s })}`;
  return <main className="px-4 py-8 sm:px-8 sm:py-10"><div className="mx-auto max-w-[1200px]">
    <PageHeader eyebrow="Social" title="Your social publishing workflow" sub="See what needs review, what will publish automatically, and what is already live." />
    <div className="mb-6 flex flex-wrap gap-5 text-[14px]">
      <Link className="arrow-link" href={`/chat?prompt=${encodeURIComponent(socialStoryPrompt())}`}>Develop a story</Link>
      <Link className="arrow-link" href={`/social/schedule?month=${MONTH_RE.test(month) ? month : current}`}>Review media and approve schedules</Link>
      <Link className="arrow-link" href={`/calendar?month=${MONTH_RE.test(month) ? month : current}`}>Open publishing calendar</Link>
    </div>
    <nav aria-label="Social month" className="mb-5 flex flex-wrap items-center gap-2">
      {months.map(m => <Link key={m} href={href(stage, m)} aria-current={month === m ? "page" : undefined}><Chip variant={month === m ? "filled" : "outline"}>{monthLabel(m)}</Chip></Link>)}
    </nav>
    <h2 className="mb-3 font-display text-[23px]">{monthLabel(month)}</h2>
    <nav aria-label="Post workflow stage" className="mb-5 flex flex-wrap gap-2">
      {[{ id: "all", label: "All posts", count: monthPosts.length }, ...SOCIAL_STAGES.map(s => ({ id: s, label: SOCIAL_STAGE_LABELS[s], count: counts[s] }))].map(s =>
        <Link key={s.id} href={href(s.id)} aria-current={stage === s.id ? "page" : undefined} className="border border-hairline bg-raised px-3 py-2 text-[13px] hover:border-gold">
          <span className={stage === s.id ? "font-semibold text-ink" : "text-ink-2"}>{s.label}</span> <span className="tnum text-ink-3">{s.count}</span>
        </Link>)}
    </nav>
    <p className="mb-5 text-[13px] text-ink-3">Draft proposals and prepared media do not publish automatically. Only approved schedules enter the release queue. Times shown in {timeZone}.</p>
    {unreadable > 0 && <p role="status" className="mb-4 text-sm">{unreadable} post record(s) could not be read. They are not included in the counts.</p>}
    {MONTH_RE.test(month) && <details className="mb-6 text-[13px] text-ink-3"><summary className="cursor-pointer">Share this month for read-only review</summary><div className="mt-3"><CopyLink url={socialSheetLink(shop, month).url} label={`Share ${monthLabel(month)} for review`} /></div></details>}
    {!visible.length ? <EmptyState headline="No posts in this view." sub="Choose another stage or develop a story with your agent." /> :
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map(post => {
        const state = socialWorkflow(post, now), thumbnail = postThumbnailUrl(post, process.env.MOS_AGENTS_PUBLIC_URL ?? ""), detail = `/social/posts/${encodeURIComponent(post.id)}`;
        const date = state.stage === "published" ? post.platform?.publishedAt ?? post.scheduledAt : post.scheduledAt ?? post.plannedAt;
        const dateLabel = state.stage === "published" ? "Published" : post.scheduledAt ? "Release" : "Suggested";
        const format = post.renderedVideo ? "Video loop" : post.renderedSequence ? `${post.renderedSequence.slides.length}-slide carousel` : "Draft creative";
        return <article key={post.id} className="flex flex-col border border-hairline bg-raised">
          <Link href={detail} aria-label={`Open post: ${headline(post)}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumbnail ? <img src={thumbnail} alt={headline(post)} className="h-52 w-full border-b border-hairline object-contain" loading="lazy" /> : <div className="flex h-24 items-center justify-center border-b border-hairline text-sm text-ink-3">Media not prepared yet</div>}
          </Link>
          <div className="flex flex-1 flex-col p-4">
            <div className="mb-2"><Chip variant={state.variant}>{state.label}</Chip></div>
            <h3 className="mb-2 line-clamp-3 text-[16px] leading-snug"><Link href={detail}>{headline(post)}</Link></h3>
            <p className="mb-2 text-[12px] text-ink-3">{post.channel}{post.channelAccount ? ` · @${post.channelAccount.username}` : ""} · {format}</p>
            <p className="mb-3 text-[13px] leading-relaxed text-ink-2">{state.explanation}</p>
            {date && <p className="mb-3 text-[12px] text-ink-2">{dateLabel}: {new Date(date).toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" })}</p>}
            <div className="mt-auto flex flex-wrap gap-x-4 gap-y-2 border-t border-hairline pt-3 text-[13px]">
              {state.stage === "published" && post.platform?.permalink && <a className="arrow-link" href={post.platform.permalink} target="_blank" rel="noreferrer">View live post</a>}
              {state.stage === "ready" && <Link className="arrow-link" href={calendarHrefFor("social", post.id, shop) ?? detail}>Review this post</Link>}
              <Link className="arrow-link" href={detail}>{state.stage === "attention" ? "Check delivery record" : "Post details"}</Link>
              <Link className="arrow-link" href={`/chat?prompt=${encodeURIComponent(socialStoryPrompt(post.id))}`}>Improve story</Link>
            </div>
          </div>
        </article>;
      })}</div>}
  </div></main>;
}
