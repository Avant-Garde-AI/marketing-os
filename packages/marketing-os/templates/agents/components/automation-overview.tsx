"use client";
import { useEffect, useRef, useState } from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import { describeAutomation, type AutomationStatus } from "@/lib/automation-status";
export function AutomationOverview({channel}:{channel?:"social"|"email"}={}) {
  const router=useRouter(), signature=useRef<string|null>(null);
  const [state,setState]=useState<Record<string,AutomationStatus> | null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    async function refresh() {
      try { const r=await fetch(`/api/automation/status${channel?`?channel=${channel}`:""}`,{cache:"no-store",signal:controller.signal}); if(!r.ok) throw Error("Could not read live automation status"); setState(await r.json()); }
      catch(e){ if(!controller.signal.aborted) setState({social:{error:e instanceof Error?e.message:"Status unavailable"},email:{error:"Could not read live automation status"}}); }
    }
    void refresh(); const id=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},30000);
    return ()=>{controller.abort();clearInterval(id);};
  },[channel]);
  useEffect(()=>{
    if(!state)return;
    const next=JSON.stringify(Object.entries(state).map(([key,value])=>[key,value.batches?.map(b=>[b.id,b.phase,b.scheduled,b.held??0,b.finishing?.complete,b.finishing?.total])]));
    if(signature.current!==null && signature.current!==next)router.refresh();
    signature.current=next;
  },[state,router]);
  return <section className="mb-8" aria-label="Live content automation">
    <div className="mb-3 flex items-baseline justify-between gap-4"><h2 className="font-display text-xl">{channel?"Automatic production":"Content on autopilot"}</h2><Link className="arrow-link text-sm" href="/calendar">Open calendar →</Link></div>
    <p className="mb-4 text-sm text-ink-3">Two-week backlogs run automatically within your policy. Finished batches arrive in Slack; Hold or Pause anything you don’t want to ship.</p>
    <div className={channel?"grid gap-4":"grid gap-4 md:grid-cols-2"}>{([['social','Instagram','/social/backlog'],['email','Email','/email']] as const).filter(([key])=>!channel||channel===key).map(([key,title,href])=>{
      const s=state?.[key] ?? null, d=describeAutomation(s);
      return <div key={key} className="border border-hairline bg-raised p-5"><div className="flex items-baseline justify-between gap-3"><h3 className="font-display text-lg">{title}</h3><span className={d.attention?'text-sm font-medium text-ink':'text-sm text-ink-2'}>{d.label}</span></div><p className="mt-3 text-sm text-ink-2" role="status">{d.detail}</p>{s?.batches?.[0]?.progress && <p className="mt-2 text-sm text-ink-2">Media jobs: {s.batches[0].progress.succeeded??0} complete · {(s.batches[0].progress.submitted??0)+(s.batches[0].progress.preparing??0)+(s.batches[0].progress.submitting??0)} in progress · {(s.batches[0].progress.failed??0)+(s.batches[0].progress.unknown??0)} blocked. Target: 28 jobs for 14 posts.</p>}{s?.batches?.[0]?.finishing && <p className="mt-2 text-sm text-ink-2">Final media: {s.batches[0].finishing.complete}/{s.batches[0].finishing.total} prepared. Artwork placement and video exports finish before posts enter the calendar.</p>}{!!s?.batches?.[0]?.held && <p className="mt-2 text-sm font-medium text-ink">{s.batches[0].held} held posts will not publish. The remaining posts continue automatically.</p>}{s?.grant?.policy?.firstPostDate && <p className="mt-2 text-xs text-ink-3">Planned first release: {s.grant.policy.firstPostDate}. Generation must finish before anything can be scheduled.</p>}{s?.worker && <p className="mt-2 text-xs text-ink-3">Worker checked {new Date(s.worker.checkedAt).toLocaleString()}</p>}<Link href={href} className="arrow-link mt-4 inline-block text-sm">View production and controls →</Link></div>;
    })}</div>
  </section>;
}
