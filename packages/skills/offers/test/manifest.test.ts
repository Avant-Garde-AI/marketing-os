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
});
