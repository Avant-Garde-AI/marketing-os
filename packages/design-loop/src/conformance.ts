/**
 * Conformance merge — combines the VLM critic read, the deterministic gates, and
 * the visual diff into one ConformanceResult.
 *
 * The return shape is identical to the Design MCP `validate_design_conformance`
 * (PRD §4.1), so `evaluateConformance` can be replaced by the hosted MCP call
 * (when DESIGN_MCP_ENDPOINT is set) without changing any caller.
 */
import { checkA11y, checkDarkPatterns, checkTokenFidelity } from "./gates.js";
import type {
  BrandContext,
  CaptureBundleRef,
  ConformanceResult,
  CriticProvider,
  Finding,
  VisualDiff,
} from "./types.js";
import type { DesignKnowledge } from "./design-mcp/types.js";

export interface EvaluateInput {
  bundle: CaptureBundleRef;
  brand: BrandContext;
  intent: string;
  wcag: "A" | "AA" | "AAA";
  critic: CriticProvider;
  visualDiff?: VisualDiff;
  /** When set, the persona read comes from the hosted Design MCP (PRD §4.1). */
  knowledge?: DesignKnowledge;
  brandDesignRef?: { path: string; version: string };
}

export async function evaluateConformance(input: EvaluateInput): Promise<ConformanceResult> {
  const { bundle, brand, intent, wcag, critic, visualDiff, knowledge, brandDesignRef } = input;

  // Deterministic gates are ALWAYS computed locally and are authoritative — the
  // remote MCP read can never buy back a dark-pattern or a11y failure (PRD §3/§4.4).
  const darkPattern = checkDarkPatterns(bundle);
  const a11y = checkA11y(bundle, wcag);
  const tokenFidelity = checkTokenFidelity(bundle, brand);

  let personaFit: ConformanceResult["personaFit"];
  let flags: Finding[];
  let source: ConformanceResult["source"];

  if (knowledge) {
    const remote = await knowledge.validateDesignConformance({
      captureBundleRef: bundle, // by reference (PRD §4.2)
      brandDesignRef: brandDesignRef ?? { path: "", version: "" },
      brand,
      intent,
      wcag,
    });
    personaFit = remote.personaFit;
    flags = remote.flags;
    source = "design-mcp";
  } else {
    const c = await critic.critique({ bundle, brand, intent });
    personaFit = c.personaFit;
    flags = c.flags;
    source = "local";
  }

  const score = computeScore({ personaFit, flags, darkPattern, a11y, tokenFidelity, visualDiff });
  const passed =
    darkPattern.passed &&
    a11y.passed &&
    !(visualDiff?.regression ?? false) &&
    score >= 0.85;

  return { score, passed, personaFit, flags, gates: { darkPattern, a11y, tokenFidelity }, visualDiff, source };
}

interface ScoreInput {
  personaFit: ConformanceResult["personaFit"];
  flags: Finding[];
  darkPattern: ConformanceResult["gates"]["darkPattern"];
  a11y: ConformanceResult["gates"]["a11y"];
  tokenFidelity: ConformanceResult["gates"]["tokenFidelity"];
  visualDiff?: VisualDiff;
}

function computeScore(i: ScoreInput): number {
  // Hard gates zero the score — nothing else can buy them back.
  if (!i.darkPattern.passed) return 0;
  if (!i.a11y.passed) return 0;
  if (i.visualDiff?.regression) return 0;

  // Persona fit is the primary signal; flags and off-palette drift deduct.
  let score = i.personaFit.score;
  const errorFlags = i.flags.filter((f) => f.severity === "error").length;
  const warnFlags = i.flags.filter((f) => f.severity === "warn").length;
  score -= errorFlags * 0.15;
  score -= warnFlags * 0.05;
  score -= i.tokenFidelity.findings.filter((f) => f.severity !== "info").length * 0.03;

  return clamp01(score);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
