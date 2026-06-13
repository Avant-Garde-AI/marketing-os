/**
 * Runtime configuration for the design-loop.
 *
 * Everything is env/flag-driven so the OSS harness can point at any model
 * endpoint while the hosted product points at the central GCP serving plane
 * (PRD §3). Defaults are safe for local/stub runs.
 */
import type { VersionVector } from "./contract.js";

export interface DesignLoopConfig {
  /** Hard cap on refine iterations per slice (PRD §1 Phase B). */
  maxIterations: number;
  /** Conformance score at/above which a candidate is accepted. */
  acceptThreshold: number;
  /** Shopify theme dev port. */
  themePort: number;
  /** VLM critic endpoint (OpenAI-style base URL); empty ⇒ use stub critic. */
  criticEndpoint: string;
  criticModel: string;
  /** Design MCP endpoint; empty ⇒ use local conformance merge. */
  designMcpEndpoint: string;
  /** Where capture bundles are written. */
  workDir: string;
  /** Trace emission is consented + configurable per client (PRD §5/§6). */
  traceEnabled: boolean;
  traceEndpoint: string;
  versionVector: VersionVector;
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(overrides: Partial<DesignLoopConfig> = {}): DesignLoopConfig {
  const base: DesignLoopConfig = {
    maxIterations: envInt("DESIGN_LOOP_MAX_ITERS", 4),
    acceptThreshold: Number.parseFloat(env("DESIGN_LOOP_ACCEPT_THRESHOLD", "0.85")),
    themePort: envInt("SHOPIFY_PORT", 9292),
    criticEndpoint: env("DESIGN_CRITIC_ENDPOINT", ""),
    criticModel: env("DESIGN_CRITIC_MODEL", "claude-sonnet-4-6"),
    designMcpEndpoint: env("DESIGN_MCP_ENDPOINT", ""),
    workDir: env("DESIGN_LOOP_WORKDIR", ".design-loop"),
    traceEnabled: env("DESIGN_TRACE_ENABLED", "false") === "true",
    traceEndpoint: env("DESIGN_TRACE_ENDPOINT", ""),
    versionVector: {
      agent: env("DESIGN_AGENT_VERSION", "design-loop@0.1.0"),
      skillset: env("DESIGN_SKILLSET_VERSION", "none"),
      mcpSnapshot: env("DESIGN_MCP_SNAPSHOT", "none"),
      brandDoc: env("DESIGN_BRAND_DOC_VERSION", "unknown"),
    },
  };
  return { ...base, ...overrides };
}
