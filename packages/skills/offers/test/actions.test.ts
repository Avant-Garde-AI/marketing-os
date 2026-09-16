import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@avant-garde/skill-kit";
import { createOfferActions } from "../src/actions";
import { compileOfferManifest } from "../src/manifest";
import { offerPath, parseOffer, parseResults, resultsPath, serializeOffer } from "../src/artifacts";
import type { Offer, OfferPlatformClient } from "../src/types";

const variant = {
  headline: "Join the collector's list",
  body: "Early access to new drops, first look at the maker's story.",
  cta: "Join",
  success: "You're on the list.",
  consent: "By joining you agree to receive marketing emails from us.",
};

function fakePlatform(): OfferPlatformClient & {
  staged: { manifest: unknown; status: string }[];
  reallocated: { id: string; mode: string; opts?: unknown }[];
} {
  const staged: { manifest: unknown; status: string }[] = [];
  const reallocated: { id: string; mode: string; opts?: unknown }[] = [];
  return {
    staged,
    reallocated,
    async stageSurface(manifest, status) {
      staged.push({ manifest, status });
      return { ok: true, surfaceId: (manifest as { id: string }).id, status };
    },
    async getStats() {
      return { surfaces: [] };
    },
    async reallocate(id, mode, opts) {
      reallocated.push({ id, mode, opts });
      return { ok: true, surfaceId: id };
    },
  };
}

function preExistingOffer(id: string): Offer {
  const manifest = compileOfferManifest({ surfaceSlug: id, variants: { v1: variant } });
  return {
    id,
    title: "Spring editions early access",
    hypothesis: "Collectors respond to early access more than a discount.",
    status: "approved",
    manifest,
    experimentId: null,
    provenance: [{ claim: "approved by owner", origin: "owner" }],
    body: "",
  };
}

describe("offer.activate", () => {
  it("writes offer.md BEFORE staging the surface (git-first)", async () => {
    const repo = createMemoryRepo();
    const platform = fakePlatform();
    const order: string[] = [];
    const trackedRepo = { ...repo, writeFile: async (p: string, c: string) => { order.push("repo"); return repo.writeFile(p, c); } };
    const trackedPlatform: OfferPlatformClient = {
      ...platform,
      stageSurface: async (m, s) => { order.push("platform"); return platform.stageSurface(m, s); },
    };
    const actions = createOfferActions({ repo: trackedRepo, platform: trackedPlatform });
    const manifest = compileOfferManifest({ surfaceSlug: "ofr_spring", variants: { v1: variant } });

    const result = await actions.activateOffer.execute({
      id: "ofr_spring",
      title: "Spring editions early access",
      hypothesis: "Collectors respond to early access.",
      manifest,
    });

    expect(order).toEqual(["repo", "platform"]);
    expect(result.ok).toBe(true);

    const saved = parseOffer((await repo.readFile(offerPath("ofr_spring")))!);
    expect(saved.status).toBe("active");
    expect(saved.experimentId).toBe(manifest.experiment.id);
  });

  it("stages the surface ACTIVE regardless of prior staged status", async () => {
    const repo = createMemoryRepo();
    const platform = fakePlatform();
    const actions = createOfferActions({ repo, platform });
    const manifest = compileOfferManifest({ surfaceSlug: "ofr_x", variants: { v1: variant } });

    await actions.activateOffer.execute({ id: "ofr_x", title: "X", hypothesis: "h", manifest });
    expect(platform.staged).toEqual([{ manifest, status: "ACTIVE" }]);
  });

  it("preview rejects content that no longer gates clean", async () => {
    const repo = createMemoryRepo();
    const platform = fakePlatform();
    const actions = createOfferActions({ repo, platform });
    const manifest = compileOfferManifest({
      surfaceSlug: "ofr_bad",
      variants: { v1: { ...variant, body: "Only 3 left in stock!" } },
    });
    await expect(
      actions.activateOffer.preview({ id: "ofr_bad", title: "Bad", hypothesis: "h", manifest }),
    ).rejects.toThrow(/no longer passes the gates/);
  });

  it("preview does not write anything", async () => {
    const repo = createMemoryRepo();
    const platform = fakePlatform();
    const actions = createOfferActions({ repo, platform });
    const manifest = compileOfferManifest({ surfaceSlug: "ofr_y", variants: { v1: variant } });
    await actions.activateOffer.preview({ id: "ofr_y", title: "Y", hypothesis: "h", manifest });
    expect(repo.files.size).toBe(0);
    expect(platform.staged).toHaveLength(0);
  });
});

describe("offer.pause / offer.retire", () => {
  it("pause: writes paused status then calls platform.reallocate('pause')", async () => {
    const repo = createMemoryRepo({ [offerPath("ofr_p")]: serializeOffer(preExistingOffer("ofr_p")) });
    const platform = fakePlatform();
    const actions = createOfferActions({ repo, platform });

    const result = await actions.pauseOffer.execute({ id: "ofr_p" });
    expect(result.ok).toBe(true);
    expect(parseOffer((await repo.readFile(offerPath("ofr_p")))!).status).toBe("paused");
    expect(platform.reallocated).toEqual([{ id: "ofr_p", mode: "pause", opts: undefined }]);
  });

  it("pause throws when the offer does not exist", async () => {
    const repo = createMemoryRepo();
    const actions = createOfferActions({ repo, platform: fakePlatform() });
    await expect(actions.pauseOffer.preview({ id: "ofr_missing" })).rejects.toThrow(/not found/);
  });

  it("retire: writes retired status, appends a results.md entry, then retires on the platform", async () => {
    const repo = createMemoryRepo({ [offerPath("ofr_r")]: serializeOffer(preExistingOffer("ofr_r")) });
    const platform = fakePlatform();
    const actions = createOfferActions({ repo, platform });

    await actions.retireOffer.execute({ id: "ofr_r", reason: "converted zero, three weeks running" });

    expect(parseOffer((await repo.readFile(offerPath("ofr_r")))!).status).toBe("retired");
    const results = parseResults((await repo.readFile(resultsPath("ofr_r")))!);
    expect(results.entries).toHaveLength(1);
    expect(results.entries[0]!.decision).toBe("retire");
    expect(results.entries[0]!.rationale).toBe("converted zero, three weeks running");
    expect(platform.reallocated).toEqual([{ id: "ofr_r", mode: "retire", opts: undefined }]);
  });

  it("retire preview warns when the offer is currently active", async () => {
    const repo = createMemoryRepo({
      [offerPath("ofr_active")]: serializeOffer({ ...preExistingOffer("ofr_active"), status: "active" }),
    });
    const actions = createOfferActions({ repo, platform: fakePlatform() });
    const preview = await actions.retireOffer.preview({ id: "ofr_active", reason: "done" });
    expect(preview.warnings).toContain("This offer is currently live — retiring stops it immediately.");
  });
});

describe("offer.reallocate", () => {
  it("applies exactly the recommendation passed in params, never recomputes", async () => {
    const repo = createMemoryRepo({ [offerPath("ofr_re")]: serializeOffer(preExistingOffer("ofr_re")) });
    const platform = fakePlatform();
    const actions = createOfferActions({ repo, platform });

    await actions.reallocateOffer.execute({
      id: "ofr_re",
      mode: "promote",
      winner: "v1",
      days: 30,
      rationale: "v1 clears 95% P(best)",
      posteriors: { v1: 0.97, v2: 0.03 },
    });

    const results = parseResults((await repo.readFile(resultsPath("ofr_re")))!);
    expect(results.entries[0]).toMatchObject({
      decision: "promote",
      winner: "v1",
      rationale: "v1 clears 95% P(best)",
      posteriors: { v1: 0.97, v2: 0.03 },
    });
    expect(platform.reallocated).toEqual([{ id: "ofr_re", mode: "promote", opts: { days: 30, winner: "v1" } }]);
  });

  it("promote without a winner is refused at preview", async () => {
    const repo = createMemoryRepo({ [offerPath("ofr_np")]: serializeOffer(preExistingOffer("ofr_np")) });
    const actions = createOfferActions({ repo, platform: fakePlatform() });
    await expect(
      actions.reallocateOffer.preview({
        id: "ofr_np",
        mode: "promote",
        days: 30,
        rationale: "x",
        posteriors: {},
      }),
    ).rejects.toThrow(/requires winner/);
  });

  it("writes the results entry before calling the platform (git-first)", async () => {
    const repo = createMemoryRepo({ [offerPath("ofr_order")]: serializeOffer(preExistingOffer("ofr_order")) });
    const platform = fakePlatform();
    const order: string[] = [];
    const trackedRepo = { ...repo, writeFile: async (p: string, c: string) => { if (p.endsWith("results.md")) order.push("repo"); return repo.writeFile(p, c); } };
    const trackedPlatform: OfferPlatformClient = {
      ...platform,
      reallocate: async (id, mode, opts) => { order.push("platform"); return platform.reallocate(id, mode, opts); },
    };
    const actions = createOfferActions({ repo: trackedRepo, platform: trackedPlatform });
    await actions.reallocateOffer.execute({
      id: "ofr_order",
      mode: "thompson",
      days: 30,
      rationale: "forming signal",
      posteriors: { v1: 0.8 },
    });
    expect(order).toEqual(["repo", "platform"]);
  });
});
