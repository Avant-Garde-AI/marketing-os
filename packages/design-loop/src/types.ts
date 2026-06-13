/**
 * Core types for the design-loop engine.
 *
 * The conformance + capture-bundle shapes are authored to match the knowledge
 * plane's Design MCP (`validate_design_conformance`, PRD §4.1) and the capture
 * bundle (PRD §4.2) so the local implementations can be swapped for the hosted
 * MCP behind an identical return shape.
 */
import { z } from "zod";

/** The three responsive viewports captured every render (PRD §4.2). */
export const VIEWPORTS = [
  { name: "mobile", width: 390 },
  { name: "tablet", width: 768 },
  { name: "desktop", width: 1440 },
] as const;

export type ViewportName = (typeof VIEWPORTS)[number]["name"];

// ── Capture bundle (PRD §4.2) ────────────────────────────────────────────────

export const captureManifestSchema = z.object({
  page: z.string(),
  themeRef: z.string(),
  commit: z.string().nullable(),
  capturedAt: z.string(),
  /** Version vector stamped on every artifact (PRD §6). */
  versionVector: z.object({
    agent: z.string(),
    skillset: z.string(),
    mcpSnapshot: z.string(),
    brandDoc: z.string(),
  }),
});
export type CaptureManifest = z.infer<typeof captureManifestSchema>;

/**
 * Structured page observations the capture step extracts (via Playwright
 * `page.evaluate` for real renders, fabricated by the stub in tests). The
 * deterministic gates are pure functions over these — never over the VLM.
 */
export const observationsSchema = z.object({
  /** Visible copy runs — scanned for confirmshame / fake-urgency wording. */
  texts: z.array(z.string()).default([]),
  /** Form inputs — pre-checked upsells are a dark pattern. */
  inputs: z.array(z.object({
    type: z.string(),
    name: z.string(),
    checked: z.boolean(),
  })).default([]),
  /** Images — missing alt text is a WCAG violation. */
  images: z.array(z.object({ src: z.string(), hasAlt: z.boolean() })).default([]),
  /** Text/background contrast ratios computed from rendered styles. */
  contrast: z.array(z.object({
    selector: z.string(),
    ratio: z.number(),
    largeText: z.boolean(),
  })).default([]),
  /** Heuristic markers for countdown timers / fabricated stock counters. */
  markers: z.array(z.object({ kind: z.string(), selector: z.string() })).default([]),
});
export type Observations = z.infer<typeof observationsSchema>;

/**
 * A capture bundle is passed BY REFERENCE (local path now, signed GCS URL in
 * Phase 2) — never inlined into a contract or MCP payload (PRD §4.2).
 */
export const captureBundleRefSchema = z.object({
  /** Local filesystem path or remote URL to the bundle root. */
  location: z.string(),
  manifest: captureManifestSchema,
  screenshots: z.record(z.string(), z.string()).default({}),
  /** Computed-style extract: colors / type / spacing actually in use. */
  tokens: z.record(z.string(), z.unknown()).default({}),
  /** Page regions classified to the section vocabulary. */
  domSegments: z.array(z.object({ region: z.string(), selector: z.string() })).default([]),
  observations: observationsSchema.default({}),
});
export type CaptureBundleRef = z.infer<typeof captureBundleRefSchema>;

// ── Gates & conformance (PRD §4.1, §3, §8) ──────────────────────────────────

export const findingSchema = z.object({
  code: z.string(),
  message: z.string(),
  selector: z.string().optional(),
  severity: z.enum(["info", "warn", "error"]),
});
export type Finding = z.infer<typeof findingSchema>;

export const gateResultSchema = z.object({
  passed: z.boolean(),
  findings: z.array(findingSchema).default([]),
});
export type GateResult = z.infer<typeof gateResultSchema>;

export const visualDiffSchema = z.object({
  /** 0 = identical, 1 = completely different. */
  mismatch: z.number().min(0).max(1),
  changedPixels: z.number().int().nonnegative(),
  totalPixels: z.number().int().nonnegative(),
  /** True when the change regressed something it should not have. */
  regression: z.boolean(),
});
export type VisualDiff = z.infer<typeof visualDiffSchema>;

/**
 * Identical shape to the Design MCP `validate_design_conformance` return, so the
 * local merge can be replaced by the hosted call without touching callers.
 */
export const conformanceResultSchema = z.object({
  /** Aggregate 0..1 score. */
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  /** Does the design serve the documented persona (VLM read). */
  personaFit: z.object({
    score: z.number().min(0).max(1),
    notes: z.array(z.string()).default([]),
  }),
  /** Mechanical design-quality flags from the VLM critic. */
  flags: z.array(findingSchema).default([]),
  /** Deterministic, hard gates (PRD §3/§8). */
  gates: z.object({
    darkPattern: gateResultSchema,
    a11y: gateResultSchema,
    tokenFidelity: gateResultSchema,
  }),
  visualDiff: visualDiffSchema.optional(),
  source: z.enum(["local", "design-mcp"]),
});
export type ConformanceResult = z.infer<typeof conformanceResultSchema>;

// ── Brand context ────────────────────────────────────────────────────────────

/** The slice of `brand-design.md` the loop and critic need (PRD §2). */
export const brandContextSchema = z.object({
  brandId: z.string(),
  category: z.string().optional(),
  /** Declared design tokens — the fidelity target. */
  tokens: z.record(z.string(), z.string()).default({}),
  /** Persona drivers/objections, or a NeuroGraph persona ref when connected. */
  persona: z.string().optional(),
  /** Plain-language design principles / decision rubric (PRD §2 §6). */
  principles: z.array(z.string()).default([]),
});
export type BrandContext = z.infer<typeof brandContextSchema>;

// ── Provider interfaces (dependency injection seams) ─────────────────────────
//
// The loop is pure orchestration; every side-effecting capability is an
// injected provider. Real adapters (Playwright, theme dev, a VLM endpoint) live
// in src/adapters and are loaded lazily; tests inject stubs (src/providers).

/** Runs a Shopify theme preview and exposes a base URL. */
export interface ThemeServer {
  baseUrl(): string;
  stop(): Promise<void>;
}

export interface CaptureProvider {
  /** Render `page` at all viewports and produce a §4.2 capture bundle. */
  capture(input: {
    page: string;
    baseUrl: string;
    manifest: CaptureManifest;
    outDir: string;
  }): Promise<CaptureBundleRef>;
}

export interface CriticProvider {
  /** The VLM read: persona fit + design-quality flags from screenshots. */
  critique(input: {
    bundle: CaptureBundleRef;
    brand: BrandContext;
    intent: string;
  }): Promise<{ personaFit: ConformanceResult["personaFit"]; flags: Finding[] }>;
}

/** The code-writing step. In tests a scripted stub; in Phase 1 the deep agent's LLM editor. */
export interface Implementer {
  implement(input: ImplementInput): Promise<ImplementOutput>;
}

export interface ImplementInput {
  intent: string;
  brand: BrandContext;
  scope: { pages: string[]; sections: string[]; files: string[] };
  iteration: number;
  /** Critique from the previous iteration, if any. */
  priorCritique?: ConformanceResult;
  workspaceDir: string;
  /** Design MCP, for consulting category conventions / patterns mid-implementation. */
  knowledge?: import("./design-mcp/types.js").DesignKnowledge;
  /** Pinned design skills selected for this task — the execution vocabulary (PRD §4.3). */
  skills?: import("./skills/types.js").DesignSkill[];
}

export interface ImplementOutput {
  /** Files the implementer wrote/changed this iteration. */
  touchedFiles: string[];
  /** Free-form note on what was changed (feeds WorkReport + critic). */
  note: string;
  /**
   * Set when the implementer refuses on guardrail / asset-boundary grounds
   * (e.g. "recreate brand X's hero"). Produces a `rejected` WorkReport — the
   * intended success path, not a failure (PRD §3/§4.4).
   */
  refusal?: { reason: string };
}

/** Optional visual-regression provider (pixelmatch adapter, or none). */
export interface DiffProvider {
  /** Compare a new bundle against a baseline; returns per-page worst diff. */
  compare(input: { baseline: CaptureBundleRef; candidate: CaptureBundleRef }): Promise<VisualDiff>;
}

export interface DesignLoopProviders {
  themeServer: ThemeServer;
  capture: CaptureProvider;
  critic: CriticProvider;
  implementer: Implementer;
  diff?: DiffProvider;
  /** Design MCP (PRD §4.1). When set, conformance routes through it. */
  knowledge?: import("./design-mcp/types.js").DesignKnowledge;
  /** Capture-bundle ingestion (PRD §4.2). When set, bundles upload by reference. */
  uploader?: import("./upload.js").BundleUploader;
  /** Pinned design skill-set (PRD §4.3). When set, skills are selected + invoked. */
  skillSet?: import("./skills/types.js").SkillSet;
}

// ── Loop result ──────────────────────────────────────────────────────────────

export interface LoopCandidate {
  iteration: number;
  bundle: CaptureBundleRef;
  conformance: ConformanceResult;
  touchedFiles: string[];
  note: string;
}

export interface LoopResult {
  accepted: boolean;
  escalated: boolean;
  rejected: boolean;
  rejectionReason?: string;
  iterations: number;
  maxIterations: number;
  /** Highest-scoring candidate seen (the one to present). */
  best: LoopCandidate | null;
  /** All candidates, oldest first. */
  history: LoopCandidate[];
  /** Critique attached to the best candidate when escalated (PRD §1 Phase B). */
  critique?: string;
  /** Design skills selected/invoked for this sub-task (provenance, PRD §6). */
  skillsInvoked: string[];
}
