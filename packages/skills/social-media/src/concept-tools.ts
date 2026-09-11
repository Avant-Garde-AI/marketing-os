/**
 * The agent-facing surface for post concepts (spec 29).
 *
 * Four tools covering the loop the concept layer exists to support: browse the
 * store's ideas, read one, draft a new one from something seen in the market,
 * and ask an idea for N grounded instances.
 *
 * ## Who decides whether a need is met
 *
 * The pack does NOT assess needs itself, and that is a deliberate boundary
 * rather than a gap. "Does this work show inferable technique" is a judgement
 * about a specific artwork in a specific store's vocabulary; a resolver living
 * in the platform would have to encode one store's nouns as if they were
 * universal (spec 29 D2). So `instantiate` takes candidates whose needs the
 * CALLER has already assessed, each with the evidence for that call.
 *
 * That boundary buys the property the whole layer is for. The agent cannot
 * quietly assume a need is satisfied — it has to say, per need, that it
 * checked and what it found, and that statement travels into the output where
 * a human can disagree with it. An unassessed need counts as unmet
 * (`assessFit`), so the lazy path is the safe one.
 *
 * ## Reads compose freely; writes narrow
 *
 * Three of these are reads. `social_concept_draft` writes, but only ever a
 * `status: draft` artifact — drafts are free by construction (spec 23 §2), and
 * promoting a draft to `active` is the gate (spec 29 D3). Nothing here
 * publishes, schedules, or creates a post: `instantiate` returns PLANS, and
 * turning a plan into a post artifact stays with the existing authoring tools.
 */

import { z } from "zod";
import type { SkillToolDefinition, SocialRepo } from "./types";
import {
  CONCEPTS_DIR,
  beatInstruction,
  conceptPath,
  parseConcept,
  selectSubjects,
  serializeConcept,
  validateConcept,
  type ConceptFormat,
  type PostConcept,
  type SequenceExpression,
  type SubjectFit,
} from "./concepts";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const conceptSummary = z.object({
  id: z.string(),
  name: z.string(),
  premise: z.string(),
  payoff: z.string(),
  status: z.enum(["draft", "active", "retired"]),
  formats: z.array(z.string()).describe("Formats this idea can take"),
  blockedFormats: z.array(z.object({ format: z.string(), why: z.string() })),
  needs: z.array(z.string()).describe("Need ids — what must exist for an instance to be real"),
  evidence: z.object({ kind: z.string(), n: z.number() }),
  cadence: z.string().optional(),
});

const listInput = z.object({
  status: z
    .enum(["draft", "active", "retired"])
    .optional()
    .describe("Filter by lifecycle status; omit for all"),
});
const listOutput = z.object({
  available: z.boolean().describe("False when the store has authored no concepts yet"),
  concepts: z.array(conceptSummary),
  note: z.string().optional(),
});

const readInput = z.object({ id: z.string().min(1).describe("Concept id") });
const readOutput = z.object({
  found: z.boolean(),
  concept: z.unknown().optional(),
  problems: z.array(z.object({ field: z.string(), detail: z.string(), severity: z.string() })),
  note: z.string().optional(),
});

const beatInput = z.object({
  role: z.string().describe("This frame's job in the argument — setup, turn, payoff, close"),
  direction: z.string().describe("What this frame shows"),
  archetypeId: z.string().optional().describe("Layout archetype for this frame, from the genome"),
  seconds: z.number().optional().describe("Video beats only"),
});

const sequenceInput = z.object({
  beats: z.array(beatInput).min(2),
  continuity: z
    .array(z.string())
    .optional()
    .describe(
      "What must NOT vary between frames — camera, surface, light, position. Frames generated " +
        "independently drift, and a sequence whose light changes reads as unrelated pictures " +
        "rather than one argument. Omitting this is the most common way a carousel fails.",
    ),
  availability: z.enum(["available", "blocked"]).optional(),
  availabilityNote: z.string().optional().describe("Required when blocked — say what is missing"),
});

const draftInput = z.object({
  id: z.string().min(1).describe("Stable slug, e.g. 'how-it-was-made'"),
  name: z.string().min(1),
  premise: z.string().min(1).describe("What the post is about, as a repeatable idea"),
  payoff: z
    .string()
    .min(1)
    .describe(
      "Why a READER cares, in their terms. 'Shows our catalogue depth' is a reason for the brand " +
        "to post; 'you can tell whether it works in a room like yours' is a reason for someone to stop.",
    ),
  needs: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        required: z.boolean().optional().describe("Default true; false makes an instance thinner, not invalid"),
      }),
    )
    .min(1)
    .describe(
      "The content contract: what must EXIST for an instance to be real. This is what lets the " +
        "concept refuse rather than invent, so state the cases it must turn down.",
    ),
  expressions: z
    .object({
      single: z.object({ archetypeId: z.string().optional(), direction: z.string().min(1) }).optional(),
      carousel: sequenceInput.optional(),
      video: sequenceInput.optional(),
    })
    .describe("One idea, several shapes. A format this idea does not suit should be ABSENT, not empty."),
  voice: z
    .object({ copyFormulaRefs: z.array(z.string()).optional(), hook: z.string().optional() })
    .optional(),
  cadence: z.string().optional().describe("How often before it stops reading as an idea"),
  evidence: z
    .object({
      kind: z.enum(["counted", "researched", "brand-derived"]),
      n: z.number().default(0).describe("Exemplars counted — meaningful ONLY for 'counted'"),
    })
    .describe(
      "How this concept came to exist. An idea proposed in conversation is 'brand-derived' with " +
        "n=0; only a concept distilled from counted exemplars is 'counted'.",
    ),
  provenance: z.string().optional().describe("Where it came from — the observation, session or source"),
  body: z.string().optional().describe("The rationale, in your own words — what a human reads later"),
});
const draftOutput = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  problems: z.array(z.object({ field: z.string(), detail: z.string(), severity: z.string() })),
  note: z.string(),
});

const candidateInput = z.object({
  subjectId: z.string().min(1).describe("The store's own id for this subject — product, artist, set"),
  label: z.string().optional().describe("Human-readable name, for the returned plan"),
  assessments: z
    .array(
      z.object({
        needId: z.string().min(1),
        met: z.boolean(),
        evidence: z
          .string()
          .optional()
          .describe("What you actually checked. This travels into the output for review."),
      }),
    )
    .describe(
      "Your judgement, per need, for THIS subject. A need you do not assess counts as UNMET — " +
        "so check the ones you can and leave the ones you cannot, rather than guessing.",
    ),
});

const instantiateInput = z.object({
  conceptId: z.string().min(1),
  n: z.number().int().min(1).max(20).describe("How many instances you want"),
  format: z.enum(["single", "carousel", "video"]).optional().describe("Defaults to the concept's richest available format"),
  candidates: z.array(candidateInput).min(1).describe("Subjects to consider, with their needs assessed"),
});
const instantiateOutput = z.object({
  ok: z.boolean(),
  conceptId: z.string(),
  format: z.string().optional(),
  requested: z.number(),
  produced: z.number(),
  shortfall: z.number(),
  plans: z.array(
    z.object({
      subjectId: z.string(),
      label: z.string().optional(),
      frames: z.array(
        z.object({
          role: z.string(),
          archetypeId: z.string().optional(),
          seconds: z.number().optional(),
          instruction: z.string().describe("Direction plus the constants held across the sequence"),
        }),
      ),
      copyFormulaRefs: z.array(z.string()),
      hook: z.string().optional(),
      thinOn: z.array(z.string()).describe("Soft needs unmet — the instance is real but thinner"),
      grounding: z.array(z.object({ needId: z.string(), evidence: z.string() })),
    }),
  ),
  rejected: z.array(z.object({ subjectId: z.string(), unmet: z.array(z.string()) })),
  note: z.string(),
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ConceptTools {
  social_concept_list: SkillToolDefinition<typeof listInput, typeof listOutput>;
  social_concept_read: SkillToolDefinition<typeof readInput, typeof readOutput>;
  social_concept_draft: SkillToolDefinition<typeof draftInput, typeof draftOutput>;
  social_concept_instantiate: SkillToolDefinition<typeof instantiateInput, typeof instantiateOutput>;
}

function summarize(c: PostConcept) {
  const formats: string[] = [];
  const blockedFormats: { format: string; why: string }[] = [];
  for (const f of ["single", "carousel", "video"] as ConceptFormat[]) {
    const e = c.expressions[f];
    if (!e) continue;
    if (f !== "single" && "availability" in e && e.availability === "blocked") {
      blockedFormats.push({ format: f, why: e.availabilityNote ?? "no reason recorded" });
    } else {
      formats.push(f);
    }
  }
  return {
    id: c.id,
    name: c.name,
    premise: c.premise,
    payoff: c.payoff,
    status: c.status,
    formats,
    blockedFormats,
    needs: c.needs.map((n) => n.id),
    evidence: { kind: c.evidence.kind, n: c.evidence.n },
    ...(c.cadence !== undefined ? { cadence: c.cadence } : {}),
  };
}

export function createConceptTools(repo: SocialRepo): ConceptTools {
  async function loadAll(): Promise<PostConcept[]> {
    const paths = (await repo.list(CONCEPTS_DIR)).filter((p) => p.endsWith(".md"));
    const out: PostConcept[] = [];
    for (const path of paths) {
      const raw = await repo.readFile(path);
      if (raw === null) continue;
      try {
        out.push(parseConcept(raw, path));
      } catch {
        // One malformed concept must not hide the rest. The read tool reports
        // the parse failure for a specific id; the list stays usable.
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  return {
    social_concept_list: {
      id: "social_concept_list",
      description:
        "List the store's POST CONCEPTS — its reusable idea structures. A concept is not a layout or a template: it is a standing premise (what a post is about and why a reader cares) that can be run repeatedly with different subjects. " +
        "Read this BEFORE inventing a post from scratch: if an existing concept fits, instantiate it instead — that is how a feed acquires recurring formats people recognise rather than a stream of one-offs. " +
        "Each concept lists the formats it can take and the needs a subject must satisfy. Formats the store cannot currently produce come back as blockedFormats with the reason. " +
        "An empty list is normal for a new store, never an error — propose one with social_concept_draft.",
      inputSchema: listInput,
      outputSchema: listOutput,
      execute: async ({ status }) => {
        const all = await loadAll();
        const concepts = (status ? all.filter((c) => c.status === status) : all).map(summarize);
        return {
          available: concepts.length > 0,
          concepts,
          ...(concepts.length === 0
            ? {
                note: status
                  ? `No concepts with status "${status}". This store may simply not have authored any yet.`
                  : "This store has no post concepts yet — draft one from something you have observed.",
              }
            : {}),
        };
      },
    },

    social_concept_read: {
      id: "social_concept_read",
      description:
        "Read one post concept in full — its premise, reader payoff, content contract (needs), per-format expressions with their beat scripts and continuity constants, voice and evidence. " +
        "Use before instantiating, so you know what a subject must satisfy and what must stay constant across frames. " +
        "Returns any validation problems alongside the concept: a stored concept can still carry warnings, and they are worth relaying to the user.",
      inputSchema: readInput,
      outputSchema: readOutput,
      execute: async ({ id }) => {
        const path = conceptPath(id);
        const raw = await repo.readFile(path);
        if (raw === null) {
          return { found: false, problems: [], note: `No concept "${id}" at ${path}.` };
        }
        try {
          const concept = parseConcept(raw, path);
          return { found: true, concept, problems: validateConcept(concept) };
        } catch (e) {
          return {
            found: false,
            problems: [],
            note: `Concept "${id}" exists but does not parse: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      },
    },

    social_concept_draft: {
      id: "social_concept_draft",
      description:
        "Author a NEW post concept as a draft — the output of a session spent looking at what the market is doing, or at what has worked here. Writes social/concepts/<id>.md with status 'draft'; drafts are free and promoting one to active is a separate decision. " +
        "Write the payoff from the READER's chair. A payoff that can only be stated as a brand benefit ('shows our range') is decoration, and this tool will say so. " +
        "State the needs as the cases the concept must REFUSE — a concept that can never be refused will instantiate against anything, which is how invented content gets made. " +
        "For a carousel or video, give continuity constants: what must not vary between frames. Frames generated independently drift, and a sequence whose surface and light change reads as unrelated pictures rather than one argument. " +
        "Be honest about evidence: an idea you just had is 'brand-derived' with n=0, never 'counted'.",
      inputSchema: draftInput,
      outputSchema: draftOutput,
      execute: async (input) => {
        const concept: PostConcept = {
          id: input.id,
          name: input.name,
          premise: input.premise,
          payoff: input.payoff,
          needs: input.needs,
          expressions: input.expressions,
          evidence: { kind: input.evidence.kind, n: input.evidence.n ?? 0 },
          status: "draft",
          ...(input.voice !== undefined ? { voice: input.voice } : {}),
          ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
          ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
        };
        const problems = validateConcept(concept);
        const errors = problems.filter((p) => p.severity === "error");
        if (errors.length > 0) {
          return {
            ok: false,
            problems,
            note:
              "Not stored — fix these and call again:\n" +
              errors.map((e) => `- ${e.field}: ${e.detail}`).join("\n"),
          };
        }
        const path = conceptPath(concept.id);
        const existing = await repo.readFile(path);
        if (existing !== null) {
          return {
            ok: false,
            problems,
            note: `A concept "${concept.id}" already exists at ${path}. Choose a different id, or read and revise that one rather than overwriting an idea the store may already be running.`,
          };
        }
        await repo.writeFile(path, serializeConcept(concept));
        const warnings = problems.filter((p) => p.severity === "warning");
        return {
          ok: true,
          path,
          problems,
          note:
            `Drafted "${concept.id}" at ${path}.` +
            (warnings.length > 0
              ? ` Worth fixing before it goes live:\n${warnings.map((w) => `- ${w.field}: ${w.detail}`).join("\n")}`
              : ""),
        };
      },
    },

    social_concept_instantiate: {
      id: "social_concept_instantiate",
      description:
        "Ask a concept for N grounded instances — the 'give me three or four in this idea' step. Returns PLANS (per-subject frame directions, archetypes and copy formulas), not posts; writing a post artifact stays with the authoring tools. " +
        "You must supply candidate subjects WITH their needs assessed — the pack does not judge whether a specific work satisfies 'visible technique', because that is a judgement about this store's own catalogue. State, per need, whether you checked and what you found. " +
        "A need you do not assess counts as UNMET. This is the point: it returns fewer instances rather than inventing, and tells you the shortfall. If you asked for five and it returns three, the answer is three — widen the candidate pool or relax the concept, and NEVER fill the gap with subjects that missed a required need. " +
        "Each frame's instruction already includes the concept's continuity constants, so hand it to an image or video backend verbatim.",
      inputSchema: instantiateInput,
      outputSchema: instantiateOutput,
      execute: async ({ conceptId, n, format, candidates }) => {
        const raw = await repo.readFile(conceptPath(conceptId));
        if (raw === null) {
          return {
            ok: false,
            conceptId,
            requested: n,
            produced: 0,
            shortfall: n,
            plans: [],
            rejected: [],
            note: `No concept "${conceptId}". List the store's concepts first.`,
          };
        }
        const concept = parseConcept(raw, conceptPath(conceptId));

        // Richest available format, unless asked for one specifically. "Richest"
        // means most frames: a carousel argues where a single asserts.
        const usable = (["video", "carousel", "single"] as ConceptFormat[]).filter((f) => {
          const e = concept.expressions[f];
          if (!e) return false;
          return !("availability" in e && e.availability === "blocked");
        });
        const chosenFormat = format ?? usable[0];
        if (!chosenFormat) {
          const blocked = (["carousel", "video"] as const)
            .map((f) => concept.expressions[f])
            .filter((e) => e && e.availability === "blocked")
            .map((e) => e!.availabilityNote ?? "no reason recorded");
          return {
            ok: false,
            conceptId,
            requested: n,
            produced: 0,
            shortfall: n,
            plans: [],
            rejected: [],
            note:
              `"${conceptId}" has no format this store can produce right now.` +
              (blocked.length ? ` Blocked: ${blocked.join("; ")}` : ""),
          };
        }
        const expression = concept.expressions[chosenFormat];
        if (!expression) {
          return {
            ok: false,
            conceptId,
            format: chosenFormat,
            requested: n,
            produced: 0,
            shortfall: n,
            plans: [],
            rejected: [],
            note: `"${conceptId}" has no ${chosenFormat} expression. Available: ${usable.join(", ") || "none"}.`,
          };
        }
        if ("availability" in expression && expression.availability === "blocked") {
          return {
            ok: false,
            conceptId,
            format: chosenFormat,
            requested: n,
            produced: 0,
            shortfall: n,
            plans: [],
            rejected: [],
            note: `The ${chosenFormat} expression of "${conceptId}" is blocked: ${expression.availabilityNote ?? "no reason recorded"}`,
          };
        }

        const needById = new Map(concept.needs.map((x) => [x.id, x]));
        const fits: SubjectFit[] = candidates.map((c) => ({
          subjectId: c.subjectId,
          assessments: c.assessments.flatMap((a) => {
            const need = needById.get(a.needId);
            // An assessment naming a need the concept does not have is dropped
            // rather than counted: it cannot satisfy anything, and silently
            // crediting it would let a typo pass as grounding.
            return need ? [{ need, met: a.met, ...(a.evidence ? { evidence: a.evidence } : {}) }] : [];
          }),
        }));
        const selection = selectSubjects(concept, fits, n);
        const labels = new Map(candidates.map((c) => [c.subjectId, c.label]));
        const evidenceBySubject = new Map(
          candidates.map((c) => [
            c.subjectId,
            c.assessments.filter((a) => a.evidence).map((a) => ({ needId: a.needId, evidence: a.evidence! })),
          ]),
        );

        const frames =
          chosenFormat === "single"
            ? [
                {
                  role: "single",
                  ...(concept.expressions.single?.archetypeId
                    ? { archetypeId: concept.expressions.single.archetypeId }
                    : {}),
                  instruction: concept.expressions.single?.direction ?? "",
                },
              ]
            : (expression as SequenceExpression).beats.map((b) => ({
                role: b.role,
                ...(b.archetypeId ? { archetypeId: b.archetypeId } : {}),
                ...(b.seconds !== undefined ? { seconds: b.seconds } : {}),
                instruction: beatInstruction(b, (expression as SequenceExpression).continuity),
              }));

        const plans = selection.chosen.map((v) => ({
          subjectId: v.subjectId,
          ...(labels.get(v.subjectId) ? { label: labels.get(v.subjectId)! } : {}),
          frames,
          copyFormulaRefs: concept.voice?.copyFormulaRefs ?? [],
          ...(concept.voice?.hook ? { hook: concept.voice.hook } : {}),
          thinOn: v.thin.map((t) => t.id),
          grounding: evidenceBySubject.get(v.subjectId) ?? [],
        }));

        return {
          ok: selection.shortfall === 0,
          conceptId,
          format: chosenFormat,
          requested: n,
          produced: plans.length,
          shortfall: selection.shortfall,
          plans,
          rejected: selection.rejected.map((r) => ({
            subjectId: r.subjectId,
            unmet: r.unmet.map((u) => u.id),
          })),
          note: selection.note,
        };
      },
    },
  };
}
