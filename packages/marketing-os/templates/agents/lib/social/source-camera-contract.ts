/** Pure editorial camera timeline and source-lineage contract. */
import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/);
const source = z.object({ ref: z.string().min(1), sha256: hash, originalSha256: hash,
  verificationRef: z.string().regex(/^social\/production\/[A-Za-z0-9._-]+\.md#[A-Za-z0-9-]+$/),
  path: z.string(), width: z.number().int().min(1080).max(10000), height: z.number().int().min(1080).max(10000),
}).strict().refine(s=>s.path===`social/production/sources/${s.sha256}.jpeg.b64`,"Source must be content-addressed");
const camera = z.object({kind:z.literal("camera"),sourceIndex:z.number().int().min(0).max(1),durationFrames:z.number().int().min(24).max(240),
  zoomFrom:z.number().min(1).max(8),zoomTo:z.number().min(1).max(8),holdFrames:z.number().int().min(0).max(120),
  moveFrames:z.number().int().min(1).max(240),focus:z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)])}).strict().refine(s=>s.holdFrames+s.moveFrames<=s.durationFrames,"Camera movement exceeds clip length");
const pair=z.object({kind:z.literal("pair"),durationFrames:z.number().int().min(24).max(120)}).strict();
export const sourceCameraManifestSchema=z.object({schemaVersion:z.literal(1),postId:id,caption:z.string().trim().min(1).max(2200),
  frameRate:z.literal(24),width:z.literal(1080),height:z.literal(1920),background:z.literal("#f4f3ee"),
  sources:z.array(source).min(1).max(2),segments:z.array(z.union([camera,pair])).min(1).max(4),
  final:z.object({videoSha256:hash,posterSha256:hash,durationFrames:z.number().int().min(72).max(720),codec:z.literal("h264"),pixelFormat:z.literal("yuv420p")}).strict(),
}).strict().superRefine((m,ctx)=>{
 if(m.segments.reduce((n,s)=>n+s.durationFrames,0)!==m.final.durationFrames)ctx.addIssue({code:"custom",message:"Timeline duration differs from export"});
 if(new Set(m.sources.map(s=>s.ref)).size!==m.sources.length)ctx.addIssue({code:"custom",message:"Duplicate source"});
 for(const s of m.segments) {
  if(s.kind==="pair") {if(m.sources.length!==2)ctx.addIssue({code:"custom",message:"Pair needs two sources"});continue;}
  const src=m.sources[s.sourceIndex];
  if(!src) {ctx.addIssue({code:"custom",message:"Camera references absent source"});continue;}
  // Renderer contain-pads the full artwork on a 9:16 source canvas, then crops it.
  const canvasWidth=Math.max(src.width,src.height*9/16);
  if(canvasWidth/Math.max(s.zoomFrom,s.zoomTo)<1080)ctx.addIssue({code:"custom",message:"Close-up needs a larger verified derivative; upscaling is not allowed"});
 }
});
export type SourceCameraManifest=z.infer<typeof sourceCameraManifestSchema>;
export function sourceCameraPath(postId:string){id.parse(postId);return `social/production/camera/${postId}.json`;}
