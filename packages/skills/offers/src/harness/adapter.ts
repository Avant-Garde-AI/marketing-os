/**
 * The harness's call shapes over the pack (spec 34): the arm-keyed compile
 * that refuses on a failed gate, a flat findings list, string-or-null
 * validation, JSON fingerprint rows for a sandbox task file, and the two
 * mechanical normalizations applied before compiling (withProgress,
 * withLeadImage). No policy lives here — every rule is the pack's; this is
 * the adapter the hosted harness was written against, moved here so any
 * runtime can drive the same harness.
 *
 * NOTE: "../harness" is the pack's src/harness.ts (the archetype catalog,
 * diversity rule, critic aggregation and arm selection), not this directory.
 */
import {
  compileOfferManifestV2 as packCompile,
  type CompileOfferManifestV2Input as PackCompileInput,
} from "../manifest-v2";
import { gateOfferManifestV2 as packGate, validateOfferManifest as packValidate } from "../gates-v2";
import {
  ARCHETYPES as PACK_ARCHETYPES,
  aggregateCriticScores as packAggregate,
  checkConceptDiversity as packDiversity,
  selectArms as packSelect,
  type CriticId,
} from "../harness";
import { VENDOR_FINGERPRINTS as PACK_FINGERPRINTS, gradeOfferAudit } from "../audit";
import { OfferConceptSchema, type OfferConcept } from "../schema-v2";
import type {
  ArchetypeId,
  IncumbentVendor,
  OfferManifestV2,
  TriggerSpec,
  VariantV2Style,
} from "../types";

export type {
  ArchetypeId,
  ArmKind,
  ArmV2,
  AuditFacts,
  Block,
  CellKey,
  CompositionId,
  DiagReport,
  Incentive,
  IncumbentVendor,
  OfferAuditReport,
  OfferManifestV2,
  OfferTargeting,
  Placement,
  Rect,
  RubricLine,
  Step,
  TriggerSpec,
  VariantV2,
} from "../types";
export type StyleTokens = VariantV2Style;
export type { CriticId, OfferConcept };
export { OfferConceptSchema, gradeOfferAudit };

export const COMPOSITIONS = ["split-image", "full-bleed-image", "editorial-type", "card"] as const;

// ---------------------------------------------------------------------------
// Fingerprints — flattened to JSON rows for the sandbox task file.
// ---------------------------------------------------------------------------

export interface VendorFingerprint {
  vendor: Exclude<IncumbentVendor, "unknown">;
  scriptSrc: string[];
  scriptSrcPattern?: string;
  globals: string[];
  selectors: string[];
}

export const VENDOR_FINGERPRINTS: VendorFingerprint[] = Object.entries(PACK_FINGERPRINTS).map(([vendor, fp]) => ({
  vendor: vendor as VendorFingerprint["vendor"],
  scriptSrc: fp.scriptSrc,
  ...(fp.scriptSrcPatterns?.length ? { scriptSrcPattern: fp.scriptSrcPatterns.join("|") } : {}),
  globals: fp.globals ?? [],
  selectors: fp.selectors ?? [],
}));

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------

export const ARCHETYPES: Record<ArchetypeId, { label: string; hook: string; fits: string; description: string }> =
  Object.fromEntries(
    Object.entries(PACK_ARCHETYPES).map(([id, a]) => [
      id,
      { label: a.label, hook: a.description, fits: a.fitsWhen, description: a.description },
    ]),
  ) as Record<ArchetypeId, { label: string; hook: string; fits: string; description: string }>;

export function checkConceptDiversity(concepts: Pick<OfferConcept, "archetype">[]): {
  ok: boolean;
  distinctArchetypes: number;
  reason?: string;
} {
  const r = packDiversity(concepts);
  return { ok: r.ok, distinctArchetypes: r.distinct, ...(r.ok ? {} : { reason: r.message }) };
}

// ---------------------------------------------------------------------------
// Compile + gate
// ---------------------------------------------------------------------------

export interface CompileOfferManifestV2Input {
  surfaceSlug: string;
  title?: string;
  placement?: OfferManifestV2["placement"];
  /** variant arm key → concept; keys are ordered v1, v2 by the pack. */
  arms: Record<string, OfferConcept>;
  style: StyleTokens;
  controlWeight?: number;
  incumbent?: { vendor: IncumbentVendor } | null;
  pages?: ("home" | "collection" | "product" | "cart")[];
  trigger?: TriggerSpec;
  teaser?: boolean;
  margin?: { grossMarginPct: number; floorPct: number };
}

export interface GateFinding {
  code: string;
  message: string;
  path?: string;
}

export function gateOfferManifestV2(manifest: OfferManifestV2): { passed: boolean; findings: GateFinding[] } {
  const g = packGate(manifest);
  const findings: GateFinding[] = [];
  const seen = new Set<string>();
  const add = (f: GateFinding) => {
    const k = `${f.code}|${f.path ?? ""}|${f.message}`;
    if (!seen.has(k)) {
      seen.add(k);
      findings.push(f);
    }
  };
  for (const v of Object.values(g.variants)) v.findings.forEach(add);
  g.structure.findings.forEach(add);
  g.manifestFindings.forEach(add);
  g.darkPattern.findings.forEach((f) => add({ code: `dark:${f.code}`, message: f.message }));
  return { passed: g.passed, findings };
}

/** The one mechanical normalization the harness applies before compiling:
 * a multi-step concept gets its progress indicator even if the model left it
 * out — the pack requires one, and adding it never changes meaning. */
export function withProgress(c: OfferConcept): OfferConcept {
  if (c.steps.length < 2) return c;
  return {
    ...c,
    steps: c.steps.map((s) =>
      s.kind === "reward" || s.blocks.some((b) => b.kind === "progress")
        ? s
        : { ...s, blocks: [{ kind: "progress" as const }, ...s.blocks] },
    ),
  };
}

/** Image-led compositions need their image in the FIRST step (the pack's
 * rule — the image is the first thing seen). When the model placed it later,
 * or only as the concept-level imageSrc, move it to the front. */
export function withLeadImage(c: OfferConcept): OfferConcept {
  if (c.composition !== "split-image" && c.composition !== "full-bleed-image") return c;
  const first = c.steps[0];
  if (!first || first.blocks.some((b) => b.kind === "image")) return c;
  type ImageBlock = Extract<OfferConcept["steps"][number]["blocks"][number], { kind: "image" }>;
  let lead: ImageBlock | undefined;
  const steps = c.steps.map((s, i) => {
    if (i === 0 || lead) return s;
    const idx = s.blocks.findIndex((b) => b.kind === "image");
    if (idx === -1) return s;
    lead = s.blocks[idx] as ImageBlock;
    return { ...s, blocks: s.blocks.filter((_, j) => j !== idx) };
  });
  if (!lead && c.imageSrc) lead = { kind: "image", src: c.imageSrc, alt: c.imageAlt ?? c.title };
  if (!lead) return c;
  return { ...c, steps: steps.map((s, i) => (i === 0 ? { ...s, blocks: [lead!, ...s.blocks] } : s)) };
}

export function compileOfferManifestV2(input: CompileOfferManifestV2Input): OfferManifestV2 {
  const keys = Object.keys(input.arms).sort();
  const packInput: PackCompileInput = {
    slug: input.surfaceSlug,
    ...(input.title ? { title: input.title } : {}),
    ...(input.placement ? { placement: input.placement } : {}),
    concepts: keys.map((k) => withLeadImage(withProgress(input.arms[k]!))),
    style: input.style,
    ...(input.controlWeight !== undefined ? { controlWeight: input.controlWeight } : {}),
    ...(input.incumbent ? { incumbent: input.incumbent } : {}),
    ...(input.pages ? { pages: input.pages } : {}),
    ...(input.trigger ? { trigger: input.trigger } : {}),
    ...(input.teaser !== undefined ? { teaser: input.teaser } : {}),
    ...(input.margin ? { margin: input.margin } : {}),
    policy: "thompson",
  };
  const manifest = packCompile(packInput);
  // The pack's compiler refuses structure; copy rules are the gate's. The
  // harness treats a manifest that compiles but fails the gate as refused.
  const gate = gateOfferManifestV2(manifest);
  if (!gate.passed) throw new Error(`manifest refused: ${gate.findings.map((f) => f.message).join("; ")}`);
  return manifest;
}

/** Either manifest version; null when valid. */
export function validateOfferManifest(manifest: unknown): string | null {
  const r = packValidate(manifest);
  return r.ok ? null : r.errors.join("; ");
}

// ---------------------------------------------------------------------------
// Critics → selection
// ---------------------------------------------------------------------------

export interface CriticVerdict {
  critic: CriticId;
  score: number;
  pass: boolean;
  notes: string;
  /** false = n/a (e.g. no incumbent to compare against) */
  applicable?: boolean;
}

export function aggregateCriticScores(verdicts: CriticVerdict[]): {
  score: number;
  pass: boolean;
  hardFail: boolean;
  failing: CriticId[];
} {
  const r = packAggregate(
    verdicts.map((v) => ({ critic: v.critic, score: v.score, pass: v.pass, notes: v.notes, na: v.applicable === false })),
  );
  const failing = verdicts.filter((v) => v.applicable !== false && !v.pass).map((v) => v.critic);
  // The pack's `passing` = hard gates clear and every critic scored; the
  // harness additionally repairs (rather than ships) a soft-critic failure.
  return { score: r.score, pass: r.passing && failing.length === 0, hardFail: r.failedGates.length > 0, failing };
}

export function selectArms<
  T extends { id: string; aggregate: { score: number; pass: boolean }; c?: { concept?: { archetype: ArchetypeId } } },
>(scored: T[], n = 2): T[] {
  const picked = packSelect(
    scored.map((s) => ({
      archetype: s.c?.concept?.archetype ?? ("quiet-editorial" as ArchetypeId),
      score: s.aggregate.score,
      passing: s.aggregate.pass,
      ref: s,
    })),
    n,
  );
  return picked.map((p) => p.ref);
}
