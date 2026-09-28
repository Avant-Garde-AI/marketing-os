import { describe, expect, it, vi, afterEach } from "vitest";
import { renderedSequenceSchema, renderedVideoSchema, serializePost, parsePost } from "../src/artifacts";
import { approvalHash, createSocialActions, verifyScheduleConsent } from "../src/actions";
import { postReviewAssets } from "../src/projection";
import { nextPost, schedulingGaps } from "../src/authoring";
import type { SocialPost } from "../src/types";
import { createInstagramAdapter, igCreateCarouselContainer } from "../../../marketing-os/templates/agents/lib/social/channels/instagram";
const slide = (n: number) => ({ beatId: `beat-${n}`, boardName: `board-${n}`, url: `https://assets.example.com/${n}.jpeg`, sha256: String(n).repeat(64), width: 1080, height: 1350 });
const sequence = () => ({ version: 1 as const, storyboardId: "story", storyboardHash: "a".repeat(64), reviewHash: "b".repeat(64), slides: [slide(1), slide(2)] });
const post = (): SocialPost => ({ id: "test", channel: "instagram", copy: "Caption", targetLink: "https://example.com", assetRefs: [], provenance: [], status: "asset_ready", body: "", renderedSequence: sequence() });
const videoPost = (): SocialPost => ({ ...post(), renderedSequence: undefined, assetRefs: ["shopify:artwork-1"], renderedVideo: {
 version: 1, storyboardId: "story", storyboardHash: "a".repeat(64), reviewHash: "b".repeat(64),
 sources: [{ ref: "shopify:artwork-1", sha256: "c".repeat(64) }],
 video: { url: "https://assets.example.com/render.mp4", sha256: "d".repeat(64), mimeType: "video/mp4", width: 1080, height: 1920, durationMs: 8000 },
 poster: { url: "https://assets.example.com/poster.jpg", sha256: "e".repeat(64), width: 1080, height: 1920 },
} });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("ordered realized assets", () => {
 it("roundtrips and projects in exact order, binding every slide to approval", () => {
  const p = post(); expect(parsePost(serializePost(p))).toEqual(p);
  expect(postReviewAssets(p, "")).toEqual(sequence().slides.map(s => s.url));
  const hash = approvalHash(p); p.renderedSequence!.slides.reverse(); expect(approvalHash(p)).not.toBe(hash);
  p.renderedSequence!.slides[0]!.sha256 = "c".repeat(64); expect(approvalHash(p)).not.toBe(hash);
 });
 it("rejects missing, duplicate, unsafe and malformed render material", () => {
  for (const slides of [[], Array(11).fill(slide(1)), [slide(1), slide(1)], [{...slide(1), sha256:"bad"}], [{...slide(1),url:"http://localhost/a.jpeg"}], [{...slide(1),url:"not a url"}]]) expect(renderedSequenceSchema.safeParse({...sequence(), slides}).success).toBe(false);
 });
 it("invalidates realization and consent after an authored material edit", () => {
  const p=post(); p.status="scheduled"; p.approval={hash:approvalHash(p),at:new Date().toISOString()};
  const next=nextPost(p,{id:p.id,copy:"Changed"}); expect(next.post.renderedSequence).toBeUndefined(); expect(next.post.approval).toBeUndefined(); expect(next.post.status).toBe("proposed");
 });
 it("fails closed at schedule preview for unsupported channels", async () => {
  const p=post(); const action=createSocialActions({repo:{readFile:async()=>serializePost(p),writeFile:async()=>{},list:async()=>[]},assetUrl:()=>{throw Error("legacy used");},adapterFor:()=>({channel:"threads",publish:async()=>({platformId:"",permalink:""})})}).schedulePost;
  await expect(action.preview({postId:p.id,scheduledAt:"2099-01-01T00:00:00Z"})).rejects.toThrow("does not support");
 });
 it("opens the full sequence review from schedule and immediate publish previews", async () => {
  const p=post(); const review="https://console.example.com/review/social/test";
  const actions=createSocialActions({repo:{readFile:async()=>serializePost(p),writeFile:async()=>{},list:async()=>[]},assetUrl:()=>slide(1).url,reviewUrl:()=>review,adapterFor:()=>({channel:"instagram",publish:async()=>({platformId:"",permalink:""}),publishSequence:async()=>({platformId:"",permalink:""})})});
  const scheduled=await actions.schedulePost.preview({postId:p.id,scheduledAt:"2099-01-01T00:00:00Z"});
  expect(scheduled.previewUrl).toBe(review); expect(scheduled.summary).toContain("all 2 ordered slides");
  expect((await actions.publishPost.preview({postId:p.id})).previewUrl).toBe(review);
 });
 it("creates inert children then parent in order, never publishes from container helper", async () => {
  const calls: {path:string,params:URLSearchParams}[]=[];
  vi.stubGlobal("fetch",vi.fn(async (url: URL, init: RequestInit) => {
   calls.push({path:url.pathname,params:new URLSearchParams(init.body as string)});
   return {ok:true,json:async()=>init.method==="POST"?{id:`c${calls.length}`}:{status_code:"FINISHED"}};
  }));
  await igCreateCarouselContainer("token","user",{imageUrls:sequence().slides.map(s=>s.url),caption:"caption"});
  const writes=calls.filter(c=>c.params.has("access_token"));
  expect(writes.map(c=>c.params.get("image_url"))).toEqual([slide(1).url,slide(2).url,null]);
  expect(writes[2]!.params.get("children")).toBe("c1,c3"); expect(calls.some(c=>c.path.endsWith("media_publish"))).toBe(false);
 });
 it("publishes only the finished carousel parent through the adapter", async () => {
  vi.stubEnv("SOCIAL_IG_USER_ID","user"); const calls: string[]=[];
  vi.stubGlobal("fetch",vi.fn(async (url:URL,init:RequestInit)=>{calls.push(url.pathname);return {ok:true,json:async()=>url.pathname.endsWith("media_publish")?{id:"published"}:init.method==="POST"?{id:`c${calls.length}`}:{status_code:"FINISHED",permalink:"https://instagram.com/p/published"}};}));
  const adapter=createInstagramAdapter({accessToken:async()=>"token"});
  await adapter.publishSequence!(post(),sequence().slides.map(s=>s.url));
  expect(calls.filter(c=>c.endsWith("media_publish"))).toHaveLength(1); expect(calls.indexOf("/v23.0/user/media_publish")).toBe(6);
 });
});

describe("reviewed rendered video", () => {
 it("roundtrips the full receipt and hashes video, poster, and source bytes", () => {
  const p = videoPost();
  expect(parsePost(serializePost(p))).toEqual(p);
  expect(postReviewAssets(p, "")).toEqual([p.renderedVideo!.poster.url]);
  const original = approvalHash(p);
  p.renderedVideo!.video.sha256 = "f".repeat(64);
  expect(approvalHash(p)).not.toBe(original);
  const changedVideo = approvalHash(p);
  p.renderedVideo!.poster.sha256 = "1".repeat(64);
  expect(approvalHash(p)).not.toBe(changedVideo);
  const changedPoster = approvalHash(p);
  p.renderedVideo!.sources[0]!.sha256 = "2".repeat(64);
  expect(approvalHash(p)).not.toBe(changedPoster);
 });
 it("rejects unsafe media, malformed hashes, duplicate sources, and mixed render kinds", () => {
  const base = videoPost().renderedVideo!;
  for (const receipt of [
   { ...base, video: { ...base.video, url: "http://localhost/render.mp4" } },
   { ...base, video: { ...base.video, url: "not a url" } },
   { ...base, video: { ...base.video, url: "https://assets.example.com/render.mov" } },
   { ...base, poster: { ...base.poster, sha256: "bad" } },
   { ...base, poster: { ...base.poster, url: "not a url" } },
   { ...base, sources: [base.sources[0], base.sources[0]] },
   { ...base, video: { ...base.video, durationMs: 0 } },
  ]) expect(renderedVideoSchema.safeParse(receipt).success).toBe(false);
  expect(() => serializePost({ ...videoPost(), renderedSequence: sequence() })).toThrow(/both/);
 });
 it("generic authoring ignores a fabricated render receipt", () => {
  const candidate = videoPost();
  const { post: authored } = nextPost(null, { id: candidate.id, channel: candidate.channel, copy: candidate.copy,
   targetLink: candidate.targetLink, renderedVideo: candidate.renderedVideo } as Parameters<typeof nextPost>[1]);
  expect(authored.renderedVideo).toBeUndefined();
  expect(authored.status).toBe("proposed");
 });
 it("reports the video publishing limit as a scheduling gap", () => {
  expect(schedulingGaps(videoPost())).toContain("Video publishing is not available yet");
 });
 it("authored copy and source binding edits invalidate the receipt and consent", async () => {
  const p = videoPost(); p.status = "scheduled"; p.scheduledAt = "2099-01-01T00:00:00Z";
  p.approval = { hash: approvalHash(p), at: new Date().toISOString() };
  expect(await verifyScheduleConsent(p, {})).toEqual({ ok: true });
  p.renderedVideo!.sources[0]!.sha256 = "f".repeat(64);
  expect(await verifyScheduleConsent(p, {})).toMatchObject({ ok: false });
  const copy = nextPost(videoPost(), { id: p.id, copy: "Changed" });
  expect(copy.post.renderedVideo).toBeUndefined(); expect(copy.post.status).toBe("proposed");
  const sources = nextPost(videoPost(), { id: p.id, assetRefs: ["shopify:artwork-2"] });
  expect(sources.post.renderedVideo).toBeUndefined();
  const scheduled = videoPost(); scheduled.status = "scheduled"; scheduled.approval = { hash: approvalHash(scheduled), at: new Date().toISOString() };
  const edited = nextPost(scheduled, { id: scheduled.id, copy: "Changed" });
  expect(edited.post.approval).toBeUndefined(); expect(edited.consentCleared).toBe(true);
 });
 it("refuses schedule and immediate publish even if an image adapter is present", async () => {
  const p = videoPost();
  const actions = createSocialActions({
   repo: { readFile: async () => serializePost(p), writeFile: async () => {}, list: async () => [] },
   assetUrl: () => p.renderedVideo!.poster.url,
   adapterFor: () => ({ channel: "instagram", publish: async () => ({ platformId: "wrong", permalink: "" }) }),
  });
  await expect(actions.schedulePost.preview({ postId: p.id, scheduledAt: "2099-01-01T00:00:00Z" })).rejects.toThrow(/governed video channel adapter/);
  await expect(actions.schedulePost.execute({ postId: p.id, scheduledAt: "2099-01-01T00:00:00Z" })).rejects.toThrow(/governed video channel adapter/);
  await expect(actions.publishPost.preview({ postId: p.id })).rejects.toThrow(/governed video channel adapter/);
  await expect(actions.publishPost.execute({ postId: p.id })).rejects.toThrow(/governed video channel adapter/);
 });
});
