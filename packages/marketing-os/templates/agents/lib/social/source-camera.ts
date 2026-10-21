/** Source-preserving editorial camera cuts. This receipt claims no paid generation or selected storyboard. */
import { createHash } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import type { SocialPost, SocialRepo } from "./types";
import { parsePost, postPath, serializePost, renderedVideoSchema } from "./artifacts";
import { readSocialVideo } from "./video-assets";
import { readSocialImage, validateSocialAssetBase } from "../storyboard/assets";
import { hashPreview } from "../actions/hash";
import { getTenant } from "../tenant-context";
import { instagramIdentity } from "./channels/instagram";
import { brokerTokenSource } from "./channels";
import { registerAction } from "../actions/registry";
import { socialActionDeps } from "./register-actions";
import { socialRepo } from "./repo";
import { sourceCameraManifestSchema, sourceCameraPath } from "./source-camera-contract";
export { sourceCameraManifestSchema, sourceCameraPath } from "./source-camera-contract";
export type { SourceCameraManifest } from "./source-camera-contract";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/);
export async function loadSourceCamera(repo:SocialRepo,postId:string){
 const raw=await repo.readFile(sourceCameraPath(postId));if(!raw||raw.length>64000)throw Error("Camera receipt unavailable");
 const m=sourceCameraManifestSchema.parse(JSON.parse(raw));if(m.postId!==postId)throw Error("Camera receipt belongs to another post");return m;
}
const digest=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
export async function validateSourceCamera(repo:SocialRepo,post:SocialPost,base:string){
 const receipt=post.renderedVideo;if(!receipt||!("origin" in receipt)||receipt.origin!=="source-camera")return;
 validateSocialAssetBase(base);const tenant=getTenant();const m=await loadSourceCamera(repo,post.id);
 if(hashPreview(m)!==receipt.manifestHash||m.caption!==post.copy)throw Error("Camera timeline or caption changed");
 const account=await instagramIdentity(brokerTokenSource);
 if(!post.channelAccount||JSON.stringify(account)!==JSON.stringify(post.channelAccount))throw Error("Camera destination changed");
 for(const src of m.sources){
  const raw=await repo.readFile(src.path);if(!raw||raw.length>16000000)throw Error("Camera source unavailable");
  const bytes=Buffer.from(raw,"base64");
  if(bytes.toString("base64")!==raw||digest(bytes)!==src.sha256)throw Error("Camera source hash mismatch");
  const meta=await sharp(bytes,{limitInputPixels:100000000}).metadata();
  if(meta.format!=="jpeg"||meta.width!==src.width||meta.height!==src.height||(meta.orientation??1)!==1)throw Error("Camera source dimensions changed");
  const [path,anchor]=src.verificationRef.split("#");const proof=await repo.readFile(path);
  const section=proof?.split(`## ${anchor}\n`)[1]?.split("\n## ")[0];
  if(!section?.includes(src.originalSha256)||!section.includes(src.sha256))throw Error("Camera source verification proof missing");
 }
 const video=await readSocialVideo(repo,m.final.videoSha256),poster=await readSocialImage(repo,m.final.posterSha256);
 const prefix=`${base.replace(/\/$/,"")}/api/social/assets/${tenant.shop}/`;
 if(!video||!poster||receipt.video.sha256!==m.final.videoSha256||receipt.poster.sha256!==m.final.posterSha256||
  receipt.video.width!==1080||receipt.video.height!==1920||receipt.video.durationMs!==Math.round(m.final.durationFrames/24*1000)||
  receipt.video.url!==`${prefix}${m.final.videoSha256}.mp4`||receipt.poster.url!==`${prefix}${m.final.posterSha256}.jpeg`||
  JSON.stringify(receipt.sources)!==JSON.stringify(m.sources.map(s=>({ref:s.ref,sha256:s.sha256}))))throw Error("Camera export binding changed");
 const meta=await sharp(poster).metadata();if(meta.format!=="jpeg"||meta.width!==1080||meta.height!==1920||receipt.poster.width!==1080||receipt.poster.height!==1920)throw Error("Camera poster dimensions invalid");
}
const intent=z.object({postId:id,expectedDraftHash:hash,expectedManifestHash:hash,accountId:z.string().regex(/^\d+$/),accountUsername:z.string().min(1).max(100)}).strict();
export function sourceCameraBindingAction(){
 async function material(p:z.infer<typeof intent>){
  const m=await loadSourceCamera(socialRepo,p.postId);if(hashPreview(m)!==p.expectedManifestHash)throw Error("Camera receipt changed");
  const raw=await socialRepo.readFile(postPath(p.postId));if(!raw)throw Error("Editorial draft missing");const prior=parsePost(raw);
  if(prior.status!=="proposed"||hashPreview(prior)!==p.expectedDraftHash||prior.copy!==m.caption||prior.assetRefs.length||prior.designSurface||prior.renderedSequence||prior.renderedVideo||prior.scheduledAt||prior.approval||prior.platform||prior.publishAttempt||prior.channel!=="instagram")throw Error("Only an unchanged unrendered draft can receive this video");
  const base=process.env.MOS_AGENTS_PUBLIC_URL??"",prefix=`${base.replace(/\/$/,"")}/api/social/assets/${getTenant().shop}/`;
  const video=renderedVideoSchema.parse({version:1,origin:"source-camera",manifestHash:p.expectedManifestHash,sources:m.sources.map(s=>({ref:s.ref,sha256:s.sha256})),
   video:{sha256:m.final.videoSha256,url:`${prefix}${m.final.videoSha256}.mp4`,mimeType:"video/mp4",width:1080,height:1920,durationMs:Math.round(m.final.durationFrames/24*1000)},
   poster:{sha256:m.final.posterSha256,url:`${prefix}${m.final.posterSha256}.jpeg`,width:1080,height:1920}});
  const post:SocialPost={...prior,status:"asset_ready",channelAccount:{id:p.accountId,username:p.accountUsername},renderedVideo:video,assetRefs:[`social/assets/${m.final.videoSha256}.mp4.b64`,`social/assets/${m.final.posterSha256}.jpeg.b64`]};
  await validateSourceCamera(socialRepo,post,base);return {raw,post};
 }
 return {kind:"social.bind_source_camera",title:"Bind source-preserving editorial video",risk:"medium" as const,scopes:["social:publish"],paramsSchema:intent,
  async preview(p:z.infer<typeof intent>){const {post}=await material(p);return {summary:`Prepare ${post.id} for review; no publishing or scheduling`,rows:[{label:"Caption",value:post.copy},{label:"Destination",value:`@${p.accountUsername}`}],previewHash:hashPreview(p)};},
  async execute(p:z.infer<typeof intent>){const deps=socialActionDeps();return deps.withPostLock!(p.postId,async()=>{const {raw,post}=await material(p);if(await socialRepo.readFile(postPath(p.postId))!==raw)throw Error("Draft changed during binding");await socialRepo.writeFile(postPath(p.postId),serializePost(post));await deps.onPostSaved?.(post);return {ok:true,summary:"Source-preserving video bound; scheduling requires its existing Action"};});}
 };
}
registerAction("social.bind_source_camera",sourceCameraBindingAction);
