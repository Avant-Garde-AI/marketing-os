import { createHash } from "node:crypto";
import { copyFormulaProblems, planningContextSchema, type PlanningContext } from "./schemas";

/** Provider-neutral evidence packet; the runtime must acquire it itself, not accept it from a model. */
export interface SubjectPlanningPacket {
  tenant: string;
  receipts: Array<{ ref: string; kind: "graph" | "catalog"; data: unknown }>;
  subjects: Array<{ handle: string; title: string; imageUrl: string; sourceRefs: string[] }>;
}
export interface PlanningConcept {
  id: string;
  premise: string;
  payoff: string;
  status: "draft" | "active" | "retired";
  needs: Array<{ id: string; description: string; required?: boolean }>;
  expressions: { single?: unknown; carousel?: { availability?: string }; video?: { availability?: string } };
  voice?: { copyFormulaRefs?: string[]; hook?: string };
}

/** Compile acquired facts into a planning context without importing an MCP client or renderer. */
export function compileGraphPlanningContext(
  base: PlanningContext,
  concept: PlanningConcept,
  packet: SubjectPlanningPacket,
  tenant: string
): PlanningContext {
  const acquiredBase = planningContextSchema.parse(base);
  if (!tenant.trim() || packet.tenant !== tenant) throw new Error("Subject packet tenant does not match the planning request");
  if (concept.status === "retired") throw new Error("Retired content concepts cannot be instantiated");
  const formats = (["single", "carousel", "video"] as const).filter((format) => {
    const expression = concept.expressions[format];
    return expression && (format === "single" || (expression as { availability?: string }).availability !== "blocked");
  });
  if (!formats.length) throw new Error("Content concept has no available expression");
  if (!packet.subjects.length || packet.subjects.length > 6) throw new Error("Graph planning needs 1–6 usable catalog subjects");
  const receipts = new Map(packet.receipts.map((r) => [r.ref, r]));
  if (receipts.size !== packet.receipts.length || new Set(packet.subjects.map((s) => s.handle)).size !== packet.subjects.length)
    throw new Error("Subject packet contains duplicate identities");
  for (const subject of packet.subjects) {
    if (!subject.sourceRefs.some((ref) => receipts.get(ref)?.kind === "graph") ||
        !subject.sourceRefs.some((ref) => receipts.get(ref)?.kind === "catalog") ||
        subject.sourceRefs.some((ref) => !receipts.has(ref)))
      throw new Error(`Catalog subject ${subject.handle} lacks acquired graph and catalog receipts`);
  }
  const source = `concept:${createHash("sha256").update(JSON.stringify({ tenant, concept })).digest("hex")}`;
  const selectedConcept = { id: concept.id, source, premise: concept.premise, payoff: concept.payoff, formats,
    needs: concept.needs.map((need) => ({ ...need, required: need.required !== false })),
    ...(concept.voice ? { voice: concept.voice } : {}),
  };
  const voiceProblems = copyFormulaProblems({ ...acquiredBase, concept: selectedConcept });
  if (voiceProblems.length) throw new Error(voiceProblems.join("; "));
  const facts = new Map(acquiredBase.facts.map((f) => [f.source, f]));
  for (const r of packet.receipts) facts.set(r.ref, { source: r.ref, content: JSON.stringify(r.data) });
  facts.set(source, { source, content: JSON.stringify(concept) });
  const assets = new Map(acquiredBase.assets.map((a) => [a.ref, a]));
  for (const subject of packet.subjects)
    if (!assets.has(subject.imageUrl)) assets.set(subject.imageUrl, { ref: subject.imageUrl, kind: "unknown" });
  return planningContextSchema.parse({
    ...acquiredBase, facts: [...facts.values()], assets: [...assets.values()],
    concept: selectedConcept,
    subjects: packet.subjects.map((subject) => ({ handle: subject.handle, assetRef: subject.imageUrl, sourceRefs: subject.sourceRefs })),
  });
}
