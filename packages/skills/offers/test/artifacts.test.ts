import { describe, expect, it } from "vitest";
import {
  appendResultEntry,
  offerPath,
  parseOffer,
  parseResults,
  parseStrategy,
  resultsPath,
  serializeOffer,
  serializeResults,
  serializeStrategy,
  STRATEGY_PATH,
} from "../src/artifacts";
import { compileOfferManifest } from "../src/manifest";
import type { Offer, OfferResults, OfferStrategy } from "../src/types";

const variant = {
  headline: "Join the collector's list",
  body: "Early access to new drops, first look at the maker's story.",
  cta: "Join",
  success: "You're on the list.",
  consent: "By joining you agree to receive marketing emails from us.",
};

describe("paths", () => {
  it("rejects invalid offer ids", () => {
    expect(() => offerPath("bad id")).toThrow(/invalid offer id/);
    expect(() => resultsPath("x")).toThrow(/invalid offer id/); // too short
  });

  it("builds canonical paths", () => {
    expect(offerPath("ofr_spring_editions")).toBe("offers/ofr_spring_editions/offer.md");
    expect(resultsPath("ofr_spring_editions")).toBe("offers/ofr_spring_editions/results.md");
    expect(STRATEGY_PATH).toBe("offers/strategy.md");
  });
});

describe("strategy round-trip", () => {
  const strategy: OfferStrategy = {
    incentives: [
      { type: "early-access", rationale: "Provenance/craft drives — collector's guide.", brandRef: "brand.md#6.2" },
      { type: "discount", rationale: "Fallback for price-sensitive segments." },
    ],
    allowedPlacements: ["corner-card", "overlay"],
    defaultConsentText: "By joining you agree to receive marketing emails from us.",
    frequencyPosture: { suppressAfterDismissDays: 14, maxPerSession: 1 },
    darkPatternStance: "No countdown timers, no fabricated stock, ever.",
    provenance: [{ claim: "incentive priority set with the owner 2026-09-16", origin: "owner" }],
  };

  it("round-trips deep-equal", () => {
    expect(parseStrategy(serializeStrategy(strategy))).toEqual(strategy);
  });

  it("rejects a document with no front matter", () => {
    expect(() => parseStrategy("just some text")).toThrow(/missing YAML front matter/);
  });

  it("rejects a placement outside the known enum", () => {
    const raw = serializeStrategy(strategy).replace("corner-card", "top-banner");
    expect(() => parseStrategy(raw)).toThrow();
  });
});

describe("offer round-trip", () => {
  const manifest = compileOfferManifest({ surfaceSlug: "ofr_spring", variants: { v1: variant } });
  const offer: Offer = {
    id: "ofr_spring",
    title: "Spring editions early access",
    hypothesis: "Collectors respond to early access more than a discount.",
    personaRef: "brand.md#6.2",
    status: "proposed",
    manifest,
    experimentId: null,
    provenance: [{ claim: "proposed from the collector persona", origin: "agent" }],
    body: "Notes from the co-creative session.",
  };

  it("round-trips deep-equal, including nested manifest", () => {
    expect(parseOffer(serializeOffer(offer))).toEqual(offer);
  });

  it("round-trips without the optional personaRef", () => {
    const { personaRef: _drop, ...rest } = offer;
    const minimal: Offer = { ...rest };
    expect(parseOffer(serializeOffer(minimal))).toEqual(minimal);
  });

  it("preserves status transitions", () => {
    const active: Offer = { ...offer, status: "active", experimentId: manifest.experiment.id };
    const parsed = parseOffer(serializeOffer(active));
    expect(parsed.status).toBe("active");
    expect(parsed.experimentId).toBe(manifest.experiment.id);
  });

  it("rejects an unknown status", () => {
    const raw = serializeOffer(offer).replace("status: proposed", "status: live");
    expect(() => parseOffer(raw)).toThrow(/invalid front matter/);
  });
});

describe("results log", () => {
  it("starts empty and appends", () => {
    const r1 = appendResultEntry(null, "ofr_spring", {
      at: "2026-09-16T00:00:00Z",
      decision: "continue",
      rationale: "Not enough data yet.",
      winner: null,
      posteriors: { v1: 0.5 },
    });
    expect(r1.entries).toHaveLength(1);

    const r2 = appendResultEntry(r1, "ofr_spring", {
      at: "2026-09-23T00:00:00Z",
      decision: "promote",
      rationale: "v1 clears the bar.",
      winner: "v1",
      posteriors: { v1: 0.97 },
    });
    expect(r2.entries).toHaveLength(2);
    expect(r2.entries[0]).toEqual(r1.entries[0]);
  });

  it("round-trips deep-equal", () => {
    const results: OfferResults = {
      offerId: "ofr_spring",
      entries: [
        { at: "2026-09-16T00:00:00Z", decision: "continue", rationale: "wait", winner: null, posteriors: { v1: 0.4 } },
      ],
    };
    expect(parseResults(serializeResults(results))).toEqual(results);
  });

  it("never mutates the passed-in results object", () => {
    const original: OfferResults = { offerId: "ofr_spring", entries: [] };
    appendResultEntry(original, "ofr_spring", {
      at: "2026-09-16T00:00:00Z",
      decision: "continue",
      rationale: "wait",
      winner: null,
      posteriors: {},
    });
    expect(original.entries).toHaveLength(0);
  });
});
