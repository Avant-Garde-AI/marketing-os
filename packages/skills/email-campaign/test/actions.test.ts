import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryRepo } from "@avant-garde/skill-kit";
import {
  REGISTRY_PATH,
  calendarPath,
  campaignHtmlPath,
  campaignPath,
  parseCalendar,
  parseCampaign,
  parseRegistry,
  serializeCalendar,
  serializeCampaign,
  serializeSkeleton,
  serializeStrategy,
  skeletonPath,
} from "../src/artifacts";
import {
  campaignTemplateSlug,
  createEmailActions,
  slotCampaignId,
  type EmailActionDeps,
} from "../src/actions";
import type { EmailCampaign } from "../src/types";
import { campaign as campaignFixture, createFakeKlaviyo, strategy } from "./fixtures";

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Deterministic fake assembler: html derives from the campaign's mutation-
 * relevant state, so edits change bytes exactly like the real assembler. */
function fakeAssemble(campaign: EmailCampaign) {
  const html = `<html><body>${campaign.subject ?? ""}|${campaign.previewText ?? ""}|${JSON.stringify(campaign.sections)}{% unsubscribe %}</body></html>`;
  return Promise.resolve({ html, htmlSha256: sha(html), report: { ok: true, errors: [], warnings: [] } });
}

function setup(files: Record<string, string> = {}) {
  const repo = createMemoryRepo(files);
  const { client, state } = createFakeKlaviyo();
  const deps: EmailActionDeps = {
    repo,
    klaviyo: client,
    assemble: fakeAssemble,
    readAsset: async (path) => new TextEncoder().encode(`png-bytes:${path}`),
    previewUrl: (id) => `https://agents.example.com/api/email/preview/${id}`,
    defaultSkeletonRef: "default",
  };
  return { repo, state, deps, actions: createEmailActions(deps) };
}

/** A draft-ready campaign (approved, subject chosen, sections authored). */
function draftReady(): EmailCampaign {
  return {
    ...campaignFixture,
    status: "approved",
    sections: [
      {
        slot: "hero",
        type: "surface",
        alt: "Autumn arrivals hero",
        surfaceId: "surf-1",
        boardName: "hero",
        assetPath: "email/campaigns/2026-08-new-arrivals/assets/hero.png",
      },
      { slot: "body-1", type: "html", blocks: [{ type: "paragraph", text: "Museum-grade botanicals." }] },
    ],
    klaviyo: undefined as never,
  };
}

// ---------------------------------------------------------------------------
// Invariant 1: previews never mutate
// ---------------------------------------------------------------------------

describe("preview() is read-only (spec 20 §2 invariant 1)", () => {
  it("records zero Klaviyo mutations across all four previews", async () => {
    const c = draftReady();
    const { deps, state, actions, repo } = setup({
      "email/strategy.md": serializeStrategy(strategy),
      [calendarPath("2026-09")]: serializeCalendar({
        month: "2026-09",
        status: "proposed",
        slots: [
          { slot: "2026-09-01", audience: "engaged-30d", archetype: "new-arrivals", intent: "x", campaignId: null, status: "planned" },
        ],
      }),
      [campaignPath(c.id)]: serializeCampaign(c),
    });
    await actions.approvePlan.preview({ month: "2026-09" });
    await actions.createCampaignDraft.preview({ campaignId: c.id });
    // schedule/cancel previews need drafted/scheduled state:
    const drafted: EmailCampaign = { ...c, status: "drafted", klaviyo: { templateId: "T", campaignId: "C", messageId: "M" } };
    await repo.writeFile(campaignPath(c.id), serializeCampaign(drafted));
    const assembled = await fakeAssemble(drafted);
    await repo.writeFile(campaignHtmlPath(c.id), assembled.html);
    await actions.scheduleCampaign.preview({ campaignId: c.id, sendAt: "2026-09-03T10:00:00Z" });
    const scheduled: EmailCampaign = { ...drafted, status: "scheduled", scheduledAt: "2026-09-03T10:00:00Z" };
    await repo.writeFile(campaignPath(c.id), serializeCampaign(scheduled));
    await actions.cancelSend.preview({ campaignId: c.id });
    expect(state.mutations).toEqual([]);
    void deps;
  });
});

// ---------------------------------------------------------------------------
// email.approve_plan
// ---------------------------------------------------------------------------

describe("email.approve_plan", () => {
  const files = () => ({
    "email/strategy.md": serializeStrategy(strategy),
    [calendarPath("2026-09")]: serializeCalendar({
      month: "2026-09",
      status: "proposed",
      slots: [
        { slot: "2026-09-01", audience: "engaged-30d", archetype: "new-arrivals", intent: "discovery", campaignId: null, status: "planned" },
        { slot: "2026-09-10", audience: "full-list", archetype: "editorial-story", intent: "editorial", campaignId: null, status: "planned" },
      ],
    }),
  });

  it("preview states drafting-only semantics and refuses non-proposed calendars", async () => {
    const { actions } = setup(files());
    const preview = await actions.approvePlan.preview({ month: "2026-09" });
    expect(preview.summary).toContain("drafting authorized");
    expect(preview.rows!.find((r) => r.label === "Slots")!.value).toBe("2");
    await expect(actions.approvePlan.preview({ month: "2026-01" })).rejects.toThrow(/no calendar/);
  });

  it("execute creates approved campaign stubs, links the calendar, resolves audiences", async () => {
    const { actions, repo } = setup(files());
    const result = await actions.approvePlan.execute({ month: "2026-09" });
    expect(result.ok).toBe(true);
    const calendar = parseCalendar((await repo.readFile(calendarPath("2026-09")))!);
    expect(calendar.status).toBe("approved");
    expect(calendar.slots.every((s) => s.campaignId !== null)).toBe(true);
    const id = slotCampaignId("2026-09", "2026-09-01", "new-arrivals", 0);
    const created = parseCampaign((await repo.readFile(campaignPath(id)))!);
    expect(created.status).toBe("approved");
    expect(created.audience.included[0]).toMatchObject({ key: "engaged-30d", type: "segment", id: "SegEngaged30" });
    expect(created.utm.campaign).toBe(id);
  });

  it("execute is idempotent — a retry recreates nothing", async () => {
    const { actions, repo } = setup(files());
    await actions.approvePlan.execute({ month: "2026-09" });
    const before = await repo.list("email/campaigns/");
    const again = await actions.approvePlan.execute({ month: "2026-09" });
    expect(again.ok).toBe(true);
    expect((again.detail!.campaignIds as string[]).length).toBe(0);
    expect(await repo.list("email/campaigns/")).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// klaviyo.create_campaign_draft
// ---------------------------------------------------------------------------

describe("klaviyo.create_campaign_draft", () => {
  it("preview refuses unready campaigns with actionable errors", async () => {
    const noSubject = { ...draftReady(), subject: undefined as never };
    const { actions } = setup({ [campaignPath(noSubject.id)]: serializeCampaign(noSubject) });
    await expect(actions.createCampaignDraft.preview({ campaignId: noSubject.id })).rejects.toThrow(/no chosen subject/);
  });

  it("preview shows live audience sizes and the preview URL", async () => {
    const c = draftReady();
    const { actions } = setup({ [campaignPath(c.id)]: serializeCampaign(c) });
    const preview = await actions.createCampaignDraft.preview({ campaignId: c.id });
    expect(preview.rows!.find((r) => r.label === "Audience")!.value).toContain("1,240");
    expect(preview.previewUrl).toContain(c.id);
    expect(preview.summary).toContain("nothing sends");
  });

  it("execute runs the full sequence: images → email.html → registry template → campaign → assignment → drafted", async () => {
    const c = draftReady();
    const { actions, repo, state } = setup({ [campaignPath(c.id)]: serializeCampaign(c) });
    const result = await actions.createCampaignDraft.execute({ campaignId: c.id });
    expect(result.ok).toBe(true);

    const after = parseCampaign((await repo.readFile(campaignPath(c.id)))!);
    expect(after.status).toBe("drafted");
    expect(after.klaviyo).toMatchObject({ campaignId: "CampNew", messageId: "MsgNew" });
    const heroSection = after.sections.find((s) => s.slot === "hero");
    expect(heroSection && "imageUrl" in heroSection && heroSection.imageUrl).toContain("cloudfront");

    const registry = parseRegistry((await repo.readFile(REGISTRY_PATH))!);
    expect(registry[campaignTemplateSlug(c.id)]).toBeDefined();
    expect(await repo.readFile(campaignHtmlPath(c.id))).toContain("{% unsubscribe %}");

    expect(state.mutations.filter((m) => m.startsWith("uploadImage"))).toHaveLength(1);
    expect(state.mutations.filter((m) => m.startsWith("createTemplate"))).toHaveLength(1);
    expect(state.mutations.filter((m) => m.startsWith("createCampaign"))).toHaveLength(1);
    expect(state.mutations.filter((m) => m.startsWith("assignTemplate"))).toHaveLength(1);
  });

  it("execute resumes idempotently: completed steps are skipped on retry", async () => {
    const c = draftReady();
    const { actions, repo, state } = setup({ [campaignPath(c.id)]: serializeCampaign(c) });
    await actions.createCampaignDraft.execute({ campaignId: c.id });
    const mutationsAfterFirst = state.mutations.length;
    // Retry: image has imageUrl → skip; template in registry → PATCH not create;
    // campaign id recorded → skip create.
    await actions.createCampaignDraft.execute({ campaignId: c.id });
    const newMutations = state.mutations.slice(mutationsAfterFirst);
    expect(newMutations.filter((m) => m.startsWith("uploadImage"))).toHaveLength(0);
    expect(newMutations.filter((m) => m.startsWith("createTemplate"))).toHaveLength(0);
    expect(newMutations.filter((m) => m.startsWith("updateTemplate"))).toHaveLength(1);
    expect(newMutations.filter((m) => m.startsWith("createCampaign"))).toHaveLength(0);
    expect(newMutations.filter((m) => m.startsWith("assignTemplate"))).toHaveLength(1);
    void repo;
  });
});

// ---------------------------------------------------------------------------
// klaviyo.schedule_campaign (risk=high, approve-at-schedule)
// ---------------------------------------------------------------------------

describe("klaviyo.schedule_campaign", () => {
  async function draftedState() {
    const c = draftReady();
    const ctx = setup({ [campaignPath(c.id)]: serializeCampaign(c) });
    await ctx.actions.createCampaignDraft.execute({ campaignId: c.id });
    return { ...ctx, id: c.id };
  }

  it("declares risk=high", async () => {
    const { actions } = setup();
    expect(actions.scheduleCampaign.risk).toBe("high");
  });

  it("preview carries the real recipient estimate and consent language", async () => {
    const { actions, id } = await draftedState();
    const preview = await actions.scheduleCampaign.preview({ campaignId: id, sendAt: "2026-09-03T10:00:00Z" });
    expect(preview.summary).toContain("~1,240");
    expect(preview.summary).toContain("consent to send");
    expect(preview.rows!.find((r) => r.label === "Undo")!.value).toContain("cancel");
  });

  it("preview refuses when the campaign drifted since drafting (what you approve is what sends)", async () => {
    const { actions, repo, id } = await draftedState();
    const drifted = parseCampaign((await repo.readFile(campaignPath(id)))!);
    drifted.subject = "A different subject entirely";
    await repo.writeFile(campaignPath(id), serializeCampaign(drifted));
    await expect(
      actions.scheduleCampaign.preview({ campaignId: id, sendAt: "2026-09-03T10:00:00Z" }),
    ).rejects.toThrow(/changed since it was drafted/);
  });

  it("execute schedules in Klaviyo and records consent state; retry at same time is a no-op", async () => {
    const { actions, repo, state, id } = await draftedState();
    const result = await actions.scheduleCampaign.execute({ campaignId: id, sendAt: "2026-09-03T10:00:00Z" });
    expect(result.ok).toBe(true);
    const after = parseCampaign((await repo.readFile(campaignPath(id)))!);
    expect(after.status).toBe("scheduled");
    expect(after.scheduledAt).toBe("2026-09-03T10:00:00Z");
    expect(state.mutations.filter((m) => m.startsWith("updateSendStrategy"))).toHaveLength(1);
    expect(state.mutations.filter((m) => m.startsWith("createSendJob"))).toHaveLength(1);

    const before = state.mutations.length;
    await actions.scheduleCampaign.execute({ campaignId: id, sendAt: "2026-09-03T10:00:00Z" });
    expect(state.mutations.length).toBe(before); // idempotent
  });
});

// ---------------------------------------------------------------------------
// klaviyo.cancel_send
// ---------------------------------------------------------------------------

describe("klaviyo.cancel_send", () => {
  it("cancels and reverts to drafted by default", async () => {
    const c = draftReady();
    const { actions, repo, state } = setup({ [campaignPath(c.id)]: serializeCampaign(c) });
    await actions.createCampaignDraft.execute({ campaignId: c.id });
    await actions.scheduleCampaign.execute({ campaignId: c.id, sendAt: "2026-09-03T10:00:00Z" });
    const result = await actions.cancelSend.execute({ campaignId: c.id });
    expect(result.ok).toBe(true);
    const after = parseCampaign((await repo.readFile(campaignPath(c.id)))!);
    expect(after.status).toBe("drafted");
    expect(after.scheduledAt).toBeUndefined();
    expect(state.mutations.filter((m) => m.startsWith("cancelSendJob"))).toHaveLength(1);
  });

  it("preview refuses non-scheduled campaigns", async () => {
    const c = draftReady();
    const { actions } = setup({ [campaignPath(c.id)]: serializeCampaign(c) });
    await expect(actions.cancelSend.preview({ campaignId: c.id })).rejects.toThrow(/only scheduled sends/);
  });
});

// ---------------------------------------------------------------------------
// The nonce-invalidation matrix (WS3-R5): every post-approval-relevant change
// produces a DIFFERENT previewHash — the gate's stored hash stops matching.
// ---------------------------------------------------------------------------

describe("previewHash invalidation matrix", () => {
  async function scheduledPreviewHash(mutate?: (c: EmailCampaign) => void, sendAt = "2026-09-03T10:00:00Z") {
    const c = draftReady();
    const ctx = setup({ [campaignPath(c.id)]: serializeCampaign(c) });
    await ctx.actions.createCampaignDraft.execute({ campaignId: c.id });
    if (mutate) {
      const cur = parseCampaign((await ctx.repo.readFile(campaignPath(c.id)))!);
      mutate(cur);
      await ctx.repo.writeFile(campaignPath(c.id), serializeCampaign(cur));
      // keep email.html consistent so drift-check passes and we isolate the hash change
      const assembled = await fakeAssemble(cur);
      await ctx.repo.writeFile(campaignHtmlPath(c.id), assembled.html);
    }
    const preview = await ctx.actions.scheduleCampaign.preview({ campaignId: c.id, sendAt });
    return preview.previewHash;
  }

  it("is stable for identical state", async () => {
    expect(await scheduledPreviewHash()).toBe(await scheduledPreviewHash());
  });

  it("changes on copy edit", async () => {
    const base = await scheduledPreviewHash();
    const edited = await scheduledPreviewHash((c) => {
      c.subject = "Changed subject";
    });
    expect(edited).not.toBe(base);
  });

  it("changes on audience change", async () => {
    const base = await scheduledPreviewHash();
    const edited = await scheduledPreviewHash((c) => {
      c.audience = { included: [{ type: "list", id: "ListMain", name: "Main list" }] };
    });
    expect(edited).not.toBe(base);
  });

  it("changes on send-time move", async () => {
    const base = await scheduledPreviewHash(undefined, "2026-09-03T10:00:00Z");
    const moved = await scheduledPreviewHash(undefined, "2026-09-04T10:00:00Z");
    expect(moved).not.toBe(base);
  });

  it("changes on canvas edit reflected in sections (re-export → new content)", async () => {
    const base = await scheduledPreviewHash();
    const edited = await scheduledPreviewHash((c) => {
      const hero = c.sections.find((s) => s.slot === "hero");
      if (hero && hero.type === "surface") hero.alt = "Re-composed hero after canvas edit";
    });
    expect(edited).not.toBe(base);
  });

  it("changes on skeleton re-ingestion (version bump)", async () => {
    const c = draftReady();
    const skeletonV1 = serializeSkeleton({
      id: c.skeletonRef,
      sourceTemplateId: "Tpl1",
      ingestedAt: "2026-07-17T00:00:00Z",
      transforms: [],
      slots: [{ name: "hero" }],
      version: 1,
      body: "",
    });
    const ctx1 = setup({ [campaignPath(c.id)]: serializeCampaign(c), [skeletonPath(c.skeletonRef)]: skeletonV1 });
    await ctx1.actions.createCampaignDraft.execute({ campaignId: c.id });
    const h1 = (await ctx1.actions.scheduleCampaign.preview({ campaignId: c.id, sendAt: "2026-09-03T10:00:00Z" })).previewHash;

    const skeletonV2 = skeletonV1.replace("version: 1", "version: 2");
    const ctx2 = setup({ [campaignPath(c.id)]: serializeCampaign(c), [skeletonPath(c.skeletonRef)]: skeletonV2 });
    await ctx2.actions.createCampaignDraft.execute({ campaignId: c.id });
    const h2 = (await ctx2.actions.scheduleCampaign.preview({ campaignId: c.id, sendAt: "2026-09-03T10:00:00Z" })).previewHash;

    expect(h2).not.toBe(h1);
  });
});
