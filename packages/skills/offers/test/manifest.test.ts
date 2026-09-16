import { describe, expect, it } from "vitest";
import { compileOfferManifest } from "../src/manifest";
import type { OfferVariantContent } from "../src/types";

const variant: OfferVariantContent = {
  headline: "Join the collector's list",
  body: "Early access to new drops, first look at the maker's story.",
  cta: "Join",
  success: "You're on the list.",
  consent: "By joining you agree to receive marketing emails from us.",
};

describe("compileOfferManifest", () => {
  it("throws with no variants", () => {
    expect(() => compileOfferManifest({ surfaceSlug: "ofr_x", variants: {} })).toThrow(
      /at least one variant/i,
    );
  });

  it("splits weight evenly across variants, control first", () => {
    const m = compileOfferManifest({
      surfaceSlug: "ofr_spring",
      variants: { v1: variant, v2: variant },
      controlWeight: 0.34,
    });
    expect(m.experiment.arms).toEqual([
      { key: "control", weight: 0.34 },
      { key: "v1", weight: 0.33 },
      { key: "v2", weight: 0.33 },
    ]);
  });

  it("caps variants at two even when more are supplied", () => {
    const m = compileOfferManifest({
      surfaceSlug: "ofr_spring",
      variants: { v1: variant, v2: variant, v3: variant },
    });
    expect(Object.keys(m.variants)).toHaveLength(2);
    expect(m.experiment.arms).toHaveLength(3); // control + 2
  });

  it("defaults placement, trigger, pages, and control weight", () => {
    const m = compileOfferManifest({ surfaceSlug: "ofr_default", variants: { v1: variant } });
    expect(m.placement).toBe("corner-card");
    expect(m.trigger).toEqual({
      kind: "delay",
      seconds: 10,
      suppressAfterDismissDays: 14,
      maxPerSession: 1,
    });
    expect(m.audience.pages).toEqual(["home", "collection", "product"]);
    expect(m.experiment.arms[0]).toEqual({ key: "control", weight: 0.34 });
  });

  it("derives the experiment id and surface id from the slug", () => {
    const m = compileOfferManifest({ surfaceSlug: "ofr_spring_editions", variants: { v1: variant } });
    expect(m.id).toBe("ofr_spring_editions");
    expect(m.experiment.id).toBe("exp_ofr_spring_editions");
  });

  it("always marks capturesEmail true and stamps font: inherit", () => {
    const m = compileOfferManifest({ surfaceSlug: "ofr_x", variants: { v1: variant } });
    expect(m.consent).toEqual({ capturesEmail: true });
    expect(m.variants.v1!.style.font).toBe("inherit");
  });

  describe("OF3: takeover, exit-intent, teaser, targeting, schedule", () => {
    it("accepts takeover placement", () => {
      const m = compileOfferManifest({ surfaceSlug: "ofr_x", placement: "takeover", variants: { v1: variant } });
      expect(m.placement).toBe("takeover");
    });

    it("accepts exit-intent trigger kind", () => {
      const m = compileOfferManifest({ surfaceSlug: "ofr_x", triggerKind: "exit-intent", variants: { v1: variant } });
      expect(m.trigger.kind).toBe("exit-intent");
    });

    it("defaults the teaser ON for corner-card and omits it otherwise", () => {
      const corner = compileOfferManifest({ surfaceSlug: "ofr_a", variants: { v1: variant } });
      expect(corner.teaser).toEqual({ enabled: true });

      const overlay = compileOfferManifest({ surfaceSlug: "ofr_b", placement: "overlay", variants: { v1: variant } });
      expect(overlay.teaser).toBeUndefined();
    });

    it("an explicit teaser:false always wins, even for corner-card", () => {
      const m = compileOfferManifest({ surfaceSlug: "ofr_x", teaser: false, variants: { v1: variant } });
      expect(m.teaser).toBeUndefined();
    });

    it("an explicit teaser:true wins for a non-corner-card placement", () => {
      const m = compileOfferManifest({
        surfaceSlug: "ofr_x",
        placement: "overlay",
        teaser: true,
        variants: { v1: variant },
      });
      expect(m.teaser).toEqual({ enabled: true });
    });

    it("carries targeting through untouched when supplied", () => {
      const targeting = { devices: ["mobile"] as const, countries: ["US", "CA"], returningOnly: true };
      const m = compileOfferManifest({ surfaceSlug: "ofr_x", targeting, variants: { v1: variant } });
      expect(m.audience.targeting).toEqual(targeting);
    });

    it("omits targeting when not supplied", () => {
      const m = compileOfferManifest({ surfaceSlug: "ofr_x", variants: { v1: variant } });
      expect(m.audience.targeting).toBeUndefined();
    });

    it("carries a schedule window through untouched when supplied", () => {
      const schedule = { from: "2026-11-20T00:00:00Z", to: "2026-12-02T00:00:00Z" };
      const m = compileOfferManifest({ surfaceSlug: "ofr_x", schedule, variants: { v1: variant } });
      expect(m.schedule).toEqual(schedule);
    });

    it("omits schedule when not supplied", () => {
      const m = compileOfferManifest({ surfaceSlug: "ofr_x", variants: { v1: variant } });
      expect(m.schedule).toBeUndefined();
    });
  });
});
