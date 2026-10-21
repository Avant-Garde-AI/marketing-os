import { beforeEach, expect, it, vi } from "vitest";
import { AUTOPILOT_AUTHOR_TOOLS, audienceKeysFor, eligibility, stageWindow, type EmailAutopilotPolicy } from "../templates/agents/lib/email/autopilot";
import { campaignPath, parseCampaign, serializeCampaign, serializeStrategy } from "../templates/agents/lib/email/artifacts";
import type { EmailCampaign, EmailStrategy } from "../templates/agents/lib/email/types";

const files = new Map<string, string>();
const repo = {
  readFile: async (p: string) => files.get(p) ?? null,
  writeFile: async (p: string, s: string) => { files.set(p, s); },
  list: async (prefix: string) => [...files.keys()].filter((k) => k.startsWith(prefix)),
};

const strategy: EmailStrategy = {
  audiences: [
    { key: "full-reach", klaviyoRef: { type: "segment", id: "V7" }, description: "everyone", cadenceCap: 8 },
    { key: "full-reach-us", klaviyoRef: { type: "segment", id: "Y7" }, description: "US only", cadenceCap: 4, rotation: false },
  ],
  archetypes: [{ name: "artist-drop", messagingRef: "m", weight: 4 }, { name: "promotion", messagingRef: "p", weight: 0 }],
  campaignsPerMonth: 7,
  sendDays: ["tuesday", "thursday"],
  sendTime: "10:00",
  body: "",
} as EmailStrategy;

const policy: EmailAutopilotPolicy = {
  schemaVersion: 1, enabled: true, timeZone: "America/Chicago", firstWindowStart: "2026-11-23", batchDays: 14,
  leadDays: 7, holdHours: 48, sendDays: ["tuesday", "thursday"], localTime: "10:00",
  archetypes: ["artist-drop"], audiences: ["full-reach"], maxCampaignsPerWindow: 6,
};
const window = {
  from: "2026-11-23", through: "2026-12-06",
  slots: ["2026-11-24T16:00:00.000Z", "2026-11-26T16:00:00.000Z", "2026-12-01T16:00:00.000Z", "2026-12-03T16:00:00.000Z"],
};

const campaign = (id: string, over: Partial<EmailCampaign> = {}): EmailCampaign => ({
  id, archetype: "artist-drop", audience: { included: [{ type: "segment", id: "V7" }], excluded: [] },
  subjectCandidates: [], subject: `Subject ${id}`, previewText: "p", skeletonRef: "frame",
  sections: [{ slot: "intro", type: "html", blocks: [{ kind: "paragraph", text: "Hi" }] }],
  utm: { campaign: id, source: "klaviyo", medium: "email" }, provenance: [], status: "proposed", body: "",
  scheduledAt: "2026-11-24T10:00:00-06:00", ...over,
} as EmailCampaign);
const put = (c: EmailCampaign) => files.set(campaignPath(c.id), serializeCampaign(c));
const status = (id: string) => parseCampaign(files.get(campaignPath(id))!).status;

/** A gate that behaves like the real one for covered kinds: approve and draft run now, schedule waits. */
const gate = vi.fn(async ({ kind, params }: { kind: string; params: Record<string, unknown> }) => {
  const id = String(params.campaignId);
  const c = parseCampaign(files.get(campaignPath(id))!);
  if (kind === "email.approve_campaign") { put({ ...c, status: "approved" }); return { proposalId: `a-${id}`, released: { status: "executed", message: "ok" } }; }
  if (kind === "klaviyo.create_campaign_draft") { put({ ...c, status: "drafted" }); return { proposalId: `d-${id}`, released: { status: "executed", message: "ok" } }; }
  if (c.status !== "drafted") throw new Error("only drafted campaigns schedule");
  return { proposalId: `s-${id}` };
});

beforeEach(() => {
  files.clear();
  gate.mockClear();
  files.set("email/strategy.md", serializeStrategy(strategy));
});

const stage = (deadline = Date.now() + 60_000) =>
  stageWindow({ repo, shop: "store.myshopify.com", grantId: "g1", batchId: "b1", policy, window, deadline, propose: gate });

it("walks a proposed campaign through approve and draft, then leaves its send on hold", async () => {
  put(campaign("c1"));
  const { done, items } = await stage();
  expect(done).toBe(true);
  expect(gate.mock.calls.map(([c]) => c.kind)).toEqual(["email.approve_campaign", "klaviyo.create_campaign_draft", "klaviyo.schedule_campaign"]);
  expect(items).toMatchObject([{ campaignId: "c1", state: "held", scheduleProposalId: "s-c1" }]);
  expect(status("c1")).toBe("drafted");
  // Every proposal carries the claims the platform re-verifies.
  expect(gate.mock.calls[0]![0].delegation).toMatchObject({
    grantId: "g1", batchId: "b1",
    claims: { campaignId: "c1", archetype: "artist-drop", audienceKeys: ["full-reach"], scheduledAt: "2026-11-24T10:00:00-06:00" },
  });
});

it("leaves off-policy campaigns for a person and says why, without proposing anything", async () => {
  put(campaign("promo", { archetype: "promotion" }));
  put(campaign("us", { audience: { included: [{ type: "segment", id: "Y7" }], excluded: [] } }));
  put(campaign("sat", { scheduledAt: "2026-11-28T10:00:00-06:00" }));
  const { items } = await stage();
  expect(gate).not.toHaveBeenCalled();
  expect(Object.fromEntries(items.map((i) => [i.campaignId, i.reason]))).toEqual({
    promo: "promotion is not covered by the grant",
    us: "audience full-reach-us is not covered by the grant",
    sat: "not on a send slot",
  });
});

it("a gate refusal leaves the campaign for a person with the gate's reason", async () => {
  put(campaign("c1"));
  const refusing = vi.fn(async () => ({ refused: "window already has 6 delegated campaigns" }));
  const { items } = await stageWindow({ repo, shop: "s", grantId: "g1", batchId: "b1", policy, window, deadline: Date.now() + 60_000, propose: refusing });
  expect(items).toMatchObject([{ campaignId: "c1", state: "manual", reason: "window already has 6 delegated campaigns" }]);
});

it("re-drafts a drafted campaign whose schedule preview refuses (edited since drafting)", async () => {
  put(campaign("c1", { status: "drafted" }));
  let first = true;
  const editedOnce = vi.fn(async (input: { kind: string; params: Record<string, unknown> }) => {
    if (input.kind === "klaviyo.schedule_campaign" && first) { first = false; throw new Error("changed since it was drafted"); }
    return gate(input as never);
  });
  const { items } = await stageWindow({ repo, shop: "s", grantId: "g1", batchId: "b1", policy, window, deadline: Date.now() + 60_000, propose: editedOnce });
  expect(editedOnce.mock.calls.map(([c]) => c.kind)).toEqual(["klaviyo.schedule_campaign", "klaviyo.create_campaign_draft", "klaviyo.schedule_campaign"]);
  expect(items[0]).toMatchObject({ state: "held" });
});

it("stops at the deadline and reports it is not done; already-scheduled and sent campaigns are not touched", async () => {
  put(campaign("c1"));
  put(campaign("done", { status: "scheduled", scheduledAt: "2026-11-26T10:00:00-06:00" }));
  put(campaign("old", { status: "sent", scheduledAt: "2026-12-01T10:00:00-06:00" }));
  const { done, items } = await stage(Date.now() - 1);
  expect(done).toBe(false);
  expect(gate).not.toHaveBeenCalled();
  expect(items).toMatchObject([{ campaignId: "done", state: "scheduled" }]);
});

it("ignores campaigns outside the window", async () => {
  put(campaign("next", { scheduledAt: "2026-12-08T10:00:00-06:00" }));
  const { items } = await stage();
  expect(items).toEqual([]);
});

it("maps audiences through the strategy, and refuses refs it does not know", () => {
  expect(audienceKeysFor(campaign("c"), strategy)).toEqual(["full-reach"]);
  expect(audienceKeysFor(campaign("c", { audience: { included: [{ type: "list", id: "nope" }], excluded: [] } }), strategy)).toBeNull();
  expect(eligibility(campaign("c", { audience: { included: [{ type: "list", id: "nope" }], excluded: [] } }), strategy, policy, window))
    .toEqual({ reason: "audience is not a strategy audience" });
});

it("the authoring token's tool surface can write campaigns but never approve, stage, schedule or publish", () => {
  expect(AUTOPILOT_AUTHOR_TOOLS.has("email_campaign_upsert")).toBe(true);
  for (const name of AUTOPILOT_AUTHOR_TOOLS) {
    expect(name).not.toMatch(/^(propose_|publish_)|strategy_upsert|partials_upsert|notes_resolve|^social_(?!calendar_read)/);
  }
});
