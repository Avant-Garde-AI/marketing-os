import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const m=vi.hoisted(()=>({files:new Map<string,string>(),operator:vi.fn(),propose:vi.fn(),save:vi.fn(),lock:vi.fn(),validate:vi.fn()}));
const repo={readFile:async(p:string)=>m.files.get(p)??null,writeFile:async(p:string,s:string)=>{m.files.set(p,s);m.save(p)},list:async()=>[...m.files.keys()]};
vi.mock("../templates/agents/lib/social/repo",()=>({socialRepo:{readFile:async(p:string)=>m.files.get(p)??null,writeFile:async(p:string,s:string)=>{m.files.set(p,s);m.save(p)},list:async()=>[...m.files.keys()]}}));
vi.mock("../templates/agents/lib/social/review-operator",()=>({socialReviewOperator:m.operator}));
vi.mock("../templates/agents/lib/actions/propose",()=>({proposeAction:m.propose}));
vi.mock("../templates/agents/lib/social/register-actions",()=>({socialActionDeps:()=>({repo:{readFile:async(p:string)=>m.files.get(p)??null,writeFile:async(p:string,s:string)=>{m.files.set(p,s);m.save(p)},list:async()=>[...m.files.keys()]},adapterFor:()=>({channel:"instagram",publish:vi.fn(),publishVideo:vi.fn()}),assetUrl:()=>"https://example.com/image.jpeg",withPostLock:m.lock,validateMaterial:m.validate})}));
import { socialScheduleBatchAction, scheduleBatchSchema } from "../templates/agents/lib/social/schedule-batch";
import { POST } from "../templates/agents/app/api/social/scheduling/route";
import { parsePost, serializePost,postPath } from "../templates/agents/lib/social/artifacts";
import { approvalHash,verifyScheduleConsent } from "../templates/agents/lib/social/actions";
import type { SocialPost } from "../templates/agents/lib/social/types";
const time="2099-01-04T15:00:00Z";
const post=(id:string):SocialPost=>({id,channel:"instagram",channelAccount:{id:"123",username:"store"},copy:"caption",targetLink:"https://store.example",assetRefs:[],status:"asset_ready",provenance:[],body:"",plannedAt:time,designSurface:{teamId:"team",fileId:"file"}});
const params=()=>({entries:["first","second"].map(id=>({postId:id,scheduledAt:time,expectedMaterialHash:approvalHash({...post(id),scheduledAt:time})}))});
const request=(body:any,origin="https://console.example")=>new NextRequest("https://console.example/api/social/scheduling",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify({operation:"propose",params:params(),...body})});
beforeEach(()=>{vi.clearAllMocks();m.validate.mockReset();vi.unstubAllGlobals();m.files.clear();for(const id of ["first","second"])m.files.set(postPath(id),serializePost(post(id)));m.lock.mockImplementation(async(_id,run)=>run());m.operator.mockResolvedValue({id:"verified"});m.propose.mockResolvedValue({proposalId:"mine",summary:"schedule"});vi.stubEnv("MARKETING_OS_API_URL","https://gate.example");vi.stubEnv("ACTIONS_GATE_SECRET","gate");vi.stubEnv("SHOPIFY_STORE_URL","store.myshopify.com")});
it("refuses duplicate posts",()=>expect(scheduleBatchSchema.safeParse({entries:[params().entries[0],params().entries[0]]}).success).toBe(false));
it("previews without writes and schedules every exact post through the shared locks",async()=>{
 const action=socialScheduleBatchAction();const preview=await action.preview(params());expect(preview.rows).toHaveLength(2);expect(m.save).not.toHaveBeenCalled();
 await action.execute(params());expect(m.lock).toHaveBeenCalledTimes(2);for(const id of ["first","second"]){const p=parsePost(m.files.get(postPath(id))!);expect(p.status).toBe("scheduled");expect(await verifyScheduleConsent(p,{})).toEqual({ok:true});}
 await action.execute(params());expect(m.save).toHaveBeenCalledTimes(2);
});
it("rejects any changed caption, time or destination before writing the set",async()=>{m.files.set(postPath("second"),serializePost({...post("second"),copy:"edited"}));await expect(socialScheduleBatchAction().execute(params())).rejects.toThrow("changed");expect(m.save).not.toHaveBeenCalled()});
it("rejects unauthenticated or cross-site approval",async()=>{m.operator.mockResolvedValue(null);expect((await POST(request({}))).status).toBe(401);expect((await POST(request({},"https://other.example"))).status).toBe(403);expect(m.propose).not.toHaveBeenCalled()});
it("refuses approval of another batch",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>Response.json({proposals:[{id:"mine",kind:"social.schedule_batch",params:{entries:[params().entries[0]]}}]})));expect((await POST(request({operation:"decide",approve:true,proposalId:"mine"}))).status).toBe(409);expect(fetch).toHaveBeenCalledTimes(1)});
it("uses the verified actor and shows gate failures honestly",async()=>{const f=vi.fn().mockResolvedValueOnce(Response.json({proposals:[{id:"mine",kind:"social.schedule_batch",params:params()}]})).mockResolvedValueOnce(Response.json({status:"failed",message:"Scheduling failed"}));vi.stubGlobal("fetch",f);expect((await POST(request({operation:"decide",approve:true,proposalId:"mine",actor:"spoofed"}))).status).toBe(409);expect(JSON.parse(f.mock.calls[1][1].body).actor).toBe("social-review:verified")});

it("bounds parallel read-only media checks and preserves reviewed row order", async () => {
 const ids = Array.from({length: 8}, (_, i) => `post-${i}`);
 const entries = ids.map(id => { const p = {...post(id), copy:id}; m.files.set(postPath(id), serializePost(p));
   return {postId:id,scheduledAt:time,expectedMaterialHash:approvalHash({...p,scheduledAt:time})}; });
 let active = 0, peak = 0;
 m.validate.mockImplementation(async () => { active++; peak = Math.max(peak, active);
   await new Promise(resolve => setTimeout(resolve, 10)); active--; });
 const preview = await socialScheduleBatchAction().preview({entries});
 expect(peak).toBe(3); expect(preview.rows.map(row => row.value)).toEqual(ids);
 expect(m.save).not.toHaveBeenCalled();
});
