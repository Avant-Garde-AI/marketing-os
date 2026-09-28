/** Pure, read-only monthly production planning from tenant-owned recipes and evidence. */
import { z } from "zod";

const nonempty = z.string().trim().min(1);
const slug = nonempty.max(100).regex(/^[a-z0-9][a-z0-9-]*$/);
export const productionRecipeSchema = z.object({
  id: slug,
  mechanic: z.enum(["artwork-loop", "collection-scene"]),
  scene: z.enum(["real-home", "imagined-world"]).optional(),
  weight: z.number().finite().positive(),
  conceptId: nonempty.max(200),
  requiredDistinctSubjects: z.number().int().min(1).max(20),
  outputKind: nonempty.max(100),
}).strict();
export const productionSubjectSchema = z.object({
  handle: slug,
  artist: nonempty.max(200),
  asset: z.object({ kind: z.enum(["full-master", "frame"]), ref: nonempty.max(1000), verificationRef: nonempty.max(1000).optional() }).strict().optional(),
  sourceRefs: z.array(nonempty.max(1000)).min(1).max(20),
  facts: z.array(z.object({ text: nonempty.max(500), sourceRefs: z.array(nonempty.max(1000)).min(1).max(20) }).strict()).max(30).optional(),
  /** Opaque evidence-derived keys used only to form collection cohorts. */
  groupingKeys: z.array(nonempty.max(400)).max(200).optional(),
}).strict();
export const productionMonthInputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  count: z.number().int().min(1).max(31),
  channel: slug,
  recipes: z.array(productionRecipeSchema).min(1).max(32),
  subjects: z.array(productionSubjectSchema).max(500),
  existingSlots: z.array(z.object({ date: z.string(), recipeId: slug.optional() }).strict()).max(31).optional(),
}).strict();

export interface ProductionRecipe {
  id: string;
  mechanic: "artwork-loop" | "collection-scene";
  scene?: "real-home" | "imagined-world";
  weight: number;
  conceptId: string;
  requiredDistinctSubjects: number;
  outputKind: string;
}

export interface ProductionSubject {
  handle: string;
  artist: string;
  /** Only an explicitly verified full master can be used for production. */
  asset?: { kind: "full-master" | "frame"; ref: string; verificationRef?: string };
  sourceRefs: string[];
  facts?: Array<{ text: string; sourceRefs: string[] }>;
  /** Shared keys supplied by the caller from acquired evidence, never copy claims. */
  groupingKeys?: string[];
}

export interface ExistingProductionSlot {
  date: string;
  recipeId?: string;
}

export interface ProductionBrief {
  recipe: ProductionRecipe;
  conceptId: string;
  mechanic: ProductionRecipe["mechanic"];
  scene?: ProductionRecipe["scene"];
  outputKind: string;
  direction: string;
  subjects: Array<{
    handle: string;
    artist: string;
    masterRef?: string;
    masterVerificationRef?: string;
    sourceRefs: string[];
  }>;
  /** These are the only factual inputs for copy. They are not finished claims. */
  copyFacts: Array<{ handle: string; text: string; sourceRefs: string[] }>;
  copyGuidance: string;
}

export interface ProductionSlot {
  id: string;
  date: string;
  channel: string;
  recipeId: string;
  status: "planned" | "blocked";
  subjectHandles: string[];
  brief?: ProductionBrief;
  blockedReasons: string[];
  reuseWarnings: string[];
}

export interface ProductionMonthPlan {
  month: string;
  channel: string;
  slots: ProductionSlot[];
  summary: { planned: number; blocked: number; recipeCounts: Record<string, number> };
}

export interface ProductionMonthInput {
  month: string;
  count: number;
  channel: string;
  recipes: ProductionRecipe[];
  subjects: ProductionSubject[];
  existingSlots?: ExistingProductionSlot[];
}

const token = (value: string, label: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty`);
  return value.trim();
};

function monthDays(month: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("month must be YYYY-MM");
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5));
  if (year < 1 || year > 9999) throw new Error("month year must be 0001 through 9999");
  const date = new Date(0);
  date.setUTCFullYear(year, index, 0);
  return date.getUTCDate();
}

function datesFor(month: string, days: number, count: number, existing: ExistingProductionSlot[]): string[] {
  const dates = existing.map((slot) => slot.date);
  const used = new Set(dates);
  const free = Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter((d) => !used.has(d));
  const needed = count - dates.length;
  for (let i = 0; i < needed; i++) {
    dates.push(free[Math.floor(((i + 0.5) * free.length) / needed)]!);
  }
  return dates.sort();
}

function rotate(recipes: ProductionRecipe[], dates: string[], existing: Map<string, ExistingProductionSlot>): ProductionRecipe[] {
  const total = recipes.reduce((sum, recipe) => sum + recipe.weight, 0);
  const desired = recipes.map(() => 0);
  for (let n = 0; n < dates.length; n++) {
    let best = 0;
    let deficit = -Infinity;
    for (let i = 0; i < recipes.length; i++) {
      const next = (recipes[i]!.weight * (n + 1)) / total - desired[i]!;
      if (next > deficit + 1e-10) { best = i; deficit = next; }
    }
    desired[best]!++;
  }
  const anchorCounts = recipes.map((recipe) => dates.filter((date) => existing.get(date)?.recipeId === recipe.id).length);
  const freeCount = dates.length - anchorCounts.reduce((sum, count) => sum + count, 0);
  const targets = desired.map((count, i) => Math.max(0, count - anchorCounts[i]!));
  while (targets.reduce((sum, count) => sum + count, 0) < freeCount) {
    let best = 0;
    let deficit = -Infinity;
    for (let i = 0; i < recipes.length; i++) {
      const next = (recipes[i]!.weight * dates.length) / total - anchorCounts[i]! - targets[i]!;
      if (next > deficit + 1e-10) { best = i; deficit = next; }
    }
    targets[best]!++;
  }
  const assigned = recipes.map(() => 0);
  const rotation: ProductionRecipe[] = [];
  for (const date of dates) {
    const anchor = existing.get(date)?.recipeId;
    if (anchor) { rotation.push(recipes.find((recipe) => recipe.id === anchor)!); continue; }
    const n = assigned.reduce((sum, count) => sum + count, 0);
    let best = 0;
    let deficit = -Infinity;
    for (let i = 0; i < recipes.length; i++) {
      if (assigned[i]! >= targets[i]!) continue;
      const next = (targets[i]! * (n + 1)) / freeCount - assigned[i]!;
      if (next > deficit + 1e-10) { best = i; deficit = next; }
    }
    assigned[best]!++;
    rotation.push(recipes[best]!);
  }
  return rotation;
}

/** Choose a source-compatible group before subject rotation can mix unrelated works. */
function collectionCohort(
  masters: ProductionSubject[],
  count: number,
  useCount: Map<string, number>,
): ProductionSubject[] | null {
  const byKey = new Map<string, ProductionSubject[]>();
  for (const subject of masters) {
    for (const key of new Set(subject.groupingKeys ?? [])) {
      const group = byKey.get(key) ?? [];
      group.push(subject);
      byKey.set(key, group);
    }
  }
  let best: { subjects: ProductionSubject[]; reuse: number; key: string } | null = null;
  for (const key of [...byKey.keys()].sort()) {
    const group = byKey.get(key)!;
    if (group.length < count) continue;
    const selected = [...group].sort((a, b) =>
      (useCount.get(a.handle) ?? 0) - (useCount.get(b.handle) ?? 0) ||
      (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0),
    ).slice(0, count);
    const reuse = selected.reduce((sum, subject) => sum + (useCount.get(subject.handle) ?? 0), 0);
    if (!best || reuse < best.reuse || (reuse === best.reuse && key < best.key))
      best = { subjects: selected, reuse, key };
  }
  return best?.subjects ?? null;
}

function validate(input: ProductionMonthInput): number {
  const days = monthDays(input.month);
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 31 || input.count > days)
    throw new Error("count must be a positive integer no greater than the days in month (maximum 31)");
  token(input.channel, "channel");
  if (!input.recipes.length) throw new Error("at least one recipe is required");
  const recipeIds = new Set<string>();
  for (const recipe of input.recipes) {
    token(recipe.id, "recipe id");
    if (recipeIds.has(recipe.id)) throw new Error(`duplicate recipe id: ${recipe.id}`);
    recipeIds.add(recipe.id);
    if (recipe.mechanic !== "artwork-loop" && recipe.mechanic !== "collection-scene") throw new Error(`invalid mechanic: ${recipe.id}`);
    if (recipe.mechanic === "collection-scene" && recipe.scene !== "real-home" && recipe.scene !== "imagined-world")
      throw new Error(`collection scene is required: ${recipe.id}`);
    if (recipe.mechanic === "artwork-loop" && recipe.scene !== undefined) throw new Error(`artwork loop cannot set scene: ${recipe.id}`);
    if (!Number.isFinite(recipe.weight) || recipe.weight <= 0) throw new Error(`weight must be finite and positive: ${recipe.id}`);
    if (!Number.isInteger(recipe.requiredDistinctSubjects) || recipe.requiredDistinctSubjects < 1)
      throw new Error(`requiredDistinctSubjects must be a positive integer: ${recipe.id}`);
    token(recipe.conceptId, "conceptId");
    token(recipe.outputKind, "outputKind");
  }
  const handles = new Set<string>();
  for (const subject of input.subjects) {
    token(subject.handle, "subject handle");
    if (handles.has(subject.handle)) throw new Error(`duplicate subject handle: ${subject.handle}`);
    handles.add(subject.handle);
    token(subject.artist, "subject artist");
    if (!subject.sourceRefs?.length || subject.sourceRefs.some((ref) => !ref.trim())) throw new Error(`subject needs source refs: ${subject.handle}`);
    for (const fact of subject.facts ?? []) {
      token(fact.text, "fact text");
      if (!fact.sourceRefs?.length || fact.sourceRefs.some((ref) => !ref.trim())) throw new Error(`fact needs source refs: ${subject.handle}`);
    }
  }
  const dates = new Set<string>();
  const existing = input.existingSlots ?? [];
  if (existing.length > input.count) throw new Error("existing slots exceed requested count");
  for (const slot of existing) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !slot.date.startsWith(`${input.month}-`) || Number(slot.date.slice(-2)) < 1 || Number(slot.date.slice(-2)) > days)
      throw new Error(`existing slot date is outside month: ${slot.date}`);
    if (dates.has(slot.date)) throw new Error(`duplicate slot date: ${slot.date}`);
    dates.add(slot.date);
    if (slot.recipeId && !recipeIds.has(slot.recipeId)) throw new Error(`unknown recipe id: ${slot.recipeId}`);
  }
  return days;
}

/** Creates a reviewable plan only. Dates are editorial slots, never scheduled publish times. */
export function planProductionMonth(input: ProductionMonthInput): ProductionMonthPlan {
  productionMonthInputSchema.parse(input);
  const days = validate(input);
  const dates = datesFor(input.month, days, input.count, input.existingSlots ?? []);
  const existing = new Map((input.existingSlots ?? []).map((slot) => [slot.date, slot]));
  const rotation = rotate(input.recipes, dates, existing);
  const masterSubjects = input.subjects.filter((subject) => subject.asset?.kind === "full-master" && subject.asset.ref.trim() && subject.asset.verificationRef?.trim());
  const useCount = new Map<string, number>();
  const recipeCounts: Record<string, number> = {};
  const slots = dates.map((date, index): ProductionSlot => {
    const recipe = rotation[index]!;
    recipeCounts[recipe.id] = (recipeCounts[recipe.id] ?? 0) + 1;
    const eligible = [...input.subjects].sort((a, b) => {
      const aMaster = masterSubjects.includes(a) ? 0 : 1;
      const bMaster = masterSubjects.includes(b) ? 0 : 1;
      return aMaster - bMaster || (useCount.get(a.handle) ?? 0) - (useCount.get(b.handle) ?? 0) || a.handle.localeCompare(b.handle);
    });
    const cohort = recipe.mechanic === "collection-scene"
      ? collectionCohort(masterSubjects, recipe.requiredDistinctSubjects, useCount)
      : null;
    const selected = cohort ?? eligible.slice(0, recipe.requiredDistinctSubjects);
    const blockedReasons: string[] = [];
    if (selected.length < recipe.requiredDistinctSubjects)
      blockedReasons.push(`Requires ${recipe.requiredDistinctSubjects} distinct subjects; ${selected.length} supplied.`);
    const missingMasters = selected.filter((subject) => !masterSubjects.includes(subject));
    if (missingMasters.length)
      blockedReasons.push(`Verified full-master evidence is missing for: ${missingMasters.map((subject) => subject.handle).join(", ")}.`);
    if (recipe.mechanic === "collection-scene" && !cohort)
      blockedReasons.push(`No shared evidence grouping key connects ${recipe.requiredDistinctSubjects} distinct verified full-master subjects; curate a coherent set.`);
    const subjectHandles = selected.map((subject) => subject.handle);
    const reuseWarnings = selected.filter((subject) => (useCount.get(subject.handle) ?? 0) > 0)
      .map((subject) => `${subject.handle} is reused in this month; review repetition before production.`);
    for (const subject of selected) useCount.set(subject.handle, (useCount.get(subject.handle) ?? 0) + 1);
    const id = `${input.month}-${encodeURIComponent(input.channel)}-${date.slice(-2)}`;
    const direction = recipe.mechanic === "artwork-loop"
      ? "Use the verified full master to build a repeatable, seamless artwork video loop. Keep the artwork accurate and review every crop and motion treatment."
      : `Compose ${recipe.requiredDistinctSubjects} distinct artworks in a ${recipe.scene === "real-home" ? "real-home lifestyle setting" : "clearly imagined world"}. Preserve each artwork's identity; treat the setting as a creative proposal.`;
    const brief: ProductionBrief = {
      recipe: { ...recipe },
      conceptId: recipe.conceptId, mechanic: recipe.mechanic, ...(recipe.scene ? { scene: recipe.scene } : {}),
      outputKind: recipe.outputKind, direction,
      subjects: selected.map((subject) => ({ handle: subject.handle, artist: subject.artist,
        ...(subject.asset?.kind === "full-master" && subject.asset.verificationRef ? { masterRef: subject.asset.ref, masterVerificationRef: subject.asset.verificationRef } : {}),
        sourceRefs: [...subject.sourceRefs] })),
      copyFacts: selected.flatMap((subject) => (subject.facts ?? []).map((fact) => ({ handle: subject.handle, text: fact.text, sourceRefs: [...fact.sourceRefs] }))),
      copyGuidance: "Draft copy only from the listed source-bound facts. Attribute artists using subject receipts. Do not infer titles, provenance, dimensions, availability, offers, or scene reality. If facts do not support a claim, leave it out or request evidence.",
    };
    return { id, date, channel: input.channel, recipeId: recipe.id, status: blockedReasons.length ? "blocked" : "planned", subjectHandles, brief, blockedReasons, reuseWarnings };
  });
  return { month: input.month, channel: input.channel, slots,
    summary: { planned: slots.filter((slot) => slot.status === "planned").length, blocked: slots.filter((slot) => slot.status === "blocked").length, recipeCounts } };
}
