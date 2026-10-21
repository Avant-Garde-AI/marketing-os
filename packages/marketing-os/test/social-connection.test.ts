import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m=vi.hoisted(()=>({operator:vi.fn(),destination:vi.fn(),verify:vi.fn(),status:vi.fn(),store:vi.fn(),identity:vi.fn()}));
vi.mock("../templates/agents/lib/social/review-operator",()=>({socialReviewOperator:m.operator}));
vi.mock("../templates/agents/lib/social/repo",()=>({socialRepo:{}}));
vi.mock("../templates/agents/lib/social/connection",async original=>({...await original<any>(),existingInstagramDestination:m.destination}));
vi.mock("../templates/agents/lib/broker-client",()=>({channelConnectionStatus:m.status,storeChannelToken:m.store}));
vi.mock("../templates/agents/lib/social/channels/instagram",()=>({instagramIdentity:m.identity}));
vi.mock("../templates/agents/lib/social/channels",()=>({brokerTokenSource:{}}));
import { GET, POST } from "../templates/agents/app/api/social/connection/route";
import { verifyInstagramReplacement } from "../templates/agents/lib/social/connection";
const token="IGAA_PRIVATE_TEST_TOKEN_NEVER_IN_URL_123456789",account={id:"123",username:"store"};
const req=(body:any={token},origin="https://console.example")=>new NextRequest("https://console.example/api/social/connection",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
function provider(profile:any={user_id:"123",username:"store"},quota:any={data:[{quota_usage:0,config:{quota_total:100,quota_duration:86400}}]}){
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(profile)).mockResolvedValueOnce(Response.json(quota));vi.stubGlobal("fetch",fetcher);return fetcher;
}
beforeEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();vi.stubEnv("SOCIAL_IG_GRAPH_BASE","https://graph.instagram.com/v23.0");m.operator.mockResolvedValue({id:"owner"});m.destination.mockResolvedValue(account);m.status.mockResolvedValue({expiresAt:"2026-11-17T00:00:00Z"});m.identity.mockResolvedValue(account);m.store.mockResolvedValue({created:false});});
describe("Instagram reconnect",()=>{
 it("requires a verified owner and same-origin writes; review tokens are insufficient",async()=>{
  m.operator.mockResolvedValue(null);expect((await GET()).status).toBe(401);expect((await POST(req())).status).toBe(401);expect(m.store).not.toHaveBeenCalled();m.operator.mockResolvedValue({id:"owner"});expect((await POST(req({token},"https://other.example"))).status).toBe(403);
 });
 it("reports invalidated live credentials despite an unexpired metadata date",async()=>{m.identity.mockRejectedValue(Error("OAuthException 190"));const r=await GET();expect(await r.json()).toMatchObject({connected:false,status:"reconnect_required",account});});
 it("verifies account and publishing permission, then stores only through the broker",async()=>{
  const f=provider();const r=await POST(req());expect(r.status).toBe(200);expect(await r.json()).toMatchObject({ok:true,account});expect(m.store).toHaveBeenCalledWith({channel:"instagram",token,externalAccount:"123",expiresAt:null});
  expect(f.mock.calls.map(([url])=>url)).toEqual(["https://graph.instagram.com/v23.0/me?fields=user_id,username","https://graph.instagram.com/v23.0/123/content_publishing_limit?fields=quota_usage,config"]);
  for(const [url,options] of f.mock.calls){expect(url).not.toContain(token);expect(options.headers.Authorization).toBe(`Bearer ${token}`);expect(options.redirect).toBe("error");}
 });
 it("refuses another account or malformed publishing capability before saving",async()=>{
  provider({user_id:"456",username:"other"});expect((await POST(req())).status).toBe(409);expect(m.store).not.toHaveBeenCalled();
  provider(undefined,{data:[]});expect((await POST(req())).status).toBe(409);expect(m.store).not.toHaveBeenCalled();
 });
 it("rejects denied publishing capability with sanitized stage and numeric code",async()=>{
  const f=vi.fn().mockResolvedValueOnce(Response.json({user_id:"123",username:"store"})).mockResolvedValueOnce(Response.json({error:{code:10,message:token}},{status:403}));vi.stubGlobal("fetch",f);
  const r=await POST(req());expect(r.status).toBe(409);const body=await r.text();expect(body).toContain("publishing access");expect(body).toContain("Meta code 10");expect(body).not.toContain(token);expect(m.store).not.toHaveBeenCalled();
 });
 it("does not treat exhausted quota as an invalid token",async()=>{
  provider(undefined,{data:[{quota_usage:100,config:{quota_total:100,quota_duration:86400}}]});expect((await POST(req())).status).toBe(200);
 });
 it("fails closed on malformed capability responses",async()=>{
  for(const data of [[{quota_usage:0}], [{quota_usage:-1,config:{quota_total:100,quota_duration:86400}}], [{quota_usage:0,config:{quota_total:0,quota_duration:86400}}]]){
    provider(undefined,{data});expect((await POST(req())).status).toBe(409);
  }
  expect(m.store).not.toHaveBeenCalled();
 });
 it("does not echo provider or broker secrets on failure",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({error:{message:token}},{status:400})));let r=await POST(req());expect(await r.text()).not.toContain(token);
  provider();m.store.mockRejectedValue(Error(`private broker failure ${token}`));r=await POST(req());expect(r.status).toBe(409);expect(await r.text()).not.toContain(token);
 });
 it("rejects arbitrary graph hosts before sending a credential",async()=>{const f=provider();vi.stubEnv("SOCIAL_IG_GRAPH_BASE","https://attacker.example/v23.0");await expect(verifyInstagramReplacement(token,account)).rejects.toThrow("configured Instagram");expect(f).not.toHaveBeenCalled();});
});
