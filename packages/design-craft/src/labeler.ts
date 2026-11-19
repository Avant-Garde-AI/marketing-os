/**
 * Perception labeling (spec 35 §3.1, P1→P3).
 *
 * The labeler reads one captured page and returns the three registers. It is
 * written against a minimal `VisionModel` seam so the same pipeline runs on a
 * frontier VLM today (the P2 teacher) and on our distilled open model later (the
 * P3 student), with only the endpoint changing.
 *
 * Trust boundary: model output is never trusted as-is. Facets are coerced
 * against the admitted vocabulary (HARD), proposals pass the specificity floor
 * later at observe time (OPEN), and anything unparseable fails the record
 * rather than producing a plausible-looking empty label.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { PageType } from "./ontology.js";
import { seedAxesFor } from "./ontology.js";
import { labelRecordSchema, proposalSchema, type LabelRecord } from "./labels.js";
import { softPrior, validateFacets, vocabularyStats, type Vocabulary } from "./vocabulary.js";

// ── Seams ────────────────────────────────────────────────────────────────────

export interface VisionImage {
  mime: "image/png" | "image/jpeg";
  base64: string;
}

export interface VisionModel {
  /** Stable identifier recorded on every label (`model:<id>`). */
  readonly id: string;
  complete(input: { system: string; text: string; images: VisionImage[] }): Promise<string>;
}

/** One screenshot of one page at one viewport. Produced by a capture adapter. */
export interface Capture {
  brand: string;
  category: string;
  pageType: PageType;
  url: string;
  viewport: "desktop" | "mobile";
  capturedAt: string;
  /** Local path to the full-page PNG. Never leaves the machine (spec 35 §4). */
  path: string;
  /** Optional first-screen PNG, shot before scrolling (sharper hero, true sticky chrome). */
  foldPath?: string;
  /** sha256 of the full-page PNG: the record's provenance key. */
  sha256: string;
}

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

// ── Prompt ───────────────────────────────────────────────────────────────────

export const LABELER_SYSTEM = [
  "You are a senior DTC e-commerce designer cataloguing the craft decisions on a storefront page.",
  "You describe what the page DOES as named, reusable design treatments, never as adjectives.",
  "",
  "Return STRICT JSON only, no prose, matching:",
  '{"facets": {"<axis>": "<value>" | null}, "proposals": [{"axis": "<dimension>", "value": "<treatment>", "gloss": "<one sentence>"}], "notes": "<optional>"}',
  "",
  "RULES FOR PROPOSALS:",
  "- `axis` names the DIMENSION (e.g. \"pdp gallery behavior\"), not the treatment.",
  "- `value` is a compound kebab-case treatment name of 2–6 words (e.g. \"sticky-thumb-rail\", \"subscribe-save-toggle-default-on\").",
  "- `gloss` says what distinguishes this treatment from its siblings on the same axis.",
  "- BAD values: \"clean\", \"modern\", \"minimal\", \"premium\", \"bold-colors\". They describe nothing reusable.",
  "- Describe what is visibly on the page. Do not infer from brand reputation. Never name the brand in a value.",
].join("\n");

export function buildLabelPrompt(v: Vocabulary, capture: Pick<Capture, "pageType" | "viewport" | "url" | "category">): string {
  return [
    `PAGE: ${capture.pageType} page, ${capture.viewport} viewport, category "${capture.category}".`,
    "",
    softPrior(v, { seedAxes: seedAxesFor(capture.pageType) }),
    "",
    "IMAGES: if two are attached, the first is the first screen exactly as a shopper lands on it, and the second is the",
    "full scrolled page (sticky elements may appear stitched mid-page in it; trust the first image for chrome and hero).",
    "",
    "Label the page now. JSON only.",
  ].join("\n");
}

// ── Response parsing ─────────────────────────────────────────────────────────

const rawLabelSchema = z.object({
  facets: z.record(z.string(), z.unknown()).nullish(),
  proposals: z.array(z.unknown()).nullish(),
  notes: z.unknown().optional(),
});

export class LabelParseError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = "LabelParseError";
  }
}

/**
 * Pull the first JSON object out of a model reply. Models wrap JSON in code
 * fences or a sentence often enough that a strict JSON.parse alone would fail
 * good labels; anything beyond that is a parse error, not a guess.
 */
export function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1]! : raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new LabelParseError("no JSON object in labeler response", raw);
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    throw new LabelParseError(`invalid JSON in labeler response: ${(e as Error).message}`, raw);
  }
}

export interface ParsedLabel {
  facets: Record<string, string | null>;
  rejectedFacets: { axis: string; value: string }[];
  proposals: z.infer<typeof proposalSchema>[];
  /** Proposals dropped for being malformed (missing axis/value). */
  malformedProposals: number;
  notes?: string;
}

export function parseLabelResponse(raw: string, v: Vocabulary): ParsedLabel {
  const parsed = rawLabelSchema.safeParse(extractJsonObject(raw));
  if (!parsed.success) throw new LabelParseError(`labeler JSON has the wrong shape: ${parsed.error.message}`, raw);

  const { values, rejected } = validateFacets(parsed.data.facets ?? {}, v);
  const proposals: ParsedLabel["proposals"] = [];
  let malformed = 0;
  for (const p of parsed.data.proposals ?? []) {
    const ok = proposalSchema.safeParse(p);
    if (ok.success) proposals.push(ok.data);
    else malformed++;
  }
  const notes = typeof parsed.data.notes === "string" && parsed.data.notes.trim() ? parsed.data.notes.trim() : undefined;
  return { facets: values, rejectedFacets: rejected, proposals, malformedProposals: malformed, ...(notes ? { notes } : {}) };
}

// ── Labeling ─────────────────────────────────────────────────────────────────

export function vocabularyRef(v: Vocabulary): string {
  const s = vocabularyStats(v);
  return `axes:${s.admittedAxes}/values:${s.admittedValues}/brands:${s.brands}`;
}

export async function labelCapture(
  capture: Capture,
  deps: { model: VisionModel; vocabulary: Vocabulary; readImage?: (path: string) => Promise<Buffer> },
): Promise<LabelRecord> {
  const readImage = deps.readImage ?? ((p: string) => readFile(p));
  const paths = capture.foldPath ? [capture.foldPath, capture.path] : [capture.path];
  const images: VisionImage[] = [];
  for (const p of paths) images.push({ mime: "image/png", base64: (await readImage(p)).toString("base64") });
  const raw = await deps.model.complete({
    system: LABELER_SYSTEM,
    text: buildLabelPrompt(deps.vocabulary, capture),
    images,
  });
  const label = parseLabelResponse(raw, deps.vocabulary);
  return labelRecordSchema.parse({
    brand: capture.brand,
    category: capture.category,
    pageType: capture.pageType,
    url: capture.url,
    viewport: capture.viewport,
    capturedAt: capture.capturedAt,
    captureSha256: capture.sha256,
    facets: label.facets,
    rejectedFacets: label.rejectedFacets,
    proposals: label.proposals,
    notes: label.notes,
    labeler: { id: `model:${deps.model.id}`, vocabularyRef: vocabularyRef(deps.vocabulary) },
    confirmed: false,
  });
}
