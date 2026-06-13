/**
 * Stub providers — no I/O, no browser, no model. Used by tests and as the safe
 * default when no real adapters are configured. They make the full
 * TaskSpec → deep-agent → loop → WorkReport path runnable deterministically.
 */
import type {
  CaptureBundleRef,
  CaptureProvider,
  CriticProvider,
  DesignLoopProviders,
  DiffProvider,
  Finding,
  Implementer,
  Observations,
  ThemeServer,
} from "../types.js";

export interface StubScenario {
  /** Persona-fit score at iteration 1, before any refinement. */
  personaStart?: number;
  /** Added to persona-fit each iteration. */
  personaStep?: number;
  /** Upper bound on persona-fit (set < 0.85 to force escalation). */
  personaCeiling?: number;
  /** Inject a persistent dark-pattern marker into every capture. */
  injectDarkPattern?: boolean;
  /** Inject a persistent a11y contrast violation into every capture. */
  injectA11y?: boolean;
  /** Implementer refuses (rejected path) when the intent matches. */
  refuseIfIntentMatches?: RegExp;
  /** VLM design-quality flags to attach. */
  flags?: Finding[];
}

export function createStubProviders(scenario: StubScenario = {}): DesignLoopProviders {
  const personaStart = scenario.personaStart ?? 0.6;
  const personaStep = scenario.personaStep ?? 0.15;
  const personaCeiling = scenario.personaCeiling ?? 0.95;

  let critiqueCalls = 0;

  const themeServer: ThemeServer = {
    baseUrl: () => "http://localhost:9292",
    stop: async () => undefined,
  };

  const capture: CaptureProvider = {
    capture: async ({ page, manifest }): Promise<CaptureBundleRef> => {
      const observations: Observations = {
        texts: ["Add to cart", "Free shipping over $50"],
        inputs: [{ type: "checkbox", name: "newsletter", checked: false }],
        images: [{ src: "/hero.jpg", hasAlt: true }],
        contrast: [{ selector: ".hero h1", ratio: 6.2, largeText: true }],
        markers: [],
      };
      if (scenario.injectDarkPattern) {
        observations.markers.push({ kind: "countdown-timer", selector: ".urgency-timer" });
        observations.texts.push("Only 2 left in stock — selling fast!");
      }
      if (scenario.injectA11y) {
        observations.contrast.push({ selector: ".promo small", ratio: 2.1, largeText: false });
        observations.images.push({ src: "/badge.png", hasAlt: false });
      }
      return {
        location: `stub://${page}`,
        manifest,
        screenshots: { "desktop:full": `stub://${page}#1440` },
        tokens: { colors: { primary: "#111111", bg: "#ffffff" } },
        domSegments: [{ region: "hero", selector: ".hero" }],
        observations,
      };
    },
  };

  const critic: CriticProvider = {
    critique: async () => {
      critiqueCalls += 1;
      const raw = personaStart + personaStep * (critiqueCalls - 1);
      const score = Math.min(personaCeiling, raw);
      return {
        personaFit: {
          score,
          notes: score >= 0.85 ? ["serves the documented persona"] : ["persona drivers not yet fully activated"],
        },
        flags: scenario.flags ?? [],
      };
    },
  };

  const implementer: Implementer = {
    implement: async ({ scope, iteration, intent }) => {
      if (scenario.refuseIfIntentMatches && scenario.refuseIfIntentMatches.test(intent)) {
        return {
          touchedFiles: [],
          note: "refused on asset-boundary grounds",
          refusal: { reason: "Request would reproduce another brand's assets/copy — abstaining (PRD §4.4)." },
        };
      }
      const file = scope.files[0] ?? `sections/${(scope.sections[0] ?? "hero")}.liquid`;
      return {
        touchedFiles: [file],
        note: `iteration ${iteration}: applied design changes to ${file}`,
      };
    },
  };

  const diff: DiffProvider = {
    compare: async () => ({ mismatch: 0.02, changedPixels: 1200, totalPixels: 60000, regression: false }),
  };

  return { themeServer, capture, critic, implementer, diff };
}
