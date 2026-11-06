import Link from "next/link";
import {Suspense} from "react";
import {PageHeader,Chip,EmptyState} from "@/components/primitives";
import {AutomationOverview} from "@/components/automation-overview";
import {readSocialDashboard,dashboardPost} from "@/lib/social/dashboard";
import {SOCIAL_STAGES,SOCIAL_STAGE_LABELS,socialStoryPrompt,type SocialStage} from "@/lib/social/workflow";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const tz=process.env.SOCIAL_CALENDAR_TIME_ZONE??"UTC";
const date=(value:string)=>new Date(value).toLocaleString("en-US",{timeZone:tz,dateStyle:"medium",timeStyle:"short"});
async function PostBoard({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const sp=await searchParams,get=(key:string)=>Array.isArray(sp[key])?sp[key][0]:sp[key];
  const current=new Date().toLocaleDateString("en-CA",{timeZone:tz}).slice(0,7);
  const month=MONTH.test(get("month")??"")?get("month")!:current;
  const stage=SOCIAL_STAGES.includes(get("stage") as SocialStage)?get("stage")!:get("stage")==="all"?"all":"active";
  const page=Math.min(1000,Math.max(1,Number.parseInt(get("page")??"1",10)||1));
  const data=await readSocialDashboard(month,stage,page);
  if(!data)return <div role="status" className="border border-hairline p-5">The post index is unavailable. Production controls above remain separate; this is not a report of zero posts.</div>;
  const counts=Object.fromEntries(SOCIAL_STAGES.map(s=>[s,data.summary.filter(r=>r.month===month&&r.stage===s).reduce((n,r)=>n+r.n,0)]));
  const months=[...new Set([current,...data.summary.map(r=>r.month)])].filter(m=>MONTH.test(m)).sort().reverse();
  const total=Object.values(counts).reduce((n,v)=>n+v,0),filtered=stage==="all"?total:stage==="active"?total-counts.closed:counts[stage];
  const last=data.summary.filter(r=>r.stage==="published"&&r.last_published).map(r=>String(r.last_published instanceof Date?r.last_published.toISOString():r.last_published)).sort().at(-1);
  const href=(s=stage,m=month,p=1)=>`/social?${new URLSearchParams({month:m,stage:s,page:String(p)})}`;
  return <>
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Published this month",counts.published],["Scheduled",counts.scheduled],["Drafts and prepared media",counts.draft+counts.ready],["Post issues",counts.attention]].map(([label,n])=><div key={label} className="border border-hairline bg-raised p-5"><p className="text-xs text-ink-3">{label}</p><p className="mt-2 font-display text-3xl">{n}</p></div>)}</div>
    <p className="mb-6 text-sm text-ink-2">{last?`Last recorded publication: ${date(last)}.`:"No publication receipt is recorded yet."} A draft or completed generation is not a published post.</p>
    <div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="mr-auto font-display text-2xl">Posts</h2><nav aria-label="Social month" className="flex flex-wrap gap-2">{months.map(m=><Link key={m} href={href(stage,m)} prefetch={false} aria-current={month===m?"page":undefined}><Chip variant={m===month?"filled":"outline"}>{m}</Chip></Link>)}</nav></div>
    <nav aria-label="Post workflow stage" className="mb-5 flex flex-wrap gap-2">{[{id:"active",label:"Current work",n:total-counts.closed},{id:"all",label:"All posts",n:total},...SOCIAL_STAGES.map(s=>({id:s,label:SOCIAL_STAGE_LABELS[s],n:counts[s]}))].map(s=><Link key={s.id} href={href(s.id)} prefetch={false} aria-current={stage===s.id?"page":undefined} className={`border px-3 py-2 text-sm ${stage===s.id?"border-ink bg-inverse text-page":"border-hairline"}`}>{s.label} · {s.n}</Link>)}</nav>
    {!data.rows.length?<EmptyState headline="No posts in this view." sub="The production panel above shows whether the next batch is being generated or needs attention."/>:<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.rows.map(row=>{
      const {post,workflow,thumbnail}=dashboardPost(row),detail=`/social/posts/${encodeURIComponent(post.id)}`;
      const at=workflow.stage==="published"?post.platform?.publishedAt:post.scheduledAt??post.plannedAt;
      return <article key={post.id} className="flex flex-col border border-hairline bg-raised">
        <Link href={detail} prefetch={false} aria-label={`Open ${post.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thumbnail?<img src={thumbnail} alt="Post artwork" width={540} height={360} loading="lazy" className="h-48 w-full border-b border-hairline object-contain"/>:<div className="flex h-28 items-center justify-center border-b border-hairline text-sm text-ink-3">Media in production</div>}
        </Link><div className="flex flex-1 flex-col p-4"><div className="mb-3"><Chip variant={workflow.variant}>{workflow.label}</Chip></div><h3 className="mb-2 line-clamp-3 font-display text-lg"><Link href={detail} prefetch={false}>{post.copy.split("\n").find(l=>l.trim())??post.id}</Link></h3><p className="mb-3 text-sm text-ink-2">{workflow.stage==="draft"?"Planned content. It is not scheduled or published.":workflow.stage==="ready"?"Media and copy are prepared; this post has not entered the release queue.":workflow.explanation}</p>{at&&<p className="mb-3 text-xs text-ink-3">{workflow.stage==="published"?"Published":post.scheduledAt?"Release":"Proposed"}: {date(at)}</p>}<div className="mt-auto flex gap-4 pt-3 text-sm"><Link href={detail} prefetch={false} className="arrow-link">View post</Link>{workflow.stage==="published"&&post.platform?.permalink&&<a href={post.platform.permalink} target="_blank" rel="noreferrer" className="arrow-link">View on Instagram</a>}</div></div></article>;
    })}</div>}
    <nav aria-label="Post pages" className="mt-6 flex justify-between text-sm">{page>1?<Link href={href(stage,month,page-1)} prefetch={false}>← Previous posts</Link>:<span/>}<span>Page {page} · {filtered} posts</span>{page*24<filtered?<Link href={href(stage,month,page+1)} prefetch={false}>Next posts →</Link>:<span/>}</nav>
    <p className="mt-4 text-xs text-ink-3">Times shown in {tz}. The calendar defaults to scheduled and published content. Post details read the current source before any action.</p>
  </>;
}
export default function SocialPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  return <div className="px-4 py-8 sm:px-8 sm:py-10"><div className="mx-auto max-w-[1200px]">
    <PageHeader eyebrow="Social" title="Social dashboard" sub="What is live, what is scheduled, and what is happening to your next batch."/>
    <div className="mb-6 flex flex-wrap gap-5 text-sm"><Link href="/calendar" prefetch={false} className="arrow-link">Publishing calendar</Link><Link href="/social/backlog" prefetch={false} className="arrow-link">Production and hold controls</Link><Link href="/social/connections" prefetch={false} className="arrow-link">Instagram connection</Link><Link href={`/chat?prompt=${encodeURIComponent(socialStoryPrompt())}`} prefetch={false} className="arrow-link">Develop a story</Link></div>
    <AutomationOverview channel="social"/>
    <Suspense fallback={<p role="status" className="py-8 text-sm text-ink-3">Loading post totals and recent posts…</p>}><PostBoard searchParams={searchParams}/></Suspense>
  </div></div>;
}
