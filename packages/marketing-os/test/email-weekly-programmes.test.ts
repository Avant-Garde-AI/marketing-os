import { beforeEach, expect, it, vi } from "vitest";
// Weekly programmes (docs/plans/EMAIL-AUTOPILOT.md in marketing-os-app): the
// store's half — the stager's batch filter, the activation date, the policy
// parse, and the "follows" audience the draft action re-points.
vi.mock("../templates/agents/lib/actions/propose", () => ({
  proposeDelegated: vi.fn(() => { throw new Error("Use the injected gate in autopilot unit tests"); }),
}));
vi.mock("../templates/agents/lib/email/index-sync", () => ({ syncCampaignIndex: vi.fn() }));
// The draft Action's assembly and discount checks reach generated-console
// dependencies (htmlparser2, the Shopify client) this CLI suite does not install.
vi.mock("../templates/agents/lib/email-assembly/invariants", () => ({
  DEFAULT_ALLOWED_IMAGE_HOSTS: ["klaviyo.com"],
  hostAllowed: () => true,
}));
vi.mock("../templates/agents/lib/email/discount-refs", () => ({
  checkDiscounts: async () => ({ errors: [], warnings: [], checks: [] }),
}));
import { parseAutopilotPolicy, stageWindow, type EmailAutopilotPolicy } from "../templates/agents/lib/email/autopilot";
import { activationStart } from "../templates/agents/lib/autopilot/activation";
import { createEmailActions } from "../templates/agents/lib/email/actions";
import { campaignPath, parseCampaign, parseStrategy, serializeCampaign, serializeStrategy } from "../templates/agents/lib/email/artifacts";
import { runWithTenant } from "../templates/agents/lib/tenant-context";
import type { EmailCampaign, EmailStrategy, KlaviyoClient } from "../templates/agents/lib/email/types";

const files = new Map<string, string>();
const repo = {
  readFile: async (p: string) => files.get(p) ?? null,
  writeFile: async (p: string, s: string) => { files.set(p, s); },
  list: async (prefix: string) => [...files.keys()].filter((k) => k.startsWith(prefix)),
};

const strategy: EmailStrategy = {
  audiences: [
    { key: "full-reach", klaviyoRef: { type: "segment", id: "V7" }, description: "everyone", cadenceCap: 8 },
    { key: "engaged-or-new", klaviyoRef: { type: "segment", id: "U4" }, description: "engaged", cadenceCap: 5, rotation: false },
    {
      key: "new-artists-clickers", klaviyoRef: { type: "segment", id: "CLK" }, description: "clicked the latest Sunday send",
      cadenceCap: 5, rotation: false, follows: { archetype: "new-artists-weekly", metric: "clicked_email" },
    },
  ],
  archetypes: [
    { name: "artist-drop", messagingRef: "m", weight: 4 },
    { name: "new-artists-weekly", messagingRef: "n", weight: 0 },
    { name: "artist-traction", messagingRef: "t", weight: 0 },
  ],
  campaignsPerMonth: 7,
  sendDays: ["tuesday", "thursday"],
  sendTime: "10:00",
  body: "",
} as EmailStrategy;

const campaign = (id: string, over: Partial<EmailCampaign> = {}): EmailCampaign => ({
  id, archetype: "artist-drop", audience: { included: [{ type: "segment", id: "V7", key: "full-reach" }], excluded: [] },
  subjectCandidates: [], subject: `Subject ${id}`, previewText: "p", skeletonRef: "frame",
  sections: [{ slot: "intro", type: "html", blocks: [{ kind: "paragraph", text: "Hi" }] }],
  utm: { campaign: id, source: "klaviyo", medium: "email" }, provenance: [], status: "proposed", body: "",
  scheduledAt: "2026-11-03T16:00:00.000Z", ...over,
} as EmailCampaign);
const put = (c: EmailCampaign) => files.set(campaignPath(c.id), serializeCampaign(c));

beforeEach(() => {
  files.clear();
  files.set("email/strategy.md", serializeStrategy(strategy));
});

it("the strategy keeps a follows audience through a round trip", () => {
  const back = parseStrategy(serializeStrategy(strategy));
  expect(back.audiences.find((a) => a.key === "new-artists-clickers")?.follows).toEqual({ archetype: "new-artists-weekly", metric: "clicked_email" });
});

it("a requested policy may carry programmes", () => {
  const raw = `---
schemaVersion: 1
enabled: true
timeZone: America/Chicago
firstWindowStart: "2026-11-02"
batchDays: 14
leadDays: 7
holdHours: 48
sendDays: [tuesday, thursday]
localTime: "10:00"
archetypes: [artist-drop]
audiences: [full-reach]
maxCampaignsPerWindow: 6
programmes:
  - { key: sunday-new-artists, archetype: new-artists-weekly, audience: engaged-or-new, sendDay: sunday, localTime: "10:00", prepareDaysBefore: 3 }
---
body`;
  expect(parseAutopilotPolicy(raw).programmes).toEqual([
    { key: "sunday-new-artists", archetype: "new-artists-weekly", audience: "engaged-or-new", sendDay: "sunday", localTime: "10:00", prepareDaysBefore: 3 },
  ]);
});

it("a fortnight never starts on a programme's send day", () => {
  const now = new Date("2026-10-28T15:00:00Z"); // Wed in Chicago; +4 days is Sunday
  expect(activationStart("America/Chicago", 48, now)).toBe("2026-11-01");
  expect(activationStart("America/Chicago", 48, now, ["sunday"])).toBe("2026-11-02");
  expect(activationStart("America/Chicago", 48, now, ["sunday", "monday"])).toBe("2026-11-03");
});

// --- the stager --------------------------------------------------------------

const policy: EmailAutopilotPolicy = {
  schemaVersion: 1, enabled: true, timeZone: "America/Chicago", firstWindowStart: "2026-11-02", batchDays: 14,
  leadDays: 7, holdHours: 48, sendDays: ["sunday"], localTime: "10:00",
  archetypes: ["new-artists-weekly"], audiences: ["engaged-or-new"], maxCampaignsPerWindow: 1,
};
const gate = vi.fn(async ({ kind, params }: { kind: string; params: Record<string, unknown> }) => {
  const id = String(params.campaignId);
  const c = parseCampaign(files.get(campaignPath(id))!);
  if (kind === "email.approve_campaign") { put({ ...c, status: "approved" }); return { proposalId: `a-${id}`, released: { status: "executed", message: "ok" } }; }
  if (kind === "klaviyo.create_campaign_draft") { put({ ...c, status: "drafted" }); return { proposalId: `d-${id}`, released: { status: "executed", message: "ok" } }; }
  return { proposalId: `s-${id}` };
});

it("a programme week stages only its own archetype, silently passing over its neighbours", async () => {
  gate.mockClear();
  put(campaign("2026-11-01-new-artists-weekly", { archetype: "new-artists-weekly", audience: { included: [{ type: "segment", id: "U4", key: "engaged-or-new" }], excluded: [] }, scheduledAt: "2026-11-01T16:00:00.000Z" }));
  put(campaign("2026-10-31-artist-drop-x", { scheduledAt: "2026-10-31T15:00:00.000Z" })); // a day before: inside the slack
  const window = { from: "2026-11-01", through: "2026-11-01", slots: ["2026-11-01T16:00:00.000Z"], onlyArchetypes: ["new-artists-weekly"] };
  const { items } = await stageWindow({ repo, shop: "s.myshopify.com", grantId: "g", batchId: "b", policy, window, deadline: Date.now() + 60_000, propose: gate });
  expect(items.map((i) => [i.campaignId, i.state])).toEqual([["2026-11-01-new-artists-weekly", "held"]]);
});

it("a fortnight leaves programme campaigns to their own week instead of flagging them", async () => {
  put(campaign("2026-11-01-new-artists-weekly", { archetype: "new-artists-weekly", status: "proposed", scheduledAt: "2026-11-01T16:00:00.000Z" }));
  const fortnight = { ...policy, sendDays: ["tuesday", "thursday"] as EmailAutopilotPolicy["sendDays"], archetypes: ["artist-drop"], audiences: ["full-reach"], maxCampaignsPerWindow: 6 };
  const base = { from: "2026-11-02", through: "2026-11-15", slots: ["2026-11-03T16:00:00.000Z"] };
  const run = (window: typeof base & { skipArchetypes?: string[] }) =>
    stageWindow({ repo, shop: "s.myshopify.com", grantId: "g", batchId: "b", policy: fortnight, window, deadline: Date.now() + 60_000, propose: gate });
  expect((await run(base)).items).toMatchObject([{ campaignId: "2026-11-01-new-artists-weekly", state: "manual" }]);
  expect((await run({ ...base, skipArchetypes: ["new-artists-weekly", "artist-traction"] })).items).toEqual([]);
});

// --- the follows audience ------------------------------------------------------

const SUNDAY_KLAVIYO_ID = "01M1ZNE07R8AR8EDS527S1Q7MT";
const updates: Array<[string, unknown]> = [];
const klaviyo = {
  listAudiences: async () => [],
  listMetrics: async () => [{ id: "CLICKED", name: "Clicked Email" }],
  createTemplate: async () => ({ id: "T1" }),
  updateTemplate: async () => {},
  createCampaign: async () => ({ campaignId: "C-FRI", messageId: "M-FRI" }),
  assignTemplate: async () => {},
  updateSegmentDefinition: async (id: string, definition: unknown) => { updates.push([id, definition]); },
} as unknown as KlaviyoClient;
const actions = createEmailActions({
  repo,
  klaviyo,
  assemble: async () => ({ html: "<html></html>", htmlSha256: "h", report: { ok: true, errors: [], warnings: [] } }) as never,
  readAsset: async () => new Uint8Array(),
});
const friday = () => campaign("2026-11-06-artist-traction", {
  archetype: "artist-traction", status: "approved", scheduledAt: "2026-11-06T16:00:00.000Z",
  audience: { included: [{ type: "segment", id: "CLK", key: "new-artists-clickers" }], excluded: [] },
});
const inTenant = <T,>(fn: () => Promise<T>) => runWithTenant({ shop: "s.myshopify.com", storeSlug: "s" }, fn);

it("refuses to draft a follow-up when no send of the followed archetype happened", async () => {
  put(friday());
  put(campaign("2026-10-11-new-artists-weekly", { archetype: "new-artists-weekly", status: "sent", scheduledAt: "2026-10-11T15:00:00.000Z", klaviyo: { campaignId: "01JBOLD00000000000000000AB" } }));
  await expect(inTenant(() => actions.createCampaignDraft.preview({ campaignId: friday().id }))).rejects.toThrow(/no one to follow up with/);
});

it("names the followed send on the card and re-points the segment before creating the draft", async () => {
  updates.length = 0;
  put(friday());
  put(campaign("2026-11-01-new-artists-weekly", { archetype: "new-artists-weekly", status: "scheduled", scheduledAt: "2026-11-01T16:00:00.000Z", klaviyo: { campaignId: SUNDAY_KLAVIYO_ID } }));
  put(campaign("2026-10-25-new-artists-weekly", { archetype: "new-artists-weekly", status: "sent", scheduledAt: "2026-10-26T15:00:00.000Z", klaviyo: { campaignId: "01JBOLD00000000000000000AB" } }));
  // Not yet sent or scheduled: never followed, however recent.
  put(campaign("2026-11-05-new-artists-weekly", { archetype: "new-artists-weekly", status: "approved", scheduledAt: "2026-11-05T16:00:00.000Z" }));

  const preview = await inTenant(() => actions.createCampaignDraft.preview({ campaignId: friday().id }));
  expect(preview.rows).toContainEqual({ label: "Audience follows", value: "new-artists-clickers → clickers of 2026-11-01-new-artists-weekly (re-pointed when drafted)" });

  const result = await inTenant(() => actions.createCampaignDraft.execute({ campaignId: friday().id }));
  expect(result.ok).toBe(true);
  expect(updates).toHaveLength(1);
  const [segmentId, definition] = updates[0]!;
  expect(segmentId).toBe("CLK");
  expect(JSON.stringify(definition)).toContain(SUNDAY_KLAVIYO_ID);
  expect(JSON.stringify(definition)).toContain("\"metric_id\":\"CLICKED\"");
  expect((result.detail as { steps: string[] }).steps).toContain("audience:new-artists-clickers->2026-11-01-new-artists-weekly");
});
