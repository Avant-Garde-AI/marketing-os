/**
 * The audit pipeline: page pixels → perception (VLM against the vocabulary) →
 * admitted facets → category strokes.
 *
 * Pixels are held in memory for the one labeling call and never written to
 * the result, matching the dataset rule (spec 35 §4): the record keeps a
 * sha256, not the screenshot.
 */
import { createHash } from "node:crypto";
import {
  brandKey, labelCapture, resolvedObservations, suggestStrokes, unresolvedProposals,
  type Benchmarks, type Capture, type PageType, type StrokePlan, type Taxonomy, type VisionModel, type Vocabulary,
} from "@avant-garde/design-craft";

export interface PageImages {
  /** First screen, shot before scrolling. Optional but improves hero and sticky-chrome labels. */
  fold?: Buffer;
  /** The full page, or the only screenshot a client has. */
  full: Buffer;
  mime?: "image/png" | "image/jpeg";
}

export interface AuditInput {
  url: string;
  category?: string;
  pageType: PageType;
  viewport: "desktop" | "mobile";
  capturedAt?: string;
  images: PageImages;
}

export interface AuditResult {
  page: { url: string; brand: string; category: string; pageType: PageType; viewport: "desktop" | "mobile"; capturedAt: string; sha256: string };
  labeler: string;
  /** The page's admitted treatments, axis → value. These are the stroke `from` values. */
  facets: Record<string, string>;
  /** Treatments the page shows that the vocabulary hasn't admitted. */
  novel: { axis: string; value: string; gloss?: string }[];
  notes?: string;
  plan: StrokePlan;
}

export async function auditImages(
  input: AuditInput,
  deps: { vision: VisionModel; vocabulary: Vocabulary; benchmarks: Benchmarks; taxonomy?: Taxonomy; limit?: number },
): Promise<AuditResult> {
  const category = input.category?.trim() || "all";
  const sha256 = createHash("sha256").update(input.images.full).digest("hex");
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  // Virtual paths: labelCapture reads through readImage, so nothing touches disk.
  const files = new Map<string, Buffer>([["full", input.images.full]]);
  if (input.images.fold) files.set("fold", input.images.fold);
  const capture: Capture = {
    brand: brandKey(input.url),
    category,
    pageType: input.pageType,
    url: input.url,
    viewport: input.viewport,
    capturedAt,
    path: "full",
    ...(input.images.fold ? { foldPath: "fold" } : {}),
    sha256,
  };
  const label = await labelCapture(capture, {
    model: input.images.mime === "image/jpeg" ? asJpeg(deps.vision) : deps.vision,
    vocabulary: deps.vocabulary,
    readImage: async (p) => files.get(p)!,
  });
  const facets = Object.fromEntries(resolvedObservations(deps.vocabulary, label).map((o) => [o.axis, o.value]));
  const novel = unresolvedProposals(deps.vocabulary, label);
  const plan = suggestStrokes({
    facets,
    novel,
    category,
    pageType: input.pageType,
    viewport: input.viewport,
    benchmarks: deps.benchmarks,
    vocabulary: deps.vocabulary,
    ...(deps.taxonomy ? { taxonomy: deps.taxonomy } : {}),
    limit: deps.limit,
  });
  return {
    page: { url: input.url, brand: capture.brand, category, pageType: input.pageType, viewport: input.viewport, capturedAt, sha256 },
    labeler: label.labeler.id,
    facets,
    novel,
    ...(label.notes ? { notes: label.notes } : {}),
    plan,
  };
}

/** labelCapture always sends image/png; a JPEG upload needs its real mime type. */
function asJpeg(m: VisionModel): VisionModel {
  return { id: m.id, complete: (i) => m.complete({ ...i, images: i.images.map((img) => ({ ...img, mime: "image/jpeg" as const })) }) };
}

// ── URL safety for server-side capture ───────────────────────────────────────

/**
 * Only public http(s) pages. A capture runs a real browser on the host's network,
 * so loopback, private, link-local and metadata addresses are refused by name.
 * (DNS rebinding is out of scope for the local CLI; hosted deployments accept
 * screenshots instead of URLs.)
 */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("only http(s) pages can be audited");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost =
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) || /^0\./.test(h) || h === "0.0.0.0" || h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) ||
    h === "metadata.google.internal";
  if (privateHost) throw new Error(`refusing to capture a private or local address (${h})`);
  return u;
}
