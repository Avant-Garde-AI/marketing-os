/** Owner-triggered, resumable production. One exact pre-reserved generation per request. */
import { NextRequest, NextResponse } from "next/server";
import { socialReviewOperator } from "../../../../lib/social/review-operator";
import { loadSocialBacklog } from "../../../../lib/social/backlog";
import { socialRepo } from "../../../../lib/social/repo";
import { hashPreview } from "../../../../lib/actions/hash";
import { proposeAction } from "../../../../lib/actions/propose";
import { loadSourceCamera } from "../../../../lib/social/source-camera";
import { instagramIdentity } from "../../../../lib/social/channels/instagram";
import { brokerTokenSource } from "../../../../lib/social/channels";
import { parsePost, postPath } from "../../../../lib/social/artifacts";
import { runWithTenant } from "../../../../lib/tenant-context";
import { apiBase, brokerHeaders } from "../../../../lib/broker-client";
import { generationRunHeaders, runWithGenerationActor } from "../../../../lib/social/generation-authority";
export const runtime = "nodejs";
export const maxDuration = 300;
const json = (body: unknown, status=200) => NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const tenant = () => { const shop=process.env.SHOPIFY_STORE_URL??"";return {shop,storeSlug:shop.replace(/\.myshopify\.com$/,""),githubRepo:process.env.GITHUB_REPO??null}; };
async function broker(path: string, init?: RequestInit) {
  const r=await fetch(`${apiBase()}${path}`,{...init,headers:{...brokerHeaders(),...init?.headers},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(init?240000:20000)});
  const body=await r.json().catch(()=>({}));
  if(!r.ok) throw Error(typeof body.message==="string"?body.message:"Production broker request did not complete. Inspect the existing job before retrying.");
  return body;
}
export async function GET(req: NextRequest) {
  if(!await socialReviewOperator()) return json({error:"Sign in to view production."},401);
  try {return await runWithTenant(tenant(),async()=>{
    const loaded=await loadSocialBacklog(socialRepo,req.nextUrl.searchParams.get("batch")??undefined);
    if(!loaded) return json({batch:null});
    const {batch,hash}=loaded;
    const months=[...new Set(batch.posts.map(p=>p.date.slice(0,7)))];
    const responses=await Promise.all(months.map(month=>broker(`/api/broker/social-generation?month=${month}`)));
    const jobs=responses.flatMap(r=>r.jobs??[]).filter((j:any)=>batch.generationJobs.some(expected=>expected.artifactId===j.artifactId));
    const posts=await Promise.all(batch.posts.map(async p=>{const raw=await socialRepo.readFile(postPath(p.id));const post=raw?parsePost(raw):null;return {id:p.id,date:p.date,caption:p.caption,plannedAt:post?.plannedAt??p.plannedAt,status:post?.status??"missing",camera:Boolean(p.cameraManifest)};}));
    return json({batch:{id:batch.id,range:batch.range,maximumCredits:batch.maximumCredits,reservedMaximumCredits:batch.reservedMaximumCredits,generationJobs:batch.generationJobs},hash,jobs,posts});
  });}catch{return json({error:"Production state could not be verified. No generation or publication was requested."},409);}
}
export async function POST(req:NextRequest){
  if(req.headers.get("origin")!==req.nextUrl.origin)return json({error:"Same-origin request required"},403);
  const user=await socialReviewOperator();if(!user)return json({error:"Sign in to run production."},401);
  const body=await req.json().catch(()=>null);
  try{return await runWithTenant(tenant(),async()=>{
    if(!["generate","bind-camera"].includes(body?.operation)||typeof body.batchId!=="string"||typeof body.expectedBatchHash!=="string")return json({error:"Invalid production request"},400);
    const loaded=await loadSocialBacklog(socialRepo,body.batchId);
    if(!loaded||loaded.hash!==body.expectedBatchHash)return json({error:"The batch changed. Reload the plan before spending credits."},409);
    if(body.operation==="bind-camera") {
      const row=loaded.batch.posts.find(p=>p.id===body.postId&&p.cameraManifest);
      if(!row)return json({error:"Camera post is outside this batch."},409);
      const raw=await socialRepo.readFile(postPath(row.id));if(!raw)return json({error:"Draft missing"},409);
      const post=parsePost(raw);
      if(post.status==="asset_ready"&&post.renderedVideo&&"origin" in post.renderedVideo&&post.renderedVideo.origin==="source-camera")return json({ok:true,state:"asset_ready",postId:post.id});
      const manifest=await loadSourceCamera(socialRepo,row.id),account=await instagramIdentity(brokerTokenSource);
      const proposal=await proposeAction({kind:"social.bind_source_camera",params:{postId:row.id,
        expectedDraftHash:hashPreview(post),expectedManifestHash:hashPreview(manifest),accountId:account.id,accountUsername:account.username}});
      const base=process.env.MARKETING_OS_API_URL?.replace(/\/$/,""),secret=process.env.ACTIONS_GATE_SECRET;
      if(!base||!secret)throw Error("Approval gate unavailable");
      const decided=await fetch(`${base}/api/actions/review`,{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},
        body:JSON.stringify({proposalId:proposal.proposalId,approve:true,actor:`social-review:${user.id}`}),signal:AbortSignal.timeout(240000)});
      const result=await decided.json();
      return json({ok:decided.ok&&result.status==="executed",state:result.status,summary:result.message},decided.ok&&result.status==="executed"?200:409);
    }
    const job=loaded.batch.generationJobs.find(j=>j.artifactId===body.artifactId);
    if(!job)return json({error:"This generation is outside the approved batch reservation."},409);
    const actor={surface:"console" as const,subject:user.id};
    return runWithGenerationActor(actor,async()=>{
      const raw=JSON.stringify({action:"run",artifactId:job.artifactId,maximumCredits:job.maximumCredits,actor});
      const result=await broker("/api/broker/social-generation",{method:"POST",body:raw,headers:generationRunHeaders(raw,tenant().shop)});
      return json(result);
    });
  });}catch{return json({error:"Production did not finish. Refresh the existing job status before another request; no replacement job was created."},409);}
}
