"use client";
import {useCallback,useEffect,useRef,useState} from "react";
type Job={artifactId:string;state:string;generationJobId?:string;id?:string};
type State={batch:{id:string;range:{from:string;through:string};reservedMaximumCredits:number;maximumCredits:number;generationJobs:{artifactId:string;maximumCredits:number}[]}|null;hash:string;jobs:Job[];posts:{id:string;date:string;caption:string;status:string;plannedAt:string;camera:boolean}[]};
export function SocialBacklogProduction(){
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[progress,setProgress]=useState("");
 const stopping=useRef(false);
 const refresh=useCallback(async()=>{const r=await fetch("/api/social/backlog",{cache:"no-store"});const b=await r.json();if(!r.ok)throw Error(b.error??"Production unavailable");setState(b);return b as State;},[]);
 useEffect(()=>{refresh().catch(e=>setError(e.message));return()=>{stopping.current=true;};},[refresh]);
 async function produce(){if(!state?.batch)return;stopping.current=false;setBusy(true);setError("");try{
  const fresh=await refresh();if(fresh.hash!==state.hash||!fresh.batch)throw Error("The batch changed. Review it again before starting.");
  for(const [i,j]of fresh.batch.generationJobs.entries()){
   if(stopping.current)break;
   const known=fresh.jobs.find(k=>k.artifactId===j.artifactId);
   if(known){if(["submitted","succeeded"].includes(known.state))continue;throw Error(`${j.artifactId}: ${known.state}. Inspect this existing job before requesting another submission.`);}
   setProgress(`Submitting ${i+1} of ${fresh.batch.generationJobs.length}: ${j.artifactId}`);
   const r=await fetch("/api/social/backlog",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"generate",batchId:fresh.batch.id,expectedBatchHash:fresh.hash,artifactId:j.artifactId})});
   const b=await r.json();if(!r.ok||!["submitted","succeeded"].includes(b.state))throw Error(b.error??`Production stopped at ${j.artifactId} (${b.state??"unverified"}). Inspect the existing job; do not resubmit.`);
   await refresh();
  }
  setProgress(stopping.current?"Stopped. Submitted jobs continue; no replacements will be requested.":"Generation submissions complete. Final media checks, binding and scheduling still remain.");
 }catch(e){setError(e instanceof Error?e.message:"Production stopped");}finally{setBusy(false);await refresh().catch(()=>{});}}
 async function bindCameras(){if(!state?.batch)return;setBusy(true);setError("");try{for(const p of state.posts.filter(p=>p.camera&&p.status==="proposed")){
  setProgress(`Preparing source-preserving video: ${p.id}`);
  const r=await fetch("/api/social/backlog",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"bind-camera",batchId:state.batch.id,expectedBatchHash:state.hash,postId:p.id})});const b=await r.json();if(!r.ok||!b.ok)throw Error(b.error??b.summary??"Video preparation did not finish");await refresh();}
  setProgress("Source-preserving videos are ready. Use their post screens to approve exact release dates.");
 }catch(e){setError(e instanceof Error?e.message:"Video preparation stopped");}finally{setBusy(false);}}
 if(!state&&!error)return <p role="status" className="mt-6">Loading production records…</p>;
 return <section className="mt-6">{error&&<p role="alert" className="mb-5 text-red-700">{error}</p>}{state?.batch?<>
  <p>Fourteen daily drafts: {state.batch.range.from}–{state.batch.range.through}. Dates below are proposed until the existing scheduling gate approves them.</p>
  <p className="my-4">{state.batch.generationJobs.length} new generation jobs reserve at most <strong>{state.batch.reservedMaximumCredits} Higgsfield credits</strong>, within the {state.batch.maximumCredits}-credit batch budget. No automatic rerolls. Camera edits use existing rendered source pixels.</p>
  <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={bindCameras} className="border px-4 py-2">Prepare existing camera videos · no generation spend</button><button disabled={busy} onClick={produce} className="border border-ink bg-ink px-4 py-2 text-paper disabled:opacity-50">{busy?"Producing…":`Generate missing media · up to ${state.batch.reservedMaximumCredits} credits`}</button>{busy&&<button onClick={()=>{stopping.current=true;}} className="border px-4 py-2">Stop after current job</button>}<button disabled={busy} onClick={()=>refresh().catch(e=>setError(e.message))} className="border px-4 py-2">Refresh status</button></div>
  <p role="status" className="my-4">{progress||`${state.jobs.length} generation records. This screen does not enable recurring autopilot or approve publishing.`}</p>
  <ol className="space-y-4">{state.posts.map(p=><li key={p.id} className="border border-hairline p-4"><a href={`/social/posts/${p.id}`} className="font-semibold underline">{p.date} · {p.camera?"Artwork camera edit":"Artwork story"}</a><p className="my-2">{p.caption.split("\n")[0]}</p><p>Status: {p.status}</p></li>)}</ol>
  <details className="mt-6"><summary>Generation journal</summary>{state.batch.generationJobs.map(j=><p key={j.artifactId} className="mt-2 break-all text-sm">{j.artifactId} · {state.jobs.find(k=>k.artifactId===j.artifactId)?.state??"not requested"}</p>)}</details>
 </>:<p>No production backlog is configured for this store.</p>}</section>;
}
