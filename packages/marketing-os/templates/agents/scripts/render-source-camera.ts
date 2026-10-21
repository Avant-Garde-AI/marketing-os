/** Offline deterministic renderer. Writes local output only; review/commit outputs, then bind through the gate.
 * node --import tsx scripts/render-source-camera.ts --input request.json --root . --out /tmp/render-output
 * Requires ffmpeg and ffprobe on PATH. No network, generation, schedule or publishing calls.
 */
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { sourceCameraManifestSchema, sourceCameraPath } from "../lib/social/source-camera-contract";
const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const argv=process.argv.slice(2),option=(name:string)=>{const i=argv.indexOf(name);return i<0?undefined:argv[i+1]};
async function main(){
 const inputPath=option("--input"),root=resolve(option("--root")??process.cwd()),out=option("--out");
 if(!inputPath||!out)throw Error("Supply --input, --root and --out");
 const input=sourceCameraManifestSchema.innerType().omit({final:true}).parse(JSON.parse(await readFile(inputPath,"utf8")));
 const durationFrames=input.segments.reduce((n,s)=>n+s.durationFrames,0);
 sourceCameraManifestSchema.parse({...input,final:{videoSha256:"0".repeat(64),posterSha256:"0".repeat(64),durationFrames,codec:"h264",pixelFormat:"yuv420p"}});
 const scratch=await mkdtemp(join(tmpdir(),"mos-camera-"));
 try {
  const images:Buffer[]=[];
  for(const source of input.sources){
   const path=resolve(root,source.path);if(!path.startsWith(root+sep))throw Error("Source outside input root");
   const encoded=await readFile(path,"utf8"),bytes=Buffer.from(encoded,"base64");
   if(bytes.toString("base64")!==encoded||hash(bytes)!==source.sha256)throw Error("Source digest mismatch");
   const meta=await sharp(bytes,{limitInputPixels:100000000}).metadata();
   if(meta.width!==source.width||meta.height!==source.height||meta.format!=="jpeg"||(meta.orientation??1)!==1)throw Error("Source metadata mismatch");
   images.push(bytes);
  }
  const clips:string[]=[];
  for(const [index,segment] of input.segments.entries()){
   const sourcePath=join(scratch,`source-${index}.png`),clipPath=join(scratch,`clip-${index}.mp4`);
   let filter:string;
   if(segment.kind==="pair"){
    const layers=await Promise.all(images.map(async bytes=>sharp(bytes).resize(980,900,{fit:"contain",background:input.background,withoutEnlargement:true}).png().toBuffer()));
    await sharp({create:{width:1080,height:1920,channels:3,background:input.background}}).composite(layers.map((bytes,i)=>({input:bytes,left:50,top:30+i*960}))).png().toFile(sourcePath);
    filter="fps=24,format=yuv420p";
   }else{
    const source=input.sources[segment.sourceIndex];
    const width=Math.ceil(Math.max(source.width,source.height*9/16)/2)*2,height=Math.ceil(width*16/9/2)*2;
    const left=Math.floor((width-source.width)/2),top=Math.floor((height-source.height)/2);
    await sharp({create:{width,height,channels:3,background:input.background}}).composite([{input:images[segment.sourceIndex],left,top}]).png().toFile(sourcePath);
    const progress=`min(1,max(0,(on-${segment.holdFrames})/${Math.max(1,segment.moveFrames-1)}))`;
    const ease=`(${progress}*${progress}*(3-2*${progress}))`;
    const zoom=`${segment.zoomFrom}+(${segment.zoomTo-segment.zoomFrom})*${ease}`;
    const centerX=left+segment.focus[0]*source.width,centerY=top+segment.focus[1]*source.height;
    const x=`max(0,min(iw-iw/zoom,${centerX}+(iw/2-${centerX})*${ease}-iw/zoom/2))`;
    const y=`max(0,min(ih-ih/zoom,${centerY}+(ih/2-${centerY})*${ease}-ih/zoom/2))`;
    filter=`zoompan=z='${zoom}':x='${x}':y='${y}':d=${segment.durationFrames}:s=1080x1920:fps=24,format=yuv420p`;
   }
   execFileSync("ffmpeg",["-v","error","-y","-loop","1","-i",sourcePath,"-vf",filter,"-frames:v",String(segment.durationFrames),"-an","-c:v","libx264","-threads","2","-preset","medium","-crf","20","-maxrate","3000k","-bufsize","3000k","-pix_fmt","yuv420p",clipPath],{timeout:180000,stdio:["ignore","pipe","pipe"]});clips.push(clipPath);
  }
  const concat=join(scratch,"concat.txt");await writeFile(concat,clips.map(path=>`file '${path}'`).join("\n"));
  const videoPath=join(scratch,"final.mp4");
  execFileSync("ffmpeg",["-v","error","-y","-f","concat","-safe","0","-i",concat,"-c","copy","-movflags","+faststart",videoPath],{timeout:30000,stdio:["ignore","pipe","pipe"]});
  const meta=JSON.parse(execFileSync("ffprobe",["-v","error","-select_streams","v:0","-show_entries","stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames:format=duration","-of","json",videoPath],{encoding:"utf8",timeout:30000}));
  const stream=meta.streams?.[0];
  if(stream?.codec_name!=="h264"||stream.pix_fmt!=="yuv420p"||stream.width!==1080||stream.height!==1920||stream.r_frame_rate!=="24/1"||Number(stream.nb_frames)!==durationFrames||Math.abs(Number(meta.format.duration)-durationFrames/24)>1/24)throw Error("Final video format differs from timeline");
  const video=await readFile(videoPath);if(video.length>4*1024*1024)throw Error("Export exceeds publishing byte limit");
  const posterPath=join(scratch,"poster.jpeg");execFileSync("ffmpeg",["-v","error","-y","-i",videoPath,"-frames:v","1","-q:v","2",posterPath],{timeout:30000,stdio:["ignore","pipe","pipe"]});
  const poster=await readFile(posterPath),final={videoSha256:hash(video),posterSha256:hash(poster),durationFrames,codec:"h264" as const,pixelFormat:"yuv420p" as const};
  const manifest=sourceCameraManifestSchema.parse({...input,final});
  const target=resolve(out);await mkdir(join(target,"social/assets"),{recursive:true});await mkdir(join(target,"social/production/camera"),{recursive:true});
  await writeFile(join(target,`social/assets/${final.videoSha256}.mp4.b64`),video.toString("base64"));await writeFile(join(target,`social/assets/${final.posterSha256}.jpeg.b64`),poster.toString("base64"));
  await writeFile(join(target,sourceCameraPath(input.postId)),JSON.stringify(manifest,null,2)+"\n");
  await writeFile(join(target,`${input.postId}.mp4`),video);await writeFile(join(target,`${input.postId}.jpeg`),poster);
  console.log(JSON.stringify({postId:input.postId,manifest:sourceCameraPath(input.postId),width:1080,height:1920,bytes:video.length,...final}));
 }finally{await rm(scratch,{recursive:true,force:true});}
}
main().catch(()=>{console.error("Camera render failed. Check source proof, native resolution, timeline, ffmpeg and output directory. No post or schedule was changed.");process.exitCode=1;});
