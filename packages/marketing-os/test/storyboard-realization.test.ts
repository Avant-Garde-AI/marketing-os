import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createHash } from "node:crypto";
const state = vi.hoisted(() => ({ files: new Map<string,string>(), selected: null as any, create: vi.fn(), export: vi.fn(), sync: vi.fn(), tenantReads: [] as string[] }));
vi.mock("../templates/agents/lib/actions/registry", () => ({registerAction: vi.fn()}));
vi.mock("../templates/agents/lib/tenant-context", () => ({getTenant: () => ({shop:"one.myshopify.com"}),runWithTenant: async (tenant:any, fn:()=>any)=>{state.tenantReads.push(tenant.shop);return fn();}}));
vi.mock("../templates/agents/lib/social/repo", () => ({socialRepo:{readFile:async(p:string)=>state.files.get(p)??null,writeFile:async(p:string,v:string)=>{state.files.set(p,v);}}}));
vi.mock("../templates/agents/lib/social/index-sync", () => ({syncPostIndex:state.sync}));
vi.mock("../templates/agents/lib/social/review-links", () => ({socialReviewLink:()=>({url:"https://console.example.com/review"})}));
vi.mock("../templates/agents/lib/design-surfaces/config", () => ({getDesignSurfaceAdapter:()=>({})}));
vi.mock("../templates/agents/lib/design-surfaces/tenancy", () => ({getTenantTeam:async()=>({teamId:"team",projectId:"project"})}));
vi.mock("../templates/agents/lib/design-surfaces/surface", () => ({createSurface:state.create,exportSurfaceBoards:state.export}));
vi.mock("../templates/agents/lib/design-surfaces/compose", () => ({checkComposeFit:()=>({errors:[],warnings:[]})}));
vi.mock("../templates/agents/src/mastra/brand/store", () => ({getBrandInstructions:async()=>"brand"}));
vi.mock("../templates/agents/src/mastra/tools/design-surfaces", () => ({loadBrandTokens:async()=>({})}));
vi.mock("../templates/agents/lib/storyboard/reviews", () => ({readSelectedStoryboard:async()=>state.selected}));
import { createRealizationAction, sourceForLayout, validateRealization, fetchReviewedSource, type SlideLayout } from "../templates/agents/lib/storyboard/realization";
import { GET as assetGET } from "../templates/agents/app/api/social/assets/[shop]/[name]/route";
import { imageDigest, saveSocialImage, readSocialImage } from "../templates/agents/lib/storyboard/assets";
import { parsePost, postPath, serializePost } from "../templates/agents/lib/social/artifacts";
const ref="https://cdn.shopify.com/source.png";
const story=()=>({id:"story",format:"single" as const,premise:"See the red detail",payoff:"Red",caption:"Caption",continuity:[],beats:[{id:"detail",role:"payoff" as const,assertion:"Red",brief:{shows:"red",feels:"quiet",avoid:["invention"],sourcing:"store-asset" as const,asset:{ref,use:"detail-crop" as const}},evidence:[{claim:"Red",origin:"owner" as const}]}]});
const context=()=>({brand:{source:"brand.md",content:"brand"},facts:[],patterns:[],priorPosts:[],assets:[{ref}]}) as any;
let source:Buffer;
const layout=():SlideLayout=>({beatId:"detail",boardName:"detail",width:320,height:320,backgroundColor:"#ffffff",image:{x:0,y:0,width:320,height:320,sourceSha256:imageDigest(source),crop:{left:0,top:0,width:.5,height:1}}});
const params=()=>({reviewId:"review",reviewHash:"a".repeat(64),postId:"post",layouts:[layout()]});
const repo={readFile:async(p:string)=>state.files.get(p)??null,writeFile:async(p:string,v:string)=>{state.files.set(p,v);}};
beforeEach(async()=>{
 state.tenantReads.length=0;state.files.clear();state.create.mockReset();state.export.mockReset();state.sync.mockReset();
 // Red left half, blue right half makes crop order observable.
 const pixels=Buffer.alloc(64*32*3);for(let y=0;y<32;y++)for(let x=0;x<64;x++){const i=(y*64+x)*3;pixels[i]=x<32?255:0;pixels[i+2]=x<32?0:255;}
 source=await sharp(pixels,{raw:{width:64,height:32,channels:3}}).png().toBuffer();
 state.selected={storyboard:story(),context:context(),storyboardHash:"b".repeat(64),selection:{selectionHash:"c".repeat(64)}};
 state.files.set(postPath("post"),serializePost({id:"post",channel:"instagram",copy:"Caption",targetLink:"https://shop.example.com",assetRefs:[],provenance:[],status:"proposed",body:""}));
 state.create.mockResolvedValue({surface:{penpot:{teamId:"team",fileId:"file",pageId:"page"}}});
 state.export.mockImplementation(async()=>({detail:{data:await sharp({create:{width:320,height:320,channels:3,background:"red"}}).jpeg().toBuffer()}}));
 vi.stubEnv("MOS_AGENTS_PUBLIC_URL","https://console.example.com");
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(source,{headers:{"content-type":"image/png"}})));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("source-backed storyboard realization",()=>{
 it("crops source coordinates before contain resizing and refuses changed pixels",async()=>{
  const bytes=await sourceForLayout(source,layout());const result=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
  const center=(160*result.info.width+160)*result.info.channels;expect(result.data[center]).toBeGreaterThan(240);expect(result.data[center+2]).toBeLessThan(15);
  const nearTop=(10*result.info.width+160)*result.info.channels;expect(result.data[nearTop]).toBeGreaterThan(240);expect(result.data[nearTop+1]).toBeLessThan(15);
  await expect(sourceForLayout(source,{...layout(),image:{...layout().image,sourceSha256:"d".repeat(64)}})).rejects.toThrow("Source pixels changed");
 });
 it("rejects generation, mockup sourcing, missing inventory, missing explicit crop and reordered beats",()=>{
  for(const modify of [(s:any)=>s.beats[0].brief.sourcing="generated",(s:any)=>s.beats[0].brief.asset.use="mockup-input",(s:any)=>s.format="video",(s:any)=>s.beats[0].brief.seconds=2]){const s=story();modify(s);expect(()=>validateRealization(s,context(),[layout()])).toThrow();}
  expect(()=>validateRealization(story(),{...context(),assets:[]},[layout()])).toThrow("absent");
  const l=layout();delete l.image.crop;expect(()=>validateRealization(story(),context(),[l])).toThrow("explicit");
  expect(()=>validateRealization(story(),context(),[{...layout(),beatId:"wrong"}])).toThrow("order");
 });
 it("refuses unreviewed origins and redirects, hashes exact downloaded bytes",async()=>{
  await expect(fetchReviewedSource("https://evil.example/source.jpeg")).rejects.toThrow("Shopify CDN");
  expect(imageDigest(await fetchReviewedSource(ref))).toBe(createHash("sha256").update(source).digest("hex"));
  expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({redirect:"error"});
 });
 it("refuses frozen posts before rendering and source hash drift before write",async()=>{
  const p=parsePost(state.files.get(postPath("post"))!);p.status="published";state.files.set(postPath("post"),serializePost(p));
  await expect(createRealizationAction().execute(params())).rejects.toThrow("Frozen");expect(state.create).not.toHaveBeenCalled();
  p.status="proposed";state.files.set(postPath("post"),serializePost(p));const args=params();args.layouts[0]!.image.sourceSha256="e".repeat(64);
  await expect(createRealizationAction().execute(args)).rejects.toThrow("Source pixels changed");expect(state.create).not.toHaveBeenCalled();
 });
 it("writes ordered immutable JPEG sequence, then resumes exact execution without a second render",async()=>{
  const action=createRealizationAction();await action.execute(params());const p=parsePost(state.files.get(postPath("post"))!);
  expect(p.status).toBe("asset_ready");expect(p.renderedSequence?.slides.map(s=>s.beatId)).toEqual(["detail"]);
  expect(p.renderedSequence?.slides[0]?.url).toContain("/one.myshopify.com/");
  await action.execute(params());expect(state.create).toHaveBeenCalledTimes(1);
 });
 it("rejects a concurrent frozen lifecycle transition before replacing the artifact",async()=>{
  state.export.mockImplementation(async()=>{const p=parsePost(state.files.get(postPath("post"))!);p.status="cancelled";state.files.set(postPath("post"),serializePost(p));return {detail:{data:await sharp({create:{width:320,height:320,channels:3,background:"red"}}).jpeg().toBuffer()}};});
  await expect(createRealizationAction().execute(params())).rejects.toThrow();expect(parsePost(state.files.get(postPath("post"))!).status).toBe("cancelled");
 });
 it("preserves beat order even when renderer exports arrive in a different key order",async()=>{
  const s:any=story();s.format="carousel";s.beats.push({...s.beats[0],id:"payoff",brief:{...s.beats[0].brief}});state.selected.storyboard=s;
  const args=params();args.layouts.push({...layout(),beatId:"payoff",boardName:"payoff"});
  state.export.mockImplementation(async()=>({payoff:{data:await sharp({create:{width:320,height:320,channels:3,background:"blue"}}).jpeg().toBuffer()},detail:{data:await sharp({create:{width:320,height:320,channels:3,background:"red"}}).jpeg().toBuffer()}}));
  await createRealizationAction().execute(args);expect(parsePost(state.files.get(postPath("post"))!).renderedSequence?.slides.map(slide=>slide.beatId)).toEqual(["detail","payoff"]);
 });
 it("binds asset route reads to the URL tenant and hides other shops in local mode",async()=>{
  const jpeg=await sharp(source).jpeg().toBuffer();const asset=await saveSocialImage(repo,"one.myshopify.com",jpeg,"https://console.example.com");
  vi.stubEnv("MARKETING_OS_MODE","local");vi.stubEnv("SHOPIFY_STORE_URL","one.myshopify.com");
  const request={} as any;
  expect((await assetGET(request,{params:Promise.resolve({shop:"other.myshopify.com",name:`${asset.sha256}.jpeg`})})).status).toBe(404);
  expect(state.tenantReads).toEqual([]);
  const response=await assetGET(request,{params:Promise.resolve({shop:"one.myshopify.com",name:`${asset.sha256}.jpeg`})});
  expect(response.status).toBe(200);expect(state.tenantReads).toEqual(["one.myshopify.com"]);expect(imageDigest(new Uint8Array(await response.arrayBuffer()))).toBe(asset.sha256);
  expect(response.headers.get("cache-control")).toContain("immutable");
  expect((await assetGET(request,{params:Promise.resolve({shop:"../bad",name:`${asset.sha256}.jpeg`})})).status).toBe(400);
 });
 it("checks stored hashes on read and refuses mismatched content at immutable paths",async()=>{
  const jpeg=await sharp(source).jpeg().toBuffer();const saved=await saveSocialImage(repo,"one.myshopify.com",jpeg,"https://console.example.com");
  expect(imageDigest((await readSocialImage(repo,saved.sha256))!)).toBe(saved.sha256);
  state.files.set(`social/assets/${saved.sha256}.jpeg.b64`,Buffer.from("tampered").toString("base64"));
  await expect(readSocialImage(repo,saved.sha256)).rejects.toThrow("digest mismatch");await expect(saveSocialImage(repo,"one.myshopify.com",jpeg,"https://console.example.com")).rejects.toThrow("digest mismatch");
 });
});
