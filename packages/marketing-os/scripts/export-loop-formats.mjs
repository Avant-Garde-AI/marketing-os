#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function usage() {
  console.error("Usage: node export-loop-formats.mjs <input.mp4> <output-directory> <artifact-id> <post-id> <input-sha256>");
  process.exit(2);
}

const [, , inputArg, outputArg, artifactIdArg, postIdArg, inputHashArg] = process.argv;
if (!inputArg || !outputArg || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(artifactIdArg ?? "") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(postIdArg ?? "") || !/^[a-f0-9]{64}$/.test(inputHashArg ?? "")) usage();
const input = resolve(inputArg);
const outputDir = resolve(outputArg);
mkdirSync(outputDir, { recursive: true });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const probe = (file) => JSON.parse(execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,pix_fmt",
  "-of", "json", file,
], { encoding: "utf8" }));
const inputMeta = probe(input);
const video = inputMeta.streams?.find((stream) => stream.codec_type === "video");
const rate = typeof video?.avg_frame_rate === "string" && /^(\d+)\/(\d+)$/.exec(video.avg_frame_rate);
const sourceFps = rate ? Number(rate[1]) / Number(rate[2]) : NaN;
if (!video || !Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height) ||
    video.width < 360 || video.height < 640 || video.width > 8192 || video.height > 8192 ||
    video.width % 2 !== 0 || video.height % 2 !== 0 || video.width * 16 !== video.height * 9 ||
    !Number.isFinite(sourceFps) || sourceFps <= 0 || sourceFps > 120 || statSync(input).size > 200 * 1024 * 1024) {
  throw new Error("Expected an even-dimensioned 9:16 source between 360x640 and 8192x8192, under 200 MB, and at most 120 fps");
}
const durationSec = Number(inputMeta.format?.duration);
if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 30) throw new Error("Invalid source duration");
const inputBytes = readFileSync(input);
const sourceUpscaled = video.width < 1080 || video.height < 1920;

const common = [
  "-hide_banner", "-loglevel", "error", "-y", "-i", input,
  "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1",
  "-vf", "setsar=1", "-r", "24", "-fps_mode", "cfr",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
  "-profile:v", "high", "-movflags", "+faststart", "-video_track_timescale", "24000",
];
const exports = [
  {
    variant: "reel",
    filename: `${artifactIdArg}-reel.mp4`,
    filter: "scale=1080:1920:flags=lanczos,setsar=1",
    width: 1080,
    height: 1920,
    fit: "full-frame scale; no crop; source aspect ratio retained",
  },
  {
    variant: "feed",
    filename: `${artifactIdArg}-feed.mp4`,
    filter: "scale=1080:1350:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=#f4f3ee,setsar=1",
    width: 1080,
    height: 1350,
    fit: "contain with #f4f3ee side padding; no crop; full source frame retained",
  },
];

const receipt = {
  schemaVersion: 1,
  artifactId: artifactIdArg,
  postId: postIdArg,
  inputHash: inputHashArg,
  source: {
    filename: basename(input),
    sha256: sha256(inputBytes),
    codec: video.codec_name,
    width: video.width,
    height: video.height,
    frameRate: video.avg_frame_rate,
    durationSec,
    sourceUpscaled,
    note: sourceUpscaled
      ? `Source is ${video.width}x${video.height}; 1080x1920 output is Lanczos-upscaled, not native-resolution generation.`
      : `Source is ${video.width}x${video.height}; final 1080x1920 output does not upscale the source.`,
  },
  exports: [],
};

for (const item of exports) {
  const path = join(outputDir, item.filename);
  const args = [...common.slice(0, common.indexOf("-vf")), "-vf", item.filter, ...common.slice(common.indexOf("-vf") + 2), path];
  execFileSync("ffmpeg", args, { stdio: "inherit" });
  const bytes = readFileSync(path);
  const outputProbe = probe(path);
  const outputVideo = outputProbe.streams?.find((stream) => stream.codec_type === "video");
  if (!outputVideo || outputVideo.codec_name !== "h264" || outputVideo.width !== item.width ||
      outputVideo.height !== item.height || outputVideo.avg_frame_rate !== "24/1" ||
      Math.abs(Number(outputProbe.format?.duration) - durationSec) > 1 / 24) {
    throw new Error(`Export verification failed for ${item.variant}`);
  }
  // Store a canonical text representation as well: StoreRepo exposes UTF-8
  // files, and the token-scoped review route verifies the decoded MP4 hash.
  writeFileSync(`${path}.b64`, bytes.toString("base64"));
  receipt.exports.push({
    variant: item.variant,
    filename: item.filename,
    sha256: sha256(bytes),
    bytes: bytes.length,
    codec: outputVideo.codec_name,
    pixelFormat: outputVideo.pix_fmt,
    width: outputVideo.width,
    height: outputVideo.height,
    frameRate: outputVideo.avg_frame_rate,
    durationSec: Number(outputProbe.format.duration),
    fit: item.fit,
  });
}

const receiptPath = join(outputDir, `${artifactIdArg}-exports.json`);
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(receiptPath);
