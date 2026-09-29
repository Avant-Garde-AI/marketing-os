/**
 * The offer design harness's pure half (spec 34 §3): brief → prompts, model
 * answers → validated concepts and critic verdicts, render diagnostics →
 * the mechanical critic, and the budget arithmetic. No I/O here — the host's
 * job (the hosted app's offer-harness.server.ts) owns the network, the model
 * client, the sandbox and the database — so every decision the harness makes
 * about a concept is unit-testable. Prompts and output schemas are plain
 * strings/objects; no credential or client ever enters this module.
 */

import { parse as parseYaml } from "yaml";
import {
  ARCHETYPES,
  OfferConceptSchema,
  checkConceptDiversity,
  gateOfferManifestV2,
  type ArchetypeId,
  type CriticId,
  type CriticVerdict,
  type DiagReport,
  type IncumbentVendor,
  type OfferConcept,
  type OfferManifestV2,
  type Placement,
  type StyleTokens,
} from "./adapter";

// ---------------------------------------------------------------------------
// Budget (CONTRACT: max 5 concepts, 3 repairs each, ~60 renders per run)
// ---------------------------------------------------------------------------

export const HARNESS_BUDGET = {
  concepts: 5,
  repairIterations: 3,
  renders: 100,
  freeRunsPer30Days: 1,
  auditFreshDays: 14,
} as const;

export const DRAFT_ID_RE = /__c\d+$/;
export const isHarnessDraft = (id: string) => DRAFT_ID_RE.test(id);

/** Free-tier quota: 1 run per 30 days. `runs` are the creation times of the
 * tenant's non-failed harness runs. */
export function freeQuota(runs: Date[], now = new Date()): { allowed: boolean; retryAfter: string | null } {
  const windowMs = 30 * 24 * 3600 * 1000;
  const recent = runs.filter((d) => now.getTime() - d.getTime() < windowMs).sort((a, b) => a.getTime() - b.getTime());
  if (recent.length < HARNESS_BUDGET.freeRunsPer30Days) return { allowed: true, retryAfter: null };
  return { allowed: false, retryAfter: new Date(recent[0]!.getTime() + windowMs).toISOString() };
}

// ---------------------------------------------------------------------------
// Brand inputs
// ---------------------------------------------------------------------------

export const NEUTRAL_STYLE: StyleTokens = {
  bg: "#ffffff",
  ink: "#1a1a1a",
  ink2: "rgba(26,26,26,.72)",
  accent: "#8d6c42",
  line: "rgba(26,26,26,.16)",
  font: "inherit",
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * DESIGN.md front matter → the manifest's style tokens. Style never comes
 * from the model (CONTRACT §8): the concept authors copy and structure, the
 * store's own design document supplies color and type. `{colors.x}`
 * references resolve; anything unreadable falls back to neutral.
 */
/** Replace the token faces with the storefront's measured ones, keeping each
 * stack's generic fallback. A missing measurement keeps the token face. */
export function withStorefrontFonts(
  style: StyleTokens,
  fonts: { body: string | null; display: string | null; mono: string | null },
): StyleTokens {
  const usable = (f: string | null) => (f && !/^(serif|sans-serif|monospace|system-ui|-apple-system)$/i.test(f.trim()) ? f : null);
  const body = usable(fonts.body);
  const display = usable(fonts.display);
  const mono = usable(fonts.mono);
  return {
    ...style,
    ...(body ? { font: body } : {}),
    ...(display ? { fontDisplay: display } : {}),
    ...(mono ? { fontMono: mono } : {}),
  };
}

export function designStyleTokens(designMd: string | null | undefined): { style: StyleTokens; source: "DESIGN.md" | "neutral" } {
  const m = designMd?.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { style: NEUTRAL_STYLE, source: "neutral" };
  let fm: Record<string, unknown>;
  try {
    fm = (parseYaml(m[1]!) ?? {}) as Record<string, unknown>;
  } catch {
    return { style: NEUTRAL_STYLE, source: "neutral" };
  }
  const colors = (fm.colors ?? {}) as Record<string, unknown>;
  const resolve = (v: unknown, depth = 0): string | null => {
    if (typeof v !== "string" || depth > 4) return null;
    const ref = v.match(/^\{colors\.([\w-]+)\}$/);
    if (ref) return resolve(colors[ref[1]!], depth + 1);
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) || /^rgba?\(/i.test(v.trim()) ? v.trim() : null;
  };
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const r = resolve(colors[k]);
      if (r) return r;
    }
    return null;
  };
  const typo = (fm.typography ?? {}) as Record<string, { fontFamily?: unknown }>;
  const fam = (...keys: string[]) => {
    for (const k of keys) {
      const f = typo[k]?.fontFamily;
      if (typeof f === "string" && f.trim()) return f.trim();
    }
    return null;
  };
  const monoKey = Object.keys(typo).find((k) => /mono/i.test(String(typo[k]?.fontFamily ?? "")));

  const bg = pick("background", "surface", "canvas", "bg");
  const ink = pick("text", "ink", "foreground", "on-background");
  if (!bg || !ink) return { style: NEUTRAL_STYLE, source: "neutral" };
  const rgb = hexToRgb(ink);
  const style: StyleTokens = {
    bg,
    ink,
    ink2: pick("text-secondary", "ink2", "muted", "text-muted") ?? (rgb ? `rgba(${rgb.join(",")},.72)` : NEUTRAL_STYLE.ink2),
    accent: pick("primary", "accent", "brand") ?? NEUTRAL_STYLE.accent,
    line: pick("line", "border", "divider") ?? (rgb ? `rgba(${rgb.join(",")},.16)` : NEUTRAL_STYLE.line),
    font: fam("body", "text", "paragraph") ?? "inherit",
  };
  const display = fam("display", "headline", "heading", "h1");
  if (display) style.fontDisplay = display;
  if (monoKey) style.fontMono = String(typo[monoKey]!.fontFamily);
  return { style, source: "DESIGN.md" };
}

/** The parts of brand.md a design director needs, within a character budget. */
export function brandExcerpt(brandMd: string | null | undefined, maxChars = 7000): string {
  if (!brandMd) return "";
  const body = brandMd.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const sections = body.split(/^(?=## )/m);
  const wanted = /essence|north star|position|promise|audience|persona|voice|tone|messag|do'?s|don'?ts|governance|principle/i;
  const picked = sections.filter((s) => wanted.test(s.split("\n")[0] ?? ""));
  const text = (picked.length ? picked.join("\n") : body).trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated)` : text;
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

export interface HarnessLifestyle {
  title: string;
  imageSrc: string;
  imageAlt: string;
}

/** Every image a concept may use: product images (picks) + lifestyle shots. */
export function allowedImagesFor(brief: Pick<HarnessBrief, "products" | "lifestyle">): Set<string> {
  return new Set([...brief.products.map((p) => p.imageSrc), ...(brief.lifestyle ?? []).map((l) => l.imageSrc)]);
}

export interface HarnessProduct {
  title: string;
  url: string;
  imageSrc: string;
  imageAlt: string;
  productType?: string;
  /** Shopify vendor — on a marketplace, the artist. */
  vendor?: string;
  price?: string;
}

export interface HarnessAuditSummary {
  id: string;
  vendor: IncumbentVendor | null;
  grade: string;
  summary: string;
  problems: string[];
  appeared: boolean;
  incentiveText: string | null;
}

export interface PastOffer {
  id: string;
  title: string;
  hypothesis: string;
  archetypes: string[];
  placement: string;
  status: string;
  result: string | null;
}

export interface RemixRequest {
  /** Each arm of the new test, in order (v1, v2): an existing offer's variant to remix. */
  arms: { offerId: string; arm: string; note?: string; imageSrc?: string }[];
  /** Holdback share, 0.1–0.5. */
  controlWeight?: number;
  /** Offers to retire when the new test is approved. */
  retire?: string[];
}

export interface HarnessConstraints {
  placement?: Placement;
  incentiveTypes?: OfferConcept["incentive"]["type"][];
  margin?: { grossMarginPct: number; floorPct: number };
}

export interface HarnessBrief {
  shop: string;
  storeName: string;
  storefrontUrl: string;
  goal: string;
  constraints: HarnessConstraints;
  brand: string;
  design: string;
  style: StyleTokens;
  styleSource: string;
  products: HarnessProduct[];
  /** Lifestyle room shots (collection heroes) — the takeover's lead image. */
  lifestyle?: HarnessLifestyle[];
  audit: HarnessAuditSummary | null;
  pastOffers: PastOffer[];
}

export function percentCap(c: HarnessConstraints): number {
  return c.margin ? Math.max(0, c.margin.grossMarginPct - c.margin.floorPct) : 20;
}

// ---------------------------------------------------------------------------
// Concept authoring — output schema + prompts
// ---------------------------------------------------------------------------

const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

// The model-facing ("wire") concept shape is deliberately compact. The API
// compiles output schemas to a grammar and refuses big ones: a 12-way anyOf
// over block kinds is "too large", and a flat block with every field optional
// exceeds the 24-optional-parameter limit. So one flat block reuses `text`
// (headline/body/eyebrow/consent/decline text, the email or cta button label,
// the reward headline) and `accent` (headline second beat, reward body), and
// wireToConcept maps it onto the pack's block union. Per-kind shape is then
// enforced by OfferConceptSchema, never by trusting the wire.
const BLOCK_KINDS = ["eyebrow", "headline", "body", "points", "image", "choice", "email", "consent", "progress", "cta", "reward", "decline"];
const BLOCK_SCHEMA = obj(
  {
    kind: { type: "string", enum: BLOCK_KINDS },
    text: str,
    accent: str,
    items: { type: "array", items: str },
    src: str,
    alt: str,
    question: str,
    answerKey: str,
    options: { type: "array", items: obj({ value: str, label: str }, ["value", "label"]) },
    placeholder: str,
    mode: { type: "string", enum: ["message", "code", "picks"] },
    picks: { type: "array", items: obj({ answer: str, title: str, url: str, imageSrc: str }, ["answer", "title", "url"]) },
    link: obj({ label: str, href: str }, ["label", "href"]),
  },
  ["kind"],
);

const CONCEPT_SCHEMA = obj(
  {
    archetype: { type: "string", enum: Object.keys(ARCHETYPES) },
    title: str,
    hypothesis: str,
    personaRef: str,
    composition: { type: "string", enum: ["split-image", "full-bleed-image", "editorial-type", "card"] },
    steps: {
      type: "array",
      items: obj({ id: str, kind: { type: "string", enum: ["hook", "ask", "reward"] }, blocks: { type: "array", items: BLOCK_SCHEMA } }, [
        "id",
        "kind",
        "blocks",
      ]),
    },
    incentive: obj(
      {
        type: { type: "string", enum: ["none", "content", "early-access", "free-shipping", "percent"] },
        value: { type: "number" },
        codeMode: { type: "string", enum: ["unique", "shared"] },
      },
      ["type"],
    ),
    trigger: obj({ kind: { type: "string", enum: ["delay", "exit-intent"] }, seconds: { type: "number" } }, ["kind"]),
    imageSrc: str,
  },
  ["archetype", "title", "hypothesis", "composition", "steps", "incentive"],
);

export const CONCEPTS_OUTPUT_SCHEMA = obj({ concepts: { type: "array", items: CONCEPT_SCHEMA } }, ["concepts"]);
export const CONCEPT_OUTPUT_SCHEMA = obj({ concept: CONCEPT_SCHEMA, changes: str }, ["concept", "changes"]);

/** How the wire fields map, for the system prompt. */
export const WIRE_FIELD_GUIDE = `JSON field usage per block kind:
- eyebrow, body, consent, decline: {kind, text}
- headline: {kind, text, accent?}  (accent = the italic second beat)
- points: {kind, items: [1–3 strings]}
- image: {kind, src, alt}
- choice: {kind, question, answerKey, options: [{value, label}]}
- email: {kind, text: button label, placeholder?}
- cta: {kind, text: button label}
- progress: {kind}
- reward: {kind, mode, text: reward headline, accent?: reward body, picks?: [{answer: option value, title, url, imageSrc?}], link?: {label, href}}`;

type Wire = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const def = <T extends Record<string, unknown>>(o: T): T => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

function wireBlock(b: Wire): Wire {
  const text = s(b.text);
  switch (b.kind) {
    case "headline":
      return def({ kind: "headline", text, accent: s(b.accent) });
    case "points":
      return { kind: "points", items: Array.isArray(b.items) ? b.items : [] };
    case "image":
      return def({ kind: "image", src: s(b.src), alt: s(b.alt) ?? "" });
    case "choice":
      return def({ kind: "choice", question: s(b.question), answerKey: s(b.answerKey), options: b.options });
    case "email":
      return def({ kind: "email", cta: s(b.cta) ?? text, placeholder: s(b.placeholder) });
    case "cta":
      return def({ kind: "cta", label: s(b.label) ?? text });
    case "progress":
      return { kind: "progress" };
    case "reward": {
      let picks: Record<string, { title: string; url: string; imageSrc?: string }[]> | undefined;
      if (Array.isArray(b.picks) && b.picks.length) {
        picks = {};
        for (const p of b.picks as { answer: string; title: string; url: string; imageSrc?: string }[]) {
          (picks[p.answer] ??= []).push(def({ title: clampWords(String(p.title ?? ""), 80), url: p.url, imageSrc: s(p.imageSrc) }));
        }
      } else if (b.picks && typeof b.picks === "object" && !Array.isArray(b.picks)) {
        picks = Object.fromEntries(
          Object.entries(b.picks as Record<string, { title: string; url: string; imageSrc?: string }[]>).map(([k, list]) => [
            k,
            (Array.isArray(list) ? list : []).map((p) => ({ ...p, title: clampWords(String(p.title ?? ""), 80) })),
          ]),
        );
      }
      const link = b.link && s((b.link as Wire).href) ? (b.link as { label: string; href: string }) : undefined;
      return def({ kind: "reward", mode: b.mode ?? "message", headline: s(b.headline) ?? text, body: s(b.body) ?? s(b.accent), picks, link });
    }
    default:
      return def({ kind: b.kind, text });
  }
}

/** Wire concept → pack OfferConcept shape (still unvalidated). */
export function clampWords(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.—-]+$/, "")}…`;
}

export function wireToConcept(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const c = structuredClone(raw) as Wire;
  for (const k of ["personaRef", "imageSrc"]) if (!s(c[k])) delete c[k];
  // Free-text fields the model tends to overrun on repair: trim at a word
  // boundary rather than throw away an otherwise-fixed concept.
  for (const [k, max] of [["title", 80], ["hypothesis", 400], ["personaRef", 160]] as const) {
    if (typeof c[k] === "string") c[k] = clampWords(c[k] as string, max);
  }
  if (c.incentive && typeof c.incentive === "object") {
    const inc = c.incentive as Wire;
    c.incentive = def({ type: inc.type, value: typeof inc.value === "number" && inc.value > 0 ? inc.value : undefined, codeMode: s(inc.codeMode) });
  }
  if (c.trigger && typeof c.trigger === "object") {
    const t = c.trigger as Wire;
    c.trigger = t.kind === "delay" ? { kind: "delay", seconds: typeof t.seconds === "number" ? t.seconds : 8 } : { kind: t.kind };
  }
  c.steps = ((c.steps as Wire[] | undefined) ?? []).map((st) => ({
    ...st,
    blocks: ((st.blocks as Wire[] | undefined) ?? []).map(wireBlock),
  }));
  return c;
}

/** Pack concept → wire shape, for showing a concept back to the model. */
export function conceptToWire(c: OfferConcept): Wire {
  return {
    ...c,
    steps: c.steps.map((st) => ({
      ...st,
      blocks: st.blocks.map((b) => {
        switch (b.kind) {
          case "email":
            return def({ kind: "email", text: b.cta, placeholder: b.placeholder });
          case "cta":
            return { kind: "cta", text: b.label };
          case "reward":
            return def({
              kind: "reward",
              mode: b.mode,
              text: b.headline,
              accent: b.body,
              picks: b.picks
                ? Object.entries(b.picks).flatMap(([answer, list]) => list.map((p) => ({ answer, ...p })))
                : undefined,
              link: b.link,
            });
          default:
            return b;
        }
      }),
    })),
  };
}

export interface ConceptParse {
  concepts: OfferConcept[];
  rejected: { index: number; title: string; errors: string[] }[];
}

/**
 * Validate the model's concepts against the pack schema plus the run's own
 * constraints (incentive types allowed, percent cap, image allow-list — the
 * model may only use image URLs the brief gave it).
 */
/**
 * Product picks are catalog facts, not copy. The model chooses WHICH products
 * suit each answer; their titles, artist, image and link are rewritten from
 * the catalog so a caption can never describe a different artwork than the
 * one shown (the first live run's brand critic caught exactly that). Picks
 * that match no catalog product are dropped; a picks reward left empty
 * becomes a message reward.
 */
export function groundPicks(c: OfferConcept, products: HarnessProduct[]): OfferConcept {
  if (!products.length) return c;
  const byUrl = new Map(products.map((p) => [p.url.replace(/\/$/, ""), p]));
  const byTitle = new Map(products.map((p) => [p.title.trim().toLowerCase(), p]));
  const find = (pick: { title: string; url: string }) =>
    byUrl.get(pick.url.replace(/[?#].*$/, "").replace(/\/$/, "")) ?? byTitle.get(pick.title.split(" — ")[0]!.trim().toLowerCase());
  return {
    ...c,
    steps: c.steps.map((s) => ({
      ...s,
      blocks: s.blocks.map((b) => {
        if (b.kind !== "reward" || !b.picks) return b;
        const picks: NonNullable<typeof b.picks> = {};
        for (const [answer, list] of Object.entries(b.picks)) {
          const grounded = list
            .map((pick) => {
              const p = find(pick);
              return p ? { title: clampWords(p.vendor ? `${p.title} — ${p.vendor}` : p.title, 80), url: p.url, imageSrc: p.imageSrc } : null;
            })
            .filter((x): x is NonNullable<typeof x> => !!x);
          if (grounded.length) picks[answer] = grounded;
        }
        if (!Object.keys(picks).length) {
          const { picks: _drop, ...rest } = b;
          return { ...rest, mode: b.mode === "picks" ? "message" : b.mode };
        }
        return { ...b, picks };
      }),
    })),
  } as OfferConcept;
}

export function parseConcepts(raw: unknown, brief: Pick<HarnessBrief, "constraints" | "products" | "lifestyle">): ConceptParse {
  const list = Array.isArray(raw) ? raw : ((raw as { concepts?: unknown[] } | null)?.concepts ?? []);
  const allowedImages = allowedImagesFor(brief);
  const out: ConceptParse = { concepts: [], rejected: [] };
  list.slice(0, HARNESS_BUDGET.concepts + 1).forEach((item, index) => {
    const parsed = OfferConceptSchema.safeParse(wireToConcept(item));
    const title = String((item as { title?: unknown })?.title ?? `concept ${index + 1}`);
    if (!parsed.success) {
      out.rejected.push({ index, title, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      return;
    }
    const concept = groundPicks(parsed.data, brief.products);
    const errors = conceptConstraintErrors(concept, brief.constraints, allowedImages);
    if (errors.length) out.rejected.push({ index, title, errors });
    else out.concepts.push(concept);
  });
  out.concepts = out.concepts.slice(0, HARNESS_BUDGET.concepts);
  return out;
}

export function conceptConstraintErrors(c: OfferConcept, constraints: HarnessConstraints, allowedImages: Set<string>): string[] {
  const errors: string[] = [];
  if (constraints.incentiveTypes?.length && !constraints.incentiveTypes.includes(c.incentive.type)) {
    errors.push(`incentive "${c.incentive.type}" is not allowed by the merchant's constraints`);
  }
  if (c.incentive.type === "percent" && (c.incentive.value ?? 0) > percentCap(constraints)) {
    errors.push(`${c.incentive.value}% exceeds the ${percentCap(constraints)}% cap`);
  }
  const images = [c.imageSrc, ...c.steps.flatMap((s) => s.blocks.flatMap((b) => (b.kind === "image" ? [b.src] : [])))].filter(
    (x): x is string => !!x,
  );
  if (allowedImages.size) {
    for (const src of images) if (!allowedImages.has(src)) errors.push(`image ${src.slice(0, 80)} is not one of the store's own images from the brief`);
  }
  const emails = c.steps.flatMap((s) => s.blocks.filter((b) => b.kind === "email")).length;
  if (emails !== 1) errors.push(`a concept captures exactly one email (found ${emails})`);
  return errors;
}

export function conceptSystemPrompt(): string {
  const archetypes = Object.entries(ARCHETYPES)
    .map(([id, a]) => `- ${id}: ${a.hook}. Fits: ${a.fits}. ${a.description}`)
    .join("\n");
  return `You are the design director for a brand's email-capture offer — the popup a first-time visitor sees on their storefront. Your concepts replace a popup the merchant already runs, and they will be judged side by side with it on the merchant's own store. The bar is "a designer at this brand would ship it", not "a popup builder template".

You author STRUCTURE and COPY only. A fixed, audited renderer draws your concept; you never write HTML or CSS, and color and type come from the brand's DESIGN.md, not from you.

## What you can build
Steps (1–3), each a list of blocks from this closed catalog:
eyebrow, headline (text + optional italic "accent" second beat), body, points (1–3 short lines), image (src MUST be one of the product image URLs in the brief, verbatim), choice (one question, answerKey in snake_case, 2–4 options, single-select, advances on pick), email (placeholder + cta), consent, progress, cta (advances without a choice), reward (mode message | code | picks; picks keyed by the choice's option values, each pick a real product url from the brief), decline (a quiet dismiss link).
Compositions: split-image (image beside copy), full-bleed-image (image behind copy), editorial-type (type-led, image optional), card (compact).

## Format: a premium full-screen takeover
On desktop the offer takes the WHOLE screen for a moment (the Alia / Pupford format), not a small box; on phones it is a full-height sheet. Design for that scale: split-image or full-bleed-image, or editorial-type when the words are the whole idea. Never card.
The lead image (first step) should be a LIFESTYLE ROOM SHOT from the brief's lifestyle list when there is one — art shown in a real room is what sells a takeover; a flat product image is for picks. Choose the room shot that shows the concept's idea (art above a sofa for a sofa question, a bedroom for a bedroom answer).
Archetypes — pick one per concept:
${archetypes}

${WIRE_FIELD_GUIDE}

## Mechanical rules (the compiler refuses violations)
- Exactly one email block per concept; the SAME step must contain a consent block.
- Multi-step flows: hook → ask → reward. A step with a choice advances on pick; a hook step without a choice needs a cta.
- At most one choice per step.
- Consent copy is plain language: what they'll get, how often, and that they can unsubscribe anytime. Never pre-checked, never buried.
- Decline copy is neutral ("Not now", "Close"). Never confirmshaming ("No thanks, I prefer paying full price" is refused).
- No countdowns, no "only N left", no "hurry", no "ends tonight", no fabricated scarcity or social proof, no spin-to-win or chance mechanics. Do not invent numbers the brief does not give you.
- Incentives: none | content | early-access | free-shipping | percent. Respect the merchant's constraints; percent never above the cap given.
- reward.link.href is a store-relative path starting with "/".

## Craft
- Write in the brand's voice from brand.md — its words, its rhythm. Headline ≤ 8 words; body ≤ 25 words; points ≤ 8 words each.
- Be specific to this catalog: name real rooms, collections, materials, product types from the brief. Generic "Join our newsletter" / "Get 10% off your first order" is a failure.
- Diverse by STRUCTURE, not adjectives: different archetypes, step counts, compositions and incentives across the set. At least 4 distinct archetypes across 5 concepts.
- Beat the incumbent on the rubric it failed (listed in the brief), and do not repeat what the store already tested.
- hypothesis: one sentence — who (persona from brand.md), what change, why it should win, and what would prove it (capture rate, net revenue per visitor).
- personaRef: the brand.md persona the concept is for, by name.
- A zero-party question must be one the persona enjoys answering and whose answer changes what they get next.`;
}

function briefBlock(brief: HarnessBrief): string {
  const products = brief.products
    .map((p) => `- ${p.title}${p.vendor ? ` by ${p.vendor}` : ""}${p.productType ? ` (${p.productType})` : ""}${p.price ? ` — ${p.price}` : ""} · url ${p.url} · image ${p.imageSrc}`)
    .join("\n");
  const lifestyle = (brief.lifestyle ?? []).map((l) => `- ${l.title} · image ${l.imageSrc} · ${l.imageAlt}`).join("\n");

  const audit = brief.audit
    ? brief.audit.appeared
      ? `Current popup: ${brief.audit.vendor ?? "unknown vendor"}, graded ${brief.audit.grade}. ${brief.audit.summary}\nProblems:\n${brief.audit.problems.map((p) => `- ${p}`).join("\n") || "- none recorded"}${brief.audit.incentiveText ? `\nIt leads with: "${brief.audit.incentiveText}"` : ""}`
      : `No popup appeared on a first visit${brief.audit.vendor ? ` (a ${brief.audit.vendor} script is installed)` : ""}.`
    : "No audit of the current popup is available.";
  const past = brief.pastOffers.length
    ? brief.pastOffers.map((o) => `- ${o.title} [${o.archetypes.join(", ") || "unknown archetype"}; ${o.placement}; ${o.status}] ${o.hypothesis}${o.result ? ` → ${o.result}` : ""}`).join("\n")
    : "- none yet";
  const c = brief.constraints;
  return `# Store
${brief.storeName} — ${brief.storefrontUrl}

# Merchant goal
${brief.goal}

# Constraints
- placement: ${c.placement ?? "your choice (the harness renders at phone and desktop sizes)"}
- incentive types allowed: ${c.incentiveTypes?.join(", ") ?? "any"}
- percent cap: ${percentCap(c)}%${c.margin ? ` (gross margin ${c.margin.grossMarginPct}%, floor ${c.margin.floorPct}%)` : ""}

# The incumbent
${audit}

# Offers this store already tried
${past}

# Lifestyle room shots (the takeover's lead image — use ONLY these URLs)
${lifestyle || "- (none — use a product image as the lead)"}

# Products (for picks — use ONLY these image URLs and product URLs)
${products || "- (no product images available — use editorial-type or card compositions without images)"}

# brand.md (excerpt)
${brief.brand || "(no brand.md yet — infer voice from the product titles, stay restrained)"}

# DESIGN.md (excerpt — informs imagery and mood; colors/type are applied by the renderer)
${brief.design || "(none)"}`;
}

export function conceptUserPrompt(brief: HarnessBrief, feedback?: string): string {
  return `${briefBlock(brief)}

Design ${HARNESS_BUDGET.concepts} challenger concepts. Return {"concepts": [...]}.${feedback ? `\n\nYour previous set was rejected: ${feedback}. Fix that and return a full new set.` : ""}`;
}

/** A live/approved offer's variant as an authoring concept, for remixing. */
export function variantToConcept(
  variant: Record<string, unknown>,
  meta: { title: string; hypothesis: string },
): unknown {
  const v = variant as { archetype?: string; composition?: string; steps?: unknown[]; incentive?: unknown; trigger?: unknown };
  return {
    archetype: v.archetype ?? "zero-party-quiz",
    title: meta.title.slice(0, 80),
    hypothesis: (meta.hypothesis || meta.title).slice(0, 400),
    composition: v.composition ?? "split-image",
    steps: v.steps ?? [],
    incentive: v.incentive ?? { type: "none" },
    ...(v.trigger ? { trigger: v.trigger } : {}),
  };
}

/** Pin a concept's lead image (first step) — the merchant chose it. */
export function withPinnedLeadImage(c: OfferConcept, src: string, alt: string): OfferConcept {
  const steps = c.steps.map((s, i) => {
    if (i !== 0) return s;
    const has = s.blocks.findIndex((b) => b.kind === "image");
    const img = { kind: "image" as const, src, alt };
    if (has === -1) return { ...s, blocks: [img, ...s.blocks] };
    return { ...s, blocks: s.blocks.map((b, j) => (j === has ? { ...(b as typeof img), src, alt } : b)) };
  });
  return { ...c, imageSrc: src, imageAlt: alt, steps };
}

export function remixUserPrompt(brief: HarnessBrief, source: OfferConcept, note: string | undefined): string {
  return `${briefBlock(brief)}

# An offer the merchant already approved and wants to keep
${JSON.stringify(conceptToWire(source), null, 2)}

Remix THIS concept into a premium full-screen takeover. Keep what the merchant liked: its mechanic, its question and answer options, its reward logic and the substance of its copy — this is an upgrade of the same idea, not a new idea. Upgrade the presentation: an image-led composition (split-image or full-bleed-image) with a product image from the brief that shows the idea, and tighter, more confident copy in the brand's voice.${note ? `

The merchant's direction: ${note}` : ""}

Return {"concept": {...}, "changes": "one sentence"}.`;
}

export function repairUserPrompt(brief: HarnessBrief, concept: OfferConcept, failing: (CriticVerdict & { patch?: string })[]): string {
  const notes = failing.map((v) => `- ${v.critic} (${v.score.toFixed(2)}): ${v.notes}${v.patch ? `\n  suggested: ${v.patch}` : ""}`).join("\n");
  return `${briefBlock(brief)}

# The concept under repair
${JSON.stringify(conceptToWire(concept), null, 2)}

# What the critics saw on the rendered storefront
${notes}

Revise THIS concept to fix exactly those findings. Keep its archetype and everything the critics did not object to; a patch, not a new idea. Return {"concept": {...}, "changes": "one sentence"}.`;
}

// ---------------------------------------------------------------------------
// Critics
// ---------------------------------------------------------------------------

export const CRITIC_OUTPUT_SCHEMA = obj(
  { score: { type: "number" }, pass: { type: "boolean" }, notes: str, patch: str },
  ["score", "pass", "notes", "patch"],
);

const CRITIC_RULES = `Return {"score": 0..1, "pass": boolean, "notes": "...", "patch": "..."}.
- notes: 1–3 sentences grounded in something specific you can see or read. A pass needs reasons too.
- patch: one targeted change to the concept's copy, structure, image choice or composition that would most improve it (empty string only when nothing should change). Never CSS — color and type come from DESIGN.md.
- pass only at a score of 0.7 or above. Be severe: most first drafts should not pass.`;

export function brandCriticSystem(): string {
  return `You are the brand guardian reviewing a rendered email-capture offer on the brand's own storefront, at phone and desktop sizes. Judge it against brand.md and DESIGN.md: palette fidelity, typographic hierarchy, the voice of the copy, the imagery choice, and whether it feels like this brand or like a generic popup template. The question is: would this brand put it on its homepage today?
${CRITIC_RULES}`;
}

export function incumbentCriticSystem(): string {
  return `You are judging a head-to-head: the merchant's CURRENT popup (first images) against a challenger (later images), both captured on the same storefront. Compare them on the published rubric — time and intrusiveness, touch targets, contrast, consent clarity, imagery, incentive cost, dark patterns — and on brand fit. Pass only if the challenger is clearly better, not merely different.
${CRITIC_RULES}`;
}

export function personaCriticSystem(): string {
  return `You are the brand's primary customer persona (from brand.md), seeing this offer on a first visit. Judge whether its question, incentive and reward are relevant to you and worth an email address — or irrelevant, pushy, or generic.
${CRITIC_RULES}`;
}

export function noveltyCriticSystem(): string {
  return `You review a new offer concept against the offers this store already ran. Fail it if it is a re-skin of something already tested (same archetype, same incentive, same ask with new words); pass it if it tests a genuinely different hypothesis.
${CRITIC_RULES}`;
}

export function conceptForCritic(concept: OfferConcept): string {
  return JSON.stringify(
    {
      archetype: concept.archetype,
      title: concept.title,
      hypothesis: concept.hypothesis,
      personaRef: concept.personaRef,
      composition: concept.composition,
      incentive: concept.incentive,
      steps: concept.steps,
    },
    null,
    2,
  );
}

export type CriticOutput = CriticVerdict & { patch?: string };

/** Model answer → verdict. Fails closed: unparseable, unexplained or
 * out-of-range answers become failing verdicts, never silent passes. */
export function parseCriticOutput(critic: CriticId, raw: unknown): CriticOutput {
  const r = (raw ?? {}) as { score?: unknown; pass?: unknown; notes?: unknown; patch?: unknown };
  const score = typeof r.score === "number" && Number.isFinite(r.score) ? Math.max(0, Math.min(1, r.score)) : null;
  const notes = typeof r.notes === "string" ? r.notes.trim() : "";
  if (score === null || typeof r.pass !== "boolean" || !notes) {
    return { critic, score: 0, pass: false, notes: `critic answer unusable (${notes ? "missing score/pass" : "no reasons given"})` };
  }
  const patch = typeof r.patch === "string" && r.patch.trim() ? r.patch.trim().slice(0, 600) : undefined;
  return { critic, score, pass: r.pass && score >= 0.7, notes: notes.slice(0, 800), ...(patch ? { patch } : {}) };
}

// ---------------------------------------------------------------------------
// Mechanical critics
// ---------------------------------------------------------------------------

export interface ConceptRender {
  renderId: string | null;
  viewport: "mobile" | "desktop";
  step: number;
  teaser?: boolean;
  ok: boolean;
  ready: boolean;
  diag: DiagReport | null;
  error?: string;
  /** The storefront itself did not load (Shopify throttling headless traffic). */
  unavailable?: boolean;
}

const MIN_TARGET = 44;

/** Conformance (CONTRACT §8), from the runtime's own DiagReport per render. */
export function conformanceVerdict(renders: ConceptRender[], placement: Placement): CriticOutput {
  const issues: string[] = [];
  let checks = 0;
  for (const r of renders) {
    const at = `${r.viewport}${r.teaser ? " teaser" : ` step ${r.step + 1}`}`;
    checks++;
    if (!r.ok || !r.ready || !r.diag) {
      // The mobile teaser is a minor state whose capture is flaky under the
      // sandbox; a missed teaser shot is noted, it does not veto the offer.
      if (r.teaser) continue;
      // The storefront never loaded (Shopify throttling): inconclusive, not a
      // design failure — as long as the same step rendered clean elsewhere.
      if (r.unavailable && renders.some((o) => o !== r && !o.teaser && o.step === r.step && o.ready && o.diag)) continue;
      issues.push(`${at}: the offer runtime never reported ready${r.error ? ` (${r.error.slice(0, 120)})` : ""}`);
      continue;
    }
    if (r.teaser) {
      if (r.diag.errors.length) issues.push(`${at}: runtime errors ${r.diag.errors.slice(0, 2).join("; ")}`);
      continue;
    }
    const d = r.diag;
    checks += 5;
    if (d.errors.length) issues.push(`${at}: runtime errors ${d.errors.slice(0, 2).join("; ")}`);
    if (d.overflow) issues.push(`${at}: content overflows the card`);
    if (d.imageLoaded === false) issues.push(`${at}: image failed to load`);
    const small = (label: string, rect?: { w: number; h: number }) => {
      if (rect && (rect.w < MIN_TARGET || rect.h < MIN_TARGET)) issues.push(`${at}: ${label} is ${Math.round(rect.w)}×${Math.round(rect.h)} px (< 44)`);
    };
    small("close button", d.rects.close);
    small("button", d.rects.cta);
    if (d.rects.input && d.rects.input.h < MIN_TARGET) issues.push(`${at}: email field is ${Math.round(d.rects.input.h)} px tall (< 44)`);
    d.rects.choices.forEach((c, i) => small(`choice ${i + 1}`, c));
    if (!d.rects.close) issues.push(`${at}: no close button reported`);
    for (const c of d.contrast) {
      const min = c.role === "headline" ? 3 : 4.5;
      if (c.ratio < min) issues.push(`${at}: ${c.role} contrast ${c.ratio.toFixed(2)}:1 (< ${min}:1)`);
    }
    // Overlays and takeovers are full-width bottom sheets on a phone by design;
    // only the corner card has to leave the page visible beside it.
    if (r.viewport === "mobile" && placement === "corner-card" && d.rects.card.w > d.viewport.w * 0.85 + 1) {
      issues.push(`${at}: card is ${Math.round((d.rects.card.w / d.viewport.w) * 100)}% of the phone width (> 85%)`);
    }
  }
  if (renders.length === 0) issues.push("nothing was rendered");
  const score = checks ? Math.max(0, 1 - issues.length / checks) : 0;
  return {
    critic: "conformance",
    score: Math.round(score * 1000) / 1000,
    pass: issues.length === 0,
    notes: issues.length ? issues.slice(0, 8).join("; ") : `${renders.length} renders: targets ≥ 44 px, contrast AA, no overflow, images loaded, no runtime errors`,
  };
}

export function darkPatternVerdict(manifest: OfferManifestV2): CriticOutput {
  const g = gateOfferManifestV2(manifest);
  return {
    critic: "dark-pattern",
    score: g.passed ? 1 : 0,
    pass: g.passed,
    notes: g.passed ? "gate passed: consent present, neutral decline, no urgency or chance mechanics" : g.findings.map((f) => f.message).join("; "),
  };
}

const HARD_CRITICS: CriticId[] = ["conformance", "dark-pattern"];

/** Repair only what repair can fix: soft (judgment) failures. A hard failure
 * drops the concept — the harness does not argue with the gate. */
export function repairable(verdicts: CriticVerdict[]): boolean {
  const failing = verdicts.filter((v) => v.applicable !== false && !v.pass);
  return failing.length > 0 && failing.every((v) => !HARD_CRITICS.includes(v.critic));
}

// ---------------------------------------------------------------------------
// Placement + render planning + final arms
// ---------------------------------------------------------------------------

/** Premium out of the gate: a full-screen takeover on desktop (a
 * full-height sheet on phones) unless the merchant constrains placement. */
export function placementFor(_concept: Pick<OfferConcept, "composition">, constraints: HarnessConstraints): Placement {
  return constraints.placement ?? "takeover";
}

export interface RenderPlanItem {
  id: string;
  viewport: "mobile" | "desktop";
  step: number;
  teaser: boolean;
}

/** Every step at both viewports, plus the mobile teaser once. */
export function renderPlan(prefix: string, steps: number, withTeaser: boolean): RenderPlanItem[] {
  const out: RenderPlanItem[] = [];
  for (let s = 0; s < steps; s++) {
    for (const viewport of ["mobile", "desktop"] as const) out.push({ id: `${prefix}_s${s}_${viewport}`, viewport, step: s, teaser: false });
  }
  if (withTeaser) out.push({ id: `${prefix}_teaser_mobile`, viewport: "mobile", step: 0, teaser: true });
  return out;
}

export function previewQuery(token: string, step: number, teaser: boolean, arm = "v1"): string {
  const q = new URLSearchParams({ mos_preview: token, mos_arm: arm, mos_step: String(step), mos_diag: "1" });
  if (teaser) q.set("mos_teaser", "1");
  return q.toString();
}

export function checkDiversity(concepts: OfferConcept[]): { ok: boolean; reason?: string } {
  const d = checkConceptDiversity(concepts);
  return d.ok ? { ok: true } : { ok: false, reason: d.reason ?? "not diverse enough" };
}

/** CONTRACT §8: an incumbent arm joins only when the audited vendor is one
 * the runtime can suppress + observe (Klaviyo in this build). */
export function incumbentArmFor(audit: Pick<HarnessAuditSummary, "vendor" | "appeared"> | null): { vendor: IncumbentVendor } | null {
  return audit?.appeared && audit.vendor === "klaviyo" ? { vendor: "klaviyo" } : null;
}

export function archetypeLabel(id: ArchetypeId | string | undefined): string {
  return (id && ARCHETYPES[id as ArchetypeId]?.label) || String(id ?? "—");
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

const PLACEMENTS: Placement[] = ["corner-card", "overlay", "takeover"];
const INCENTIVES = ["none", "content", "early-access", "free-shipping", "percent"] as const;

/** Untrusted request body → the harness's constraints (drop what doesn't parse). */
export function parseDesignRequest(body: unknown): { goal: string; constraints: HarnessConstraints } | { error: string } {
  const b = (body ?? {}) as { goal?: unknown; constraints?: Record<string, unknown> };
  const goal = typeof b.goal === "string" ? b.goal.trim().slice(0, 600) : "";
  if (!goal) return { error: "goal (string) is required" };
  const c = b.constraints ?? {};
  const constraints: HarnessConstraints = {};
  if (typeof c.placement === "string" && PLACEMENTS.includes(c.placement as Placement)) constraints.placement = c.placement as Placement;
  if (Array.isArray(c.incentiveTypes)) {
    const list = c.incentiveTypes.filter((x): x is (typeof INCENTIVES)[number] => INCENTIVES.includes(x as (typeof INCENTIVES)[number]));
    if (list.length) constraints.incentiveTypes = list;
  }
  const m = c.margin as { grossMarginPct?: unknown; floorPct?: unknown } | undefined;
  if (m && typeof m.grossMarginPct === "number" && typeof m.floorPct === "number" && m.grossMarginPct > 0 && m.grossMarginPct <= 100 && m.floorPct >= 0 && m.floorPct < m.grossMarginPct) {
    constraints.margin = { grossMarginPct: m.grossMarginPct, floorPct: m.floorPct };
  }
  return { goal, constraints };
}

const OFFER_ID_RE = /^[a-z0-9_-]{3,64}$/i;

/** `{ remix: { arms: [{offerId, arm, note}], controlWeight, retire } }`. */
export function parseRemixRequest(body: unknown): RemixRequest | { error: string } | null {
  const r = (body as { remix?: unknown } | null)?.remix as Record<string, unknown> | undefined;
  if (!r) return null;
  const arms = Array.isArray(r.arms)
    ? r.arms
        .map((a) => a as { offerId?: unknown; arm?: unknown; note?: unknown })
        .filter((a) => typeof a.offerId === "string" && OFFER_ID_RE.test(a.offerId))
        .slice(0, 2)
        .map((a) => ({
          offerId: String(a.offerId),
          arm: typeof a.arm === "string" && /^v\d{1,2}$/.test(a.arm) ? a.arm : "v1",
          ...(typeof a.note === "string" && a.note.trim() ? { note: a.note.trim().slice(0, 400) } : {}),
          ...(typeof (a as { imageSrc?: unknown }).imageSrc === "string" && String((a as { imageSrc?: unknown }).imageSrc).startsWith("https://cdn.shopify.com/")
            ? { imageSrc: String((a as { imageSrc?: unknown }).imageSrc) }
            : {}),
        }))
    : [];
  if (!arms.length) return { error: "remix.arms needs 1–2 {offerId, arm}" };
  const cw = typeof r.controlWeight === "number" ? r.controlWeight : undefined;
  if (cw !== undefined && !(cw >= 0.1 && cw <= 0.5)) return { error: "remix.controlWeight must be within 0.1–0.5" };
  const retire = Array.isArray(r.retire) ? r.retire.filter((x): x is string => typeof x === "string" && OFFER_ID_RE.test(x)).slice(0, 5) : [];
  return { arms, ...(cw !== undefined ? { controlWeight: cw } : {}), ...(retire.length ? { retire } : {}) };
}

