import { describe, expect, it, vi, afterEach } from "vitest";
import { renderedSequenceSchema, serializePost, parsePost } from "../src/artifacts";
import { approvalHash, createSocialActions } from "../src/actions";
import { postReviewAssets } from "../src/projection";
import { nextPost } from "../src/authoring";
import type { SocialPost } from "../src/types";
import { createInstagramAdapter, igCreateCarouselContainer } from "../../../marketing-os/templates/agents/lib/social/channels/instagram";
const slide = (n: number) => ({ beatId: `beat-${n}`, boardName: `board-${n}`, url: `https://assets.example.com/${n}.jpeg`, sha256: String(n).repeat(64), width: 1080, height: 1350 });
const sequence = () => ({ version: 1 as const, storyboardId: "story", storyboardHash: "a".repeat(64), reviewHash: "b".repeat(64), slides: [slide(1), slide(2)] });
const post = (): SocialPost => ({ id: "test", channel: "instagram", copy: "Caption", targetLink: "https://example.com", assetRefs: [], provenance: [], status: "asset_ready", body: "", renderedSequence: sequence() });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("ordered realized assets", () => {
 it("roundtrips and projects in exact order, binding every slide to approval", () => {
  const p = post(); expect(parsePost(serializePost(p))).toEqual(p);
  expect(postReviewAssets(p, "")).toEqual(sequence().slides.map(s => s.url));
  const hash = approvalHash(p); p.renderedSequence!.slides.reverse(); expect(approvalHash(p)).not.toBe(hash);
  p.renderedSequence!.slides[0]!.sha256 = "c".repeat(64); expect(approvalHash(p)).not.toBe(hash);
 });
 it("rejects missing, duplicate, unsafe and malformed render material", () => {
  for (const slides of [[], Array(11).fill(slide(1)), [slide(1), slide(1)], [{...slide(1), sha256:"bad"}], [{...slide(1),url:"http://localhost/a.jpeg"}]]) expect(renderedSequenceSchema.safeParse({...sequence(), slides}).success).toBe(false);
 });
 it("invalidates realization and consent after an authored material edit", () => {
  const p=post(); p.status="scheduled"; p.approval={hash:approvalHash(p),at:new Date().toISOString()};
  const next=nextPost(p,{id:p.id,copy:"Changed"}); expect(next.post.renderedSequence).toBeUndefined(); expect(next.post.approval).toBeUndefined(); expect(next.post.status).toBe("proposed");
 });
 it("fails closed at schedule preview for unsupported channels", async () => {
  const p=post(); const action=createSocialActions({repo:{readFile:async()=>serializePost(p),writeFile:async()=>{},list:async()=>[]},assetUrl:()=>{throw Error("legacy used");},adapterFor:()=>({channel:"threads",publish:async()=>({platformId:"",permalink:""})})}).schedulePost;
  await expect(action.preview({postId:p.id,scheduledAt:"2099-01-01T00:00:00Z"})).rejects.toThrow("does not support");
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
