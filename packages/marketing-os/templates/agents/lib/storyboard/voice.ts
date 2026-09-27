/** Bind a concept's writing guidance from the tenant's real reference artifact. */
import { createHash } from "node:crypto";
import { GENOME_PATH, parseGenome } from "../social/reference";
import type { PlanningContext } from "./schemas";
import type { PlanningConcept } from "./graph-context";

export async function bindConceptVoice(base: PlanningContext, concept: PlanningConcept, repo: { readFile(path: string): Promise<string | null> }): Promise<{ context: PlanningContext; sources: Array<{ path: string; hash: string }> }> {
  const refs = concept.voice?.copyFormulaRefs ?? [];
  if (!refs.length) return { context: base, sources: [] };
  if (new Set(refs).size !== refs.length) throw new Error("Concept voice has duplicate copy formula references");
  const raw = await repo.readFile(GENOME_PATH);
  if (raw === null) throw new Error("Concept voice requires an acquired social reference genome");
  const genome = parseGenome(raw);
  const sha = createHash("sha256").update(raw).digest("hex");
  const source = `copy-formulas:${sha}`;
  const formulas = refs.map((id) => {
    const matches = (genome.copyFormulas ?? []).filter((formula) => formula.id === id);
    if (matches.length !== 1) throw new Error(`Concept copy formula '${id}' has no unique definition in the acquired genome`);
    return { id, source, definition: JSON.stringify(matches[0]) };
  });
  const guidance = { copyFormulas: formulas, evidenceNote: "Writing guidance only; this binding supplies no counted corpus observations or performance evidence." };
  return { context: { ...base,
    facts: [...base.facts.filter((fact) => fact.source !== source), { source, content: JSON.stringify(guidance) }],
    copyFormulas: [...(base.copyFormulas ?? []).filter((formula) => !refs.includes(formula.id)), ...formulas],
  }, sources: [{ path: GENOME_PATH, hash: sha }] };
}
