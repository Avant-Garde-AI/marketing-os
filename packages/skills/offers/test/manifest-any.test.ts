import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@avant-garde/skill-kit";
import { createOfferActions } from "../src/actions";
import { offerManifestSchema, offerPath, parseOffer, serializeOffer } from "../src/artifacts";
import { compileOfferManifest } from "../src/manifest";
import { compileOfferManifestV2 } from "../src/manifest-v2";
import { isOfferManifestV2, type Block, type Offer, type OfferPlatformClient } from "../src/types";
import { editorialConcept, quizConcept } from "./fixtures-v2";

const v1Variant = {
  headline: "Join the collector's list",
  body: "Early access to new drops, first look at the maker's story.",
  cta: "Join",
  success: "You're on the list.",
  consent: "By joining you agree to receive marketing emails from us.",
};

const v1 = () => compileOfferManifest({ surfaceSlug: "ofr_v1_any", variants: { v1: v1Variant } });
const v2 = () =>
  compileOfferManifestV2({
    slug: "ofr_v2_any",
    title: "Which room?",
    concepts: [quizConcept(), editorialConcept()],
    placement: "takeover",
    incumbent: { vendor: "klaviyo" },
    targeting: { devices: ["mobile"] },
    schedule: { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" },
    teaser: { enabled: true, label: "Your picks" },
  });

function fakePlatform(): OfferPlatformClient & { staged: { manifest: unknown; status: string }[] } {
  const staged: { manifest: unknown; status: string }[] = [];
  return {
    staged,
    async stageSurface(manifest, status) {
      staged.push({ manifest, status });
      return { ok: true, surfaceId: manifest.id, status };
    },
    async getStats() {
      return { surfaces: [] };
    },
    async reallocate(id) {
      return { ok: true, surfaceId: id };
    },
    async startAudit() {
      return { jobId: "a" };
    },
    async startDesign() {
      return { jobId: "d" };
    },
    async getJob() {
      return { status: "QUEUED" };
    },
    async latestAudit() {
      return null;
    },
  };
}

describe("offerManifestSchema accepts v1 OR v2", () => {
  it("parses a v1 manifest unchanged (no version field)", () => {
    const m = v1();
    const parsed = offerManifestSchema.parse(JSON.parse(JSON.stringify(m)));
    expect(parsed).toEqual(m);
    expect(isOfferManifestV2(parsed)).toBe(false);
  });

  it("parses a v2 manifest unchanged, incumbent arm included", () => {
    const m = v2();
    const parsed = offerManifestSchema.parse(JSON.parse(JSON.stringify(m)));
    expect(parsed).toEqual(m);
    expect(isOfferManifestV2(parsed)).toBe(true);
  });

  it("rejects an unknown version and a v2 shape missing its steps", () => {
    expect(offerManifestSchema.safeParse({ ...v2(), version: "3" }).success).toBe(false);
    const broken = JSON.parse(JSON.stringify(v2()));
    delete broken.variants.v1.steps;
    expect(offerManifestSchema.safeParse(broken).success).toBe(false);
  });
});

describe("offer.md with a v2 manifest", () => {
  const offer = (): Offer => ({
    id: "ofr_v2_any",
    title: "Which room?",
    hypothesis: "Asking first makes the picks feel curated.",
    status: "proposed",
    manifest: v2(),
    experimentId: null,
    provenance: [{ claim: "designed by the offer harness", origin: "agent" }],
    body: "Harness run 1.",
  });

  it("round-trips deep-equal", () => {
    const o = offer();
    expect(parseOffer(serializeOffer(o))).toEqual(o);
  });

  it("still round-trips a v1 offer", () => {
    const o = { ...offer(), id: "ofr_v1_any", manifest: v1() };
    expect(parseOffer(serializeOffer(o))).toEqual(o);
  });
});

describe("offer.activate with a v2 manifest", () => {
  it("previews with the v2 format and arms, then writes offer.md before staging", async () => {
    const repo = createMemoryRepo();
    const platform = fakePlatform();
    const actions = createOfferActions({ repo, platform });
    const manifest = v2();
    const params = { id: "ofr_v2_any", title: "Which room?", hypothesis: "h", manifest };

    const preview = await actions.activateOffer.preview(params);
    expect(preview.summary).toMatch(/takeover, arms: control 25% · v1 25% · v2 25% · incumbent 25%/);
    expect(preview.rows?.find((r) => r.label === "Format")?.value).toBe(
      "v1: 3-step split-image (zero-party-quiz) · v2: 1-step editorial-type (quiet-editorial)",
    );

    await actions.activateOffer.execute(params);
    const saved = parseOffer((await repo.readFile(offerPath("ofr_v2_any")))!);
    expect(saved.manifest).toEqual(manifest);
    expect(platform.staged).toEqual([{ manifest, status: "ACTIVE" }]);
  });

  it("accepts v2 params through its zod schema", () => {
    const actions = createOfferActions({ repo: createMemoryRepo(), platform: fakePlatform() });
    const parsed = actions.activateOffer.paramsSchema.safeParse({ id: "ofr_v2_any", title: "t", hypothesis: "h", manifest: v2() });
    expect(parsed.success).toBe(true);
  });

  it("preview refuses a v2 manifest whose copy or structure no longer gates clean", async () => {
    const actions = createOfferActions({ repo: createMemoryRepo(), platform: fakePlatform() });

    const shaming = v2();
    const decline = shaming.variants.v2!.steps[0]!.blocks.find((b): b is Extract<Block, { kind: "decline" }> => b.kind === "decline")!;
    decline.text = "No thanks, I'll pay full price";
    await expect(
      actions.activateOffer.preview({ id: "ofr_v2_any", title: "t", hypothesis: "h", manifest: shaming }),
    ).rejects.toThrow(/no longer passes the gates.*decline\/value-framing/);

    const noConsent = v2();
    const ask = noConsent.variants.v1!.steps[1]!;
    ask.blocks = ask.blocks.filter((b) => b.kind !== "consent");
    await expect(
      actions.activateOffer.preview({ id: "ofr_v2_any", title: "t", hypothesis: "h", manifest: noConsent }),
    ).rejects.toThrow(/consent/);
  });
});
