"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { describeAutomation, type AutomationStatus } from "@/lib/automation-status";
export function AutomationOverview() {
  const [state,setState]=useState<Record<string,AutomationStatus> | null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    async function refresh() {
      try { const r=await fetch("/api/automation/status",{cache:"no-store",signal:controller.signal}); if(!r.ok) throw Error("Could not read live automation status"); setState(await r.json()); }
      catch(e){ if(!controller.signal.aborted) setState({social:{error:e instanceof Error?e.message:"Status unavailable"},email:{error:"Could not read live automation status"}}); }
    }
    void refresh(); const id=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},30000);
    return ()=>{controller.abort();clearInterval(id);};
  },[]);
  return <section className="mb-8" aria-label="Live content automation">
    <div className="mb-3 flex items-baseline justify-between gap-4"><h2 className="font-display text-xl">Content on autopilot</h2><Link className="arrow-link text-sm" href="/calendar">Open calendar →</Link></div>
    <p className="mb-4 text-sm text-ink-3">Two-week backlogs, prepared automatically. Review in Slack; Hold or Pause anything you don’t want to ship.</p>
    <div className="grid gap-4 md:grid-cols-2">{([['social','Instagram','/social/backlog'],['email','Email','/email']] as const).map(([key,title,href])=>{
      const s=state?.[key] ?? null, d=describeAutomation(s);
      return <div key={key} className="border border-hairline bg-raised p-5"><div className="flex items-baseline justify-between gap-3"><h3 className="font-display text-lg">{title}</h3><span className={d.attention?'text-sm font-medium text-ink':'text-sm text-ink-2'}>{d.label}</span></div><p className="mt-3 text-sm text-ink-2" role="status">{d.detail}</p>{s?.worker && <p className="mt-2 text-xs text-ink-3">Worker checked {new Date(s.worker.checkedAt).toLocaleString()}</p>}<Link href={href} className="arrow-link mt-4 inline-block text-sm">View production and controls →</Link></div>;
    })}</div>
  </section>;
}
