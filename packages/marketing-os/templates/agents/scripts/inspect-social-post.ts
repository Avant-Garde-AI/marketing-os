/** Offline/read-only capture. Writes ONLY a local observation file with --out; submit it through a reviewed PR.
 * Run from agents/: npx tsx scripts/inspect-social-post.ts --post <id> [--insights] [--out <directory>]
 * Video diagnostics require installed ffmpeg/ffprobe. --insights uses this deployment's broker token;
 * load existing credentials through the shell/Node env-file support, never pass a token as an argument.
 */
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parsePost, postPath } from "../lib/social/artifacts";
import { readSocialVideo } from "../lib/social/video-assets";
import { measureFrameDifferences, observationSchema, observationPath, postCreativeHash, postMediaHash, type PostObservation } from "../lib/social/observations";
import { instagramPostOutcomes } from "../lib/social/channels/instagram";
import { brokerTokenSource } from "../lib/social/channels";
import { HOSTED, getTenant, runWithTenant } from "../lib/tenant-context";

const argv = process.argv.slice(2);
const option = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };

async function main() {
  const postId = option("--post");
  if (!postId || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$/.test(postId)) throw new Error("Supply a valid --post id");
  const out = option("--out"), insights = argv.includes("--insights");
  if (argv.includes("--out") && (!out || out.startsWith("--"))) throw new Error("Supply an output directory");
  if (HOSTED) throw new Error("Offline capture requires a client-owned checkout, not pooled deployment identity");
  const root = process.cwd();
  const repo = { readFile: async (path: string) => {
    try { return await readFile(join(root, path), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }, writeFile: async () => { throw new Error("Capture never writes through the store repo"); }, list: async () => [] as string[] };
  const raw = await repo.readFile(postPath(postId));
  if (!raw) throw new Error("Post artifact not found; run from the agents directory");
  const post = parsePost(raw);
  if (post.id !== postId) throw new Error("Post identity mismatch");
  const observedAt = new Date().toISOString();
  const record: PostObservation = { schemaVersion: 1, postId, mediaHash: postMediaHash(post), creativeHash: postCreativeHash(post), observedAt };
  if (post.renderedVideo) {
    const bytes = await readSocialVideo(repo, post.renderedVideo.video.sha256);
    if (!bytes) throw new Error("Bound video bytes missing");
    const scratch = await mkdtemp(join(tmpdir(), "social-frame-check-"));
    try {
      const path = join(scratch, "source.mp4");
      await writeFile(path, bytes);
      const metadata = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path], { encoding: "utf8", timeout: 30_000 }));
      const width = metadata.streams?.[0]?.width, height = metadata.streams?.[0]?.height, durationMs = Number(metadata.format?.duration) * 1000;
      if (width !== post.renderedVideo.video.width || height !== post.renderedVideo.video.height || !Number.isFinite(durationMs) ||
        durationMs <= 0 || durationMs > 60_000 || Math.abs(durationMs - post.renderedVideo.video.durationMs) > 150)
        throw new Error("Video dimensions/duration differ from the bound receipt or exceed the 60-second inspection limit");
      const sampleWidth = 160, sampleHeight = Math.max(2, Math.round(height / width * sampleWidth / 2) * 2), sampleFps = 6;
      const frames = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-an", "-vf", `scale=${sampleWidth}:${sampleHeight},fps=${sampleFps},format=gray`, "-f", "rawvideo", "pipe:1"], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
      record.motion = { method: "grayscale-frame-difference-v1", videoSha256: post.renderedVideo.video.sha256,
        width, height, durationMs, sampleWidth, sampleHeight, sampleFps, ...measureFrameDifferences(frames, sampleWidth * sampleHeight), littleChangeThresholdPercent: 0.25 };
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
  if (insights) {
    const tenant = getTenant();
    if (!tenant.shop) throw new Error("A configured tenant is required for Instagram readback");
    record.outcomes = await runWithTenant(tenant, () => instagramPostOutcomes(post, brokerTokenSource, new Date(observedAt)));
  }
  const validated = observationSchema.parse(record);
  if (out) {
    const path = resolve(out, observationPath(validated));
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(validated, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ postId, observationPath: path, motionCaptured: !!record.motion, outcomesCaptured: !!record.outcomes }));
  } else console.log(JSON.stringify(validated, null, 2));
}
main().catch(() => {
  // Provider/CLI error strings may contain sensitive request details. Keep credentials out of stdout/stderr.
  console.error("Capture failed. Check post identity/media, ffmpeg installation, configured tenant and Instagram access. No post or schedule was changed.");
  process.exitCode = 1;
});
