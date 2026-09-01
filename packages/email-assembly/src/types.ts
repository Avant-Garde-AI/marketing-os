/**
 * @avant-garde/email-assembly — shared types + input schemas.
 *
 * The Email Campaign Agent's HTML seam (docs/email-campaign-agent/04).
 * Three layers, three owners (04 §0):
 *
 *   1. **skeleton** — the store's own deliverability-proven frame, ingested
 *      from reference Klaviyo templates (`extract.ts`), content regions
 *      replaced by `{{slot:NAME}}` markers.
 *   2. **surface sections** — pixel-exact brand expression, Penpot boards
 *      exported as PNG and referenced by URL. This package NEVER uploads —
 *      it takes URLs (Klaviyo `image_url` in production, 03 §5).
 *   3. **html sections** — everything textual, rendered from a FIXED block
 *      vocabulary (`renderers.ts`, never free-form LLM HTML) styled by DTCG
 *      brand tokens (`css.ts`).
 *
 * The dividing rule (04 §0): if it must reflow, be read by screen readers or
 * Gmail's clipper, adapt to dark mode, or be edited without a re-export — it
 * is HTML. If it is visual brand expression that must be pixel-exact — it is
 * a board export.
 *
 * Everything here is pure and deterministic: same input → byte-identical
 * output (approval-nonce hashing depends on it). No clocks, no randomness,
 * no network. Lineage timestamps, if any, arrive via input `meta`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// DTCG token shapes.
//
// These structurally mirror @avant-garde/brand-md's `compileDesignTokens`
// output (packages/brand-md/src/dtcg.ts). They are duplicated here rather
// than imported so this package stays dependency-light — the token file is
// an open W3C DTCG format, not a brand-md-private shape. `css.ts` walks the
// file defensively, so any conforming DTCG file works.
// ---------------------------------------------------------------------------

export interface DtcgToken {
  $type: string;
  $value: unknown;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

export interface DtcgGroup {
  [name: string]: DtcgToken | DtcgGroup | unknown;
}

/**
 * Root of a DTCG tokens file: `$`-prefixed metadata keys plus one group per
 * token set (brand-md emits `global` and optionally one set per theme).
 */
export type DtcgTokensFile = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Skeleton extraction output (WS2-R3).
// ---------------------------------------------------------------------------

/**
 * A named content slot in an extracted skeleton, with the layout constraints
 * observed at the point the original content sat (04 §3 step 3). Constraints
 * are HEURISTIC — derived from the surrounding table cell where feasible —
 * and exist so the board composer and copy renderer can match the frame.
 */
export interface SkeletonSlot {
  /** Slot name as it appears in the `{{slot:NAME}}` marker. */
  name: string;
  /**
   * Effective pixel width available to slot content: the spine column's
   * width, narrowed by the band's own cell width when one was declared.
   * Always ≤ 600 (the extraction invariant guarantees the spine is).
   */
  maxWidth: number;
  /**
   * Background color in effect where the content sat (nearest `bgcolor`
   * attribute or `background(-color)` style on the band or its ancestors).
   * `null` when nothing was declared — assume the client default (white).
   */
  backgroundContext: string | null;
  /**
   * The `padding` declared on the band's own cell, verbatim (e.g.
   * `"0 24px 16px"`). `null` when the band declared none. Renderers apply
   * their own padding; this records what the source email used.
   */
  paddingContext: string | null;
}

/**
 * Finding types recorded during extraction. `brand-drift` is part of the
 * contract now (spec 21's coherence-check discipline — template colors
 * diverging from DESIGN.md are worth surfacing to the owner) and is emitted
 * when `ExtractOptions.brandColors` is provided; the other three are
 * sanitization findings (04 §3 step 4).
 */
export type SkeletonFindingType =
  | "script-removed"
  | "tracking-pixel-removed"
  | "content-replaced"
  | "brand-drift";

export interface SkeletonFinding {
  type: SkeletonFindingType;
  detail: string;
}

export interface ExtractedSkeleton {
  /** The frame with `{{slot:NAME}}` markers where content regions were. */
  skeletonHtml: string;
  slots: SkeletonSlot[];
  findings: SkeletonFinding[];
}

export interface ExtractOptions {
  /**
   * Image hosts whose 1×1 pixels are NOT treated as foreign trackers
   * (glob-ish patterns, see `DEFAULT_ALLOWED_IMAGE_HOSTS`). Klaviyo's own
   * tracking is injected at send time, so anything hardcoded in a template
   * from another host is a leftover from a previous ESP.
   */
  allowedImageHosts?: string[];
  /**
   * The brand palette (hex strings) from DESIGN.md. When provided, hex
   * colors found in the surviving frame that are not in the palette are
   * reported as `brand-drift` findings (case-insensitive exact hex compare —
   * deliberately naive v1; no perceptual distance).
   */
  brandColors?: string[];
}

// ---------------------------------------------------------------------------
// Assembly input (WS2-R4) — sections, block vocabulary, meta.
// ---------------------------------------------------------------------------

/**
 * The FIXED renderer vocabulary (04 §5 "fidelity"): a small set of
 * hand-hardened, table-based, Outlook-conditional section renderers reused
 * everywhere — never free-form HTML. If a campaign needs a shape this
 * vocabulary can't express, the vocabulary grows here (with tests), it does
 * not get inlined upstream.
 */
export const productItemSchema = z.object({
  name: z.string().min(1),
  price: z.string().min(1),
  href: z.string().min(1),
  imageUrl: z.string().min(1).optional(),
  /** Alt for the product image; defaults to `name` so the alt invariant holds. */
  alt: z.string().optional(),
  /** Artist, shown under the title. The single most useful fact on an art card. */
  artist: z.string().optional(),
  /**
   * One line of editorial about THIS piece — why it earns its place, not a
   * restatement of the title. Kept short deliberately: a product row is scanned,
   * not read, and a paragraph here turns three cards into a wall of text.
   */
  blurb: z.string().max(180).optional(),
});

export type ProductItem = z.infer<typeof productItemSchema>;

export const emailBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("paragraph"),
    text: z.string().min(1),
    /** Centred composition — the register the Arthaus editorial mocks use. */
    align: z.enum(["left", "center"]).optional(),
    /** Serif italic. The brand's editorial voice for a standfirst or a pull line. */
    emphasis: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("heading"),
    text: z.string().min(1),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    align: z.enum(["left", "center"]).optional(),
  }),
  z.object({ kind: z.literal("button"), text: z.string().min(1), href: z.string().min(1) }),
  z.object({
    kind: z.literal("productRow"),
    products: z.array(productItemSchema).min(1).max(4),
  }),
  /**
   * The short bronze dash the Arthaus mocks set under a headline. Distinct from
   * `divider`, which is a full-width hairline separating sections: this is a
   * typographic flourish that belongs TO the heading above it.
   */
  /**
   * A gallery wall set — a curated multi-piece arrangement sold together.
   * Composed as one editorial unit (room shot, name, why it hangs together,
   * piece count and price) rather than three product cards, because the set IS
   * the product: shown as separate cards a reader has to reassemble the idea.
   */
  z.object({
    kind: z.literal("wallSet"),
    name: z.string().min(1),
    href: z.string().min(1),
    imageUrl: z.string().min(1),
    /** e.g. "Line Story" — the room the set was composed for. */
    room: z.string().optional(),
    /** One sentence on why these pieces belong together. */
    rationale: z.string().max(300).optional(),
    pieceCount: z.number().int().positive().optional(),
    price: z.string().optional(),
    /** Artist names, deduplicated by the caller. */
    artists: z.array(z.string()).optional(),
    ctaText: z.string().optional(),
  }),
  /**
   * The artist, as the store's own artist page presents them: portrait, name,
   * bronze rule, location, an italic pull-quote, and the works / collections
   * counts. An artist drop that opens on a room shot with no artist is a
   * product email wearing an editorial hat.
   */
  z.object({
    kind: z.literal("artistCard"),
    name: z.string().min(1),
    href: z.string().min(1),
    portraitUrl: z.string().optional(),
    location: z.string().optional(),
    quote: z.string().max(280).optional(),
    worksCount: z.number().int().positive().optional(),
    collectionsCount: z.number().int().positive().optional(),
    ctaText: z.string().optional(),
  }),
  z.object({ kind: z.literal("rule"), align: z.enum(["left", "center"]).optional() }),
  z.object({ kind: z.literal("spacer"), height: z.number().int().positive().max(200) }),
  // --- Arthaus design-system vocabulary (introspected from marketplace/emails) ---
  /** Bronze uppercase micro-label — the signature Arthaus kicker above a section. */
  z.object({ kind: z.literal("eyebrow"), text: z.string().min(1) }),
  /** A full-width hosted image (not a board export). alt required unless decorative. */
  z.object({
    kind: z.literal("image"),
    src: z.string().min(1),
    alt: z.string().optional(),
    href: z.string().optional(),
    decorative: z.boolean().optional(),
  }),
  /** Bronze left-border pull-quote; `emphasis` renders it as a serif italic. */
  z.object({ kind: z.literal("callout"), text: z.string().min(1), emphasis: z.boolean().optional() }),
  /** Full-bleed charcoal CTA band: optional eyebrow + headline + accent button. */
  z.object({
    kind: z.literal("ctaBand"),
    heading: z.string().min(1),
    buttonText: z.string().min(1),
    buttonHref: z.string().min(1),
    eyebrow: z.string().optional(),
  }),
  /** Horizontal image+text feature card (a featured set or a single feature). */
  z.object({
    kind: z.literal("featuredCard"),
    imageUrl: z.string().min(1),
    title: z.string().min(1),
    href: z.string().min(1),
    description: z.string().optional(),
    price: z.string().optional(),
    eyebrow: z.string().optional(),
  }),
  /** Numbered / checkmark / bordered-feature list of short rows. */
  z.object({
    kind: z.literal("list"),
    style: z.enum(["numbered", "check", "feature"]),
    items: z.array(z.object({ title: z.string().min(1), text: z.string().optional() })).min(1).max(8),
  }),
  /** Palette swatch row — circular color chips (decorative). */
  z.object({
    kind: z.literal("swatches"),
    colors: z.array(z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{3,8}$/), name: z.string().optional() })).min(1).max(8),
  }),
  /** Pill/chip row — inline rounded tags. */
  z.object({ kind: z.literal("chips"), items: z.array(z.string().min(1)).min(1).max(12) }),
  /** Inline trust-badge row (e.g. "Free shipping · 100-day guarantee"). */
  z.object({ kind: z.literal("trustBadges"), items: z.array(z.string().min(1)).min(1).max(6) }),
  /** A visible hairline rule (distinct from the invisible spacer). */
  z.object({ kind: z.literal("divider") }),
  /**
   * An editorial callout built from one dimension of the store's art knowledge
   * graph: a named connection ("In a Similar Light"), the reason it holds, and
   * the works it links to. This is what turns a product roundup into an
   * informative editorial read — the graph made visible rather than implied.
   */
  z.object({
    kind: z.literal("graphCallout"),
    /** The dimension's name — rendered as the bronze kicker. */
    label: z.string().min(1),
    /** Why these connect. One sentence; the graph's blurb or a brand-voiced edit. */
    note: z.string().optional(),
    pieces: z
      .array(
        z.object({
          imageUrl: z.string().min(1),
          title: z.string().min(1),
          artist: z.string().optional(),
          href: z.string().min(1),
        }),
      )
      .min(1)
      .max(3),
  }),
]);

export type EmailBlock = z.infer<typeof emailBlockSchema>;

/**
 * A surface section: one exported design-surface board, slotted as an image.
 * `width`/`height` are the EXPORTED pixel dimensions (typically @2x retina,
 * e.g. 1200×1500); the renderer displays at min(width, 600) CSS px (04 §2).
 *
 * `alt` is deliberately optional at the SCHEMA level: the alt-text rule is
 * owned by the invariant engine (04 §5 — `assembleEmail` fails on any image
 * lacking alt or an explicit `decorative` marking) so violations surface as
 * structured report errors the preview can display, not thrown validation
 * errors.
 */
export const surfaceSectionSchema = z.object({
  slot: z.string().min(1),
  type: z.literal("surface"),
  imageUrl: z.string().min(1),
  alt: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Explicitly decorative: rendered with `alt=""` + `role="presentation"`. */
  decorative: z.boolean().optional(),
  /** Exported asset size in bytes, when known — feeds the image-weight warning. */
  byteSize: z.number().int().positive().optional(),
});

export const htmlSectionSchema = z.object({
  slot: z.string().min(1),
  type: z.literal("html"),
  /** One block or an ordered array of blocks (multiple blocks per slot allowed). */
  block: z.union([emailBlockSchema, z.array(emailBlockSchema).min(1)]),
});

export const emailSectionSchema = z.discriminatedUnion("type", [
  surfaceSectionSchema,
  htmlSectionSchema,
]);

export type SurfaceSection = z.infer<typeof surfaceSectionSchema>;
export type HtmlSection = z.infer<typeof htmlSectionSchema>;
export type EmailSection = z.infer<typeof emailSectionSchema>;

/**
 * Campaign metadata. Subject/preview live here (not in sections) because
 * they are envelope, not body. Version fields are LINEAGE (04 §6 invariant
 * 6): they are stamped into an HTML comment so an assembled artifact can
 * always be traced to the token set, DESIGN.md, and skeleton that produced
 * it. They are caller-supplied strings — this package never reads clocks or
 * resolves versions itself (determinism).
 */
export const campaignMetaSchema = z.object({
  subject: z.string().min(1),
  previewText: z.string().min(1),
  tokensVersion: z.string().optional(),
  designMdVersion: z.string().optional(),
  skeletonVersion: z.string().optional(),
});

export type CampaignMeta = z.infer<typeof campaignMetaSchema>;

export const assembleOptionsSchema = z.object({
  /**
   * Strict mode (DEFAULT true): every image URL must resolve to an allowed
   * host (Klaviyo CDN patterns unless overridden) — sent mail must never
   * hotlink our own hosts (03 §5). Set `false` only for the ungated
   * render-preview path, where boards may still live on export storage.
   */
  strict: z.boolean().optional(),
  /** Host allowlist override (glob-ish patterns like `*.klaviyo.com`). */
  allowedImageHosts: z.array(z.string().min(1)).optional(),
});

export type AssembleOptions = z.infer<typeof assembleOptionsSchema>;

export const skeletonInputSchema = z.object({
  html: z.string().min(1),
  slots: z.array(
    z.object({
      name: z.string().min(1),
      maxWidth: z.number().int().positive().optional(),
      backgroundContext: z.string().nullable().optional(),
      paddingContext: z.string().nullable().optional(),
    }),
  ),
});

export const assembleEmailInputSchema = z.object({
  skeleton: skeletonInputSchema,
  sections: z.array(emailSectionSchema),
  /** DTCG tokens file (brand-md `compileDesignTokens` output shape). */
  tokens: z.record(z.unknown()).optional(),
  meta: campaignMetaSchema,
  options: assembleOptionsSchema.optional(),
});

export type AssembleEmailInput = z.infer<typeof assembleEmailInputSchema>;

// ---------------------------------------------------------------------------
// Assembly report (WS2-R4).
// ---------------------------------------------------------------------------

/** Error codes — each maps to a 04 §6 invariant (see invariants.ts). */
export type AssemblyErrorCode =
  | "unsubscribe-missing" // 1 — unsubscribe merge tag present + untouched
  | "merge-tag-altered" // 1b — Klaviyo Django tags preserved verbatim
  | "img-alt-missing" // 2 — every img described or explicitly decorative
  | "img-host-untrusted" // 2 — image URLs on the Klaviyo CDN in strict mode
  | "column-too-wide" // 3 — single ≤600px column intact
  | "html-too-large" // 3 — Gmail clips ~102KB; hard fail at 100KB
  | "link-unresolvable" // 4 — no empty/fragment-only hrefs
  | "cta-mailto" // 4 — no mailto in CTAs (breaks link tracking + UX)
  | "no-text-section" // 5 — at least one non-trivial HTML text section
  | "lineage-missing" // 6 — lineage comment stamped
  | "slot-unknown"; // input error: section names a slot the skeleton lacks

export type AssemblyWarningCode =
  | "html-large" // 3 — >80KB, approaching the Gmail clip
  | "image-weight" // 3 — total image bytes >1.5MB (when byteSize supplied)
  | "subject-long" // 5 — subject >60 chars gets truncated in most clients
  | "preview-length" // 5 — preview outside 40–130 chars wastes the slot
  | "slot-unfilled"; // a skeleton slot received no section (marker stripped)

export interface AssemblyIssue {
  code: AssemblyErrorCode | AssemblyWarningCode;
  message: string;
}

export interface AssemblyReport {
  /** True iff `errors` is empty. Callers MUST treat false as a hard gate. */
  ok: boolean;
  errors: AssemblyIssue[];
  warnings: AssemblyIssue[];
  stats: {
    /** UTF-8 byte length of the final HTML (what Gmail's clipper measures). */
    htmlBytes: number;
    /** `<img>` elements in the final HTML (frame + sections). */
    imageCount: number;
    /** Number of `type: "html"` sections supplied. */
    textSections: number;
  };
}

export interface AssembledEmail {
  html: string;
  report: AssemblyReport;
}

// ---------------------------------------------------------------------------
// Partial composition (store-repo authoring seam).
// ---------------------------------------------------------------------------

export interface ComposePartialsReport {
  /** Distinct partial names substituted, in first-encounter order. */
  used: string[];
  /** Distinct marker names with no matching partial, in first-encounter order. */
  missing: string[];
}

export interface ComposedTemplate {
  html: string;
  report: ComposePartialsReport;
}
