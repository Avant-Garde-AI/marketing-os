import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {createHash} from "node:crypto";
import sharp from "sharp";
const m=vi.hoisted(()=>({repo:{readFile:vi.fn(),writeFile:vi.fn(),list:vi.fn()},account:vi.fn(),video:vi.fn(),poster:vi.fn()}));
vi.mock("../templates/agents/lib/social/repo",()=>({socialRepo:m.repo}));
vi.mock("../templates/agents/lib/social/register-actions",()=>({socialActionDeps:()=>({repo:m.repo,withPostLock:async(_id:string,fn:()=>Promise<any>)=>fn()})}));
vi.mock("../templates/agents/lib/social/channels/instagram",()=>({instagramIdentity:m.account}));
vi.mock("../templates/agents/lib/social/channels",()=>({brokerTokenSource:{}}));
vi.mock("../templates/agents/lib/social/video-assets",()=>({readSocialVideo:m.video}));
vi.mock("../templates/agents/lib/storyboard/assets",()=>({readSocialImage:m.poster,validateSocialAssetBase:vi.fn()}));
import {sourceCameraManifestSchema,sourceCameraPath,validateSourceCamera,sourceCameraBindingAction} from "../templates/agents/lib/social/source-camera";
import {runWithTenant} from "../templates/agents/lib/tenant-context";
import {hashPreview} from "../templates/agents/lib/actions/hash";
import {parsePost,serializePost,postPath} from "../templates/agents/lib/social/artifacts";
const digest=(b:Buffer)=>createHash("sha256").update(b).digest("hex"),base="https://console.example",shop="store.myshopify.com",postId="2026-10-24-look-up",tenant={shop,storeSlug:"store",githubRepo:"Owner/store"};
let source:Buffer,poster:Buffer,manifest:any,post:any,files:Map<string,string>;
beforeAll(async()=>{source=await sharp({create:{width:4000,height:6000,channels:3,background:"#abcdef"}}).jpeg().toBuffer();poster=await sharp(source).resize(1080,1920,{fit:"contain"}).jpeg().toBuffer();});
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv("MOS_AGENTS_PUBLIC_URL",base);
 manifest={schemaVersion:1,postId,caption:"Look up. @artist",frameRate:24,width:1080,height:1920,background:"#f4f3ee",sources:[{ref:"master:original",sha256:digest(source),originalSha256:"1".repeat(64),verificationRef:"social/production/CAMERA-SOURCES.md#native",path:`social/production/sources/${digest(source)}.jpeg.b64`,width:4000,height:6000}],segments:[{kind:"camera",sourceIndex:0,durationFrames:192,zoomFrom:3.6,zoomTo:1,holdFrames:12,moveFrames:89,focus:[0.58,0.8]}],final:{videoSha256:"2".repeat(64),posterSha256:digest(poster),durationFrames:192,codec:"h264",pixelFormat:"yuv420p"}};
 const prefix=`${base}/api/social/assets/${shop}/`;
 post={id:postId,channel:"instagram",channelAccount:{id:"123",username:"store"},copy:manifest.caption,status:"asset_ready",targetLink:base,provenance:[],assetRefs:[],body:"Keep rationale",renderedVideo:{version:1,origin:"source-camera",manifestHash:hashPreview(manifest),sources:manifest.sources.map((s:any)=>({ref:s.ref,sha256:s.sha256})),video:{sha256:"2".repeat(64),url:`${prefix}${"2".repeat(64)}.mp4`,mimeType:"video/mp4",width:1080,height:1920,durationMs:8000},poster:{sha256:digest(poster),url:`${prefix}${digest(poster)}.jpeg`,width:1080,height:1920}}};
 files=new Map([[sourceCameraPath(postId),JSON.stringify(manifest)],[manifest.sources[0].path,source.toString("base64")],["social/production/CAMERA-SOURCES.md",`## native\nOriginal ${"1".repeat(64)}\nDerivative ${digest(source)}\n`]]);
 m.repo.readFile.mockImplementation(async(path:string)=>files.get(path)??null);m.repo.writeFile.mockImplementation(async(path:string,raw:string)=>{files.set(path,raw)});m.account.mockResolvedValue({id:"123",username:"store"});m.video.mockResolvedValue(Buffer.from("video"));m.poster.mockResolvedValue(poster);
});
describe("source-preserving camera delivery",()=>{
 it("rejects low-resolution close crops, absent sources and timeline/export disagreement",()=>{
  expect(sourceCameraManifestSchema.safeParse(manifest).success).toBe(true);
  expect(sourceCameraManifestSchema.safeParse({...manifest,sources:[{...manifest.sources[0],width:1483,height:1920}]}).success).toBe(false);
  expect(sourceCameraManifestSchema.safeParse({...manifest,segments:[{...manifest.segments[0],sourceIndex:1}]}).success).toBe(false);
  expect(sourceCameraManifestSchema.safeParse({...manifest,final:{...manifest.final,durationFrames:193}}).success).toBe(false);
 });
 it("rechecks source bytes, proof, account and caption rather than trusting a rendered flag",async()=>{
  const check=()=>runWithTenant(tenant,()=>validateSourceCamera(m.repo,post,base));await expect(check()).resolves.toBeUndefined();
  m.account.mockResolvedValueOnce({id:"456",username:"other"});await expect(check()).rejects.toThrow("destination changed");
  files.set(manifest.sources[0].path,Buffer.from("changed").toString("base64"));await expect(check()).rejects.toThrow("hash mismatch");files.set(manifest.sources[0].path,source.toString("base64"));
  files.set("social/production/CAMERA-SOURCES.md","## other\nMissing proof");await expect(check()).rejects.toThrow("proof missing");
 });
 it("binds only a frozen unrendered draft, without inventing storyboard consent",async()=>{
  const {renderedVideo,channelAccount,...draft}=post;draft.status="proposed";files.set(postPath(postId),serializePost(draft));
  const action=sourceCameraBindingAction(),params={postId,expectedDraftHash:hashPreview(parsePost(serializePost(draft))),expectedManifestHash:hashPreview(manifest),accountId:"123",accountUsername:"store"};
  await runWithTenant(tenant,()=>action.preview(params));expect(m.repo.writeFile).not.toHaveBeenCalled();
  expect((await runWithTenant(tenant,()=>action.execute(params))).ok).toBe(true);
  const bound=parsePost(files.get(postPath(postId))!);expect(bound.status).toBe("asset_ready");expect(bound.body).toBe("Keep rationale");expect(bound.renderedVideo).toMatchObject({origin:"source-camera"});expect(bound.renderedVideo).not.toHaveProperty("storyboardId");
  await expect(runWithTenant(tenant,()=>action.execute(params))).rejects.toThrow("unchanged unrendered");
 });
});
