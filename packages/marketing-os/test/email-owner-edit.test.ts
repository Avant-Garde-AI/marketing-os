import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => {
  const files = new Map<string, string>();
  return { files, synced: vi.fn(), propose: vi.fn(), operator: vi.fn(),
    repo: { readFile: async (p: string) => files.get(p) ?? null, writeFile: async (p: string, s: string) => { files.set(p, s); }, list: async () => [...files.keys()] } };
});
vi.mock("../templates/agents/lib/email/repo", () => ({ emailRepo: m.repo }));
vi.mock("../templates/agents/lib/email/index-sync", () => ({ syncCampaignIndex: m.synced }));
vi.mock("../templates/agents/lib/actions/propose", () => ({ proposeAction: m.propose }));
vi.mock("../templates/agents/lib/social/review-operator", () => ({ socialReviewOperator: m.operator }));

import { ownerEditCampaign } from "../templates/agents/lib/email/owner-edit";
import { POST as editRoute } from "../templates/agents/app/api/email/campaign-edit/route";
import { POST as advanceRoute } from "../templates/agents/app/api/email/advance/route";
import { campaignPath, parseCampaign, serializeCampaign } from "../templates/agents/lib/email/artifacts";
import { runWithTenant } from "../templates/agents/lib/tenant-context";
import type { EmailCampaign } from "../templates/agents/lib/email/types";

const future = "2099-01-04T15:00:00.000Z";
const campaign = (over: Partial<EmailCampaign> = {}): EmailCampaign => ({
  id: "c1", archetype: "artist-update", audience: { included: [{ type: "list", id: "L1", name: "Artists" }], excluded: [] },
  subjectCandidates: ["Old subject"], subject: "Old subject", previewText: "Old preview", skeletonRef: "frame",
  sections: [{ slot: "intro", type: "html", blocks: [{ kind: "paragraph", text: "Hello" }] }],
  utm: { campaign: "c1", source: "klaviyo", medium: "email" }, provenance: [], status: "drafted", body: "", scheduledAt: future,
  ...over,
} as EmailCampaign);
const stored = () => parseCampaign(m.files.get(campaignPath("c1"))!);
const inTenant = <T,>(fn: () => Promise<T>) => runWithTenant({ shop: "store.myshopify.com", storeSlug: "store" }, fn);
const request = (url: string, body: unknown) =>
  new NextRequest(`https://console.example${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
/** The gate: every approval executes, and a cancel moves the stored campaign back to drafted. */
const gate = () => vi.fn(async (_url: string, init: { body: string }) => {
  const { proposalId } = JSON.parse(init.body);
  if (proposalId === "cancel") m.files.set(campaignPath("c1"), serializeCampaign(campaign({ status: "drafted" })));
  return Response.json({ status: "executed", message: "done" });
});

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllGlobals(); m.files.clear();
  m.files.set(campaignPath("c1"), serializeCampaign(campaign()));
  m.operator.mockResolvedValue({ id: "u1", email: "owner@store.example" });
  m.propose.mockImplementation(async ({ kind }: { kind: string }) => ({ proposalId: kind === "klaviyo.cancel_send" ? "cancel" : kind, summary: kind, posted: true, channel: null }));
  vi.stubEnv("MARKETING_OS_API_URL", "https://gate.example"); vi.stubEnv("ACTIONS_GATE_SECRET", "gate"); vi.stubEnv("SHOPIFY_STORE_URL", "store.myshopify.com");
});

it("changes subject, preview text and send time, keeps the index in step, and records who did it", async () => {
  const next = await inTenant(() => ownerEditCampaign("c1", { subject: "  New   subject ", previewText: "New preview", scheduledAt: "2099-02-01T16:00:00Z" }, "owner"));
  expect(next).toMatchObject({ subject: "New subject", previewText: "New preview", scheduledAt: "2099-02-01T16:00:00.000Z", status: "drafted" });
  expect(stored().subjectCandidates).toEqual(["New subject", "Old subject"]);
  expect(stored().provenance.at(-1)).toMatchObject({ origin: "owner" });
  expect(m.synced).toHaveBeenCalledTimes(1);
});

it("writes nothing when nothing changed and refuses empty text, past times and sent emails", async () => {
  await inTenant(() => ownerEditCampaign("c1", { subject: "Old subject", scheduledAt: future }, "owner"));
  expect(m.synced).not.toHaveBeenCalled();
  await expect(inTenant(() => ownerEditCampaign("c1", { subject: "   " }, "owner"))).rejects.toThrow(/empty/);
  await expect(inTenant(() => ownerEditCampaign("c1", { scheduledAt: "2001-01-01T00:00:00Z" }, "owner"))).rejects.toThrow(/future/);
  m.files.set(campaignPath("c1"), serializeCampaign(campaign({ status: "sent" })));
  await expect(inTenant(() => ownerEditCampaign("c1", { subject: "Late" }, "owner"))).rejects.toThrow(/sent/);
});

it("cancels a scheduled send through the gate before editing it", async () => {
  m.files.set(campaignPath("c1"), serializeCampaign(campaign({ status: "scheduled" })));
  const fetchMock = gate(); vi.stubGlobal("fetch", fetchMock);
  const res = await editRoute(request("/api/email/campaign-edit", { campaignId: "c1", subject: "Fixed subject" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, status: "drafted", subject: "Fixed subject", unscheduled: true });
  expect(m.propose).toHaveBeenCalledWith({ kind: "klaviyo.cancel_send", params: { campaignId: "c1", revertToDraft: true } });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ approve: true, actor: "console:owner@store.example" });
});

it("re-drafts a stale Klaviyo draft on its own when scheduling", async () => {
  let scheduleAttempts = 0;
  m.propose.mockImplementation(async ({ kind }: { kind: string }) => {
    if (kind === "klaviyo.schedule_campaign" && scheduleAttempts++ === 0)
      throw new Error('campaign "c1" changed since it was drafted — re-run klaviyo.create_campaign_draft so what you approve is what sends');
    return { proposalId: kind, summary: kind, posted: true, channel: null };
  });
  vi.stubGlobal("fetch", gate());
  const res = await advanceRoute(request("/api/email/advance", { campaignId: "c1", through: true }));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body).toMatchObject({ ok: true, status: "scheduled" });
  expect(m.propose.mock.calls.map(([call]) => call.kind)).toEqual(["klaviyo.schedule_campaign", "klaviyo.create_campaign_draft", "klaviyo.schedule_campaign"]);
  expect(body.steps.map((s: { label: string }) => s.label)).toEqual(["Update the Klaviyo draft", "Schedule the send"]);
});

it("stops and says why when a step is refused, without claiming success", async () => {
  m.propose.mockRejectedValue(new Error("Klaviyo does not know audience L1"));
  vi.stubGlobal("fetch", gate());
  const res = await advanceRoute(request("/api/email/advance", { campaignId: "c1", through: true }));
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ ok: false, status: "drafted", steps: [{ ok: false, message: "Klaviyo does not know audience L1" }] });
});
