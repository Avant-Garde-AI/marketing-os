import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => {
  const files = new Map<string, string>();
  const repo = () => ({
    readFile: async (p: string) => files.get(p) ?? null,
    writeFile: async (p: string, s: string) => { files.set(p, s); },
    list: async () => [...files.keys()],
  });
  return { files, repo, operator: vi.fn(), propose: vi.fn(), lock: vi.fn(), saved: vi.fn() };
});
vi.mock("../templates/agents/lib/social/repo", () => ({ socialRepo: m.repo() }));
vi.mock("../templates/agents/lib/social/review-operator", () => ({ socialReviewOperator: m.operator }));
vi.mock("../templates/agents/lib/actions/propose", () => ({ proposeAction: m.propose }));
vi.mock("../templates/agents/lib/social/register-actions", () => ({
  socialActionDeps: () => ({ repo: m.repo(), withPostLock: m.lock, onPostSaved: m.saved }),
}));

import { ownerEditPost } from "../templates/agents/lib/social/owner-edit";
import { POST as editRoute } from "../templates/agents/app/api/social/post-edit/route";
import { POST as scheduleRoute } from "../templates/agents/app/api/social/scheduling/route";
import { parsePost, postPath, serializePost } from "../templates/agents/lib/social/artifacts";
import { approvalHash } from "../templates/agents/lib/social/actions";
import { generationDeliveryPath } from "../templates/agents/lib/social/generation-delivery";
import { hashPreview } from "../templates/agents/lib/actions/hash";
import type { SocialPost } from "../templates/agents/lib/social/types";

const hex = (c: string) => c.repeat(64);
const time = "2099-01-04T15:00:00Z";
const receipt = { schemaVersion: 1, artifactId: "loop-v1", postId: "loop", inputHash: hex("a"), caption: "Old caption." };
const loop = (over: Partial<SocialPost> = {}): SocialPost => ({
  id: "loop", channel: "instagram", channelAccount: { id: "123", username: "store" }, copy: "Old caption.",
  targetLink: "https://store.example", status: "asset_ready", provenance: [], body: "", plannedAt: time,
  assetRefs: [`social/assets/${hex("c")}.mp4.b64`, `social/assets/${hex("d")}.jpeg.b64`],
  renderedVideo: { version: 1, origin: "generation-delivery", artifactId: "loop-v1", inputHash: hex("a"),
    deliveryHash: hashPreview(receipt), exportHash: hex("b"), sources: [{ ref: "ams:artworks/1/flat", sha256: hex("e") }],
    video: { url: `https://console.example/api/social/assets/store.myshopify.com/${hex("c")}.mp4`, sha256: hex("c"), mimeType: "video/mp4", width: 1080, height: 1920, durationMs: 5042 },
    poster: { url: `https://console.example/api/social/assets/store.myshopify.com/${hex("d")}.jpeg`, sha256: hex("d"), width: 1080, height: 1920 } },
  ...over,
} as SocialPost);
const stored = () => parsePost(m.files.get(postPath("loop"))!);
const request = (url: string, body: unknown, origin = "https://console.example") =>
  new NextRequest(`https://console.example${url}`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllGlobals(); m.files.clear();
  m.files.set(postPath("loop"), serializePost(loop()));
  m.files.set(generationDeliveryPath("loop-v1"), JSON.stringify(receipt));
  m.lock.mockImplementation(async (_id: string, run: () => Promise<unknown>) => run());
  m.operator.mockResolvedValue({ id: "verified", email: "owner@store.example" });
  m.propose.mockResolvedValue({ proposalId: "p1", summary: "schedule" });
  vi.stubEnv("MARKETING_OS_API_URL", "https://gate.example"); vi.stubEnv("ACTIONS_GATE_SECRET", "gate"); vi.stubEnv("SHOPIFY_STORE_URL", "store.myshopify.com");
});

it("changes a video caption without unbinding the video, and moves the receipt with it", async () => {
  const { post, unscheduled } = await ownerEditPost("loop", { copy: "  New caption.  " }, "owner@store.example");
  expect(unscheduled).toBe(false);
  expect(post.copy).toBe("New caption.");
  expect(post.status).toBe("asset_ready");
  const saved = JSON.parse(m.files.get(generationDeliveryPath("loop-v1"))!);
  expect(saved.caption).toBe("New caption.");
  expect(stored().renderedVideo).toMatchObject({ artifactId: "loop-v1", deliveryHash: hashPreview(saved) });
  expect(stored().provenance.at(-1)).toMatchObject({ origin: "owner" });
  expect(m.lock).toHaveBeenCalledTimes(1);
  expect(m.saved).toHaveBeenCalledTimes(1);
});

it("takes a scheduled post off the schedule when its caption changes, and remembers the time", async () => {
  const scheduled = loop({ status: "scheduled", scheduledAt: time });
  m.files.set(postPath("loop"), serializePost({ ...scheduled, approval: { hash: approvalHash(scheduled), at: "2098-12-01T00:00:00Z" } } as SocialPost));
  const { unscheduled } = await ownerEditPost("loop", { copy: "New caption." }, "owner");
  expect(unscheduled).toBe(true);
  expect(stored()).toMatchObject({ status: "asset_ready", plannedAt: time });
  expect(stored().scheduledAt).toBeUndefined();
  expect(stored().approval).toBeUndefined();
});

it("writes nothing when nothing changed, and refuses a published post or a past time", async () => {
  await ownerEditPost("loop", { copy: "Old caption." }, "owner");
  expect(m.saved).not.toHaveBeenCalled();
  await expect(ownerEditPost("loop", { plannedAt: "2001-01-01T00:00:00Z" }, "owner")).rejects.toThrow(/future/);
  m.files.set(postPath("loop"), serializePost(loop({ status: "published" })));
  await expect(ownerEditPost("loop", { copy: "Late edit." }, "owner")).rejects.toThrow(/published/);
});

it("lets only a signed-in owner on the same origin edit", async () => {
  m.operator.mockResolvedValue(null);
  expect((await editRoute(request("/api/social/post-edit", { postId: "loop", copy: "x" }))).status).toBe(401);
  m.operator.mockResolvedValue({ id: "verified" });
  expect((await editRoute(request("/api/social/post-edit", { postId: "loop", copy: "x" }, "https://other.example"))).status).toBe(403);
  expect(stored().copy).toBe("Old caption.");
  const ok = await editRoute(request("/api/social/post-edit", { postId: "loop", copy: "Edited." }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true, copy: "Edited.", status: "asset_ready" });
});

it("schedules in one request through the gate, as the verified owner", async () => {
  const gate = vi.fn()
    .mockResolvedValueOnce(Response.json({ proposals: [] }))
    .mockResolvedValueOnce(Response.json({ status: "executed", message: "Scheduled 1 posts." }));
  vi.stubGlobal("fetch", gate);
  const res = await scheduleRoute(request("/api/social/scheduling", { operation: "schedule", postId: "loop" }));
  expect(res.status).toBe(200);
  expect(m.propose).toHaveBeenCalledWith({ kind: "social.schedule_batch", params: { entries: [{ postId: "loop", scheduledAt: time,
    expectedMaterialHash: approvalHash({ ...loop(), scheduledAt: time }) }] } });
  expect(JSON.parse(gate.mock.calls[1][1].body)).toEqual({ proposalId: "p1", approve: true, actor: "social-review:verified" });
});

it("will not schedule without a future time or without a session", async () => {
  m.files.set(postPath("loop"), serializePost(loop({ plannedAt: "2001-01-01T00:00:00Z" })));
  const past = await scheduleRoute(request("/api/social/scheduling", { operation: "schedule", postId: "loop" }));
  expect(past.status).toBe(409);
  expect(await past.json()).toMatchObject({ needsTime: true });
  m.operator.mockResolvedValue(null);
  expect((await scheduleRoute(request("/api/social/scheduling", { operation: "schedule", postId: "loop" }))).status).toBe(401);
  expect(m.propose).not.toHaveBeenCalled();
});
