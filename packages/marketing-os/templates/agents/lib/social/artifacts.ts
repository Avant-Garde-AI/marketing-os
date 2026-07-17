/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0 — its test suite lives there). Keep this file faithful below this
 * header; fix bugs upstream first, then re-vendor.
 *
 * Parse + serialize the three `social/` repo artifacts (spec 24 §1).
 *
 * Same physical format as brand.md: YAML front matter + markdown body, parsed
 * with the `yaml` package (mirrors @avant-garde/brand-md's parse.ts — its
 * `parseFrontMatterDocument` requires brand-shaped front matter, so the split
 * is mirrored here rather than imported). Round-trip guarantee:
 * `parse(serialize(x))` deep-equals `x` for all three artifact types.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type {
  CalendarSlot,
  DesignSurfaceRef,
  SocialCalendar,
  SocialPost,
  SocialStrategy,
} from "./types";
import { POST_STATUSES } from "./types";

// ---------------------------------------------------------------------------
// Shared front-matter plumbing (mirrors brand-md/src/parse.ts)
// ---------------------------------------------------------------------------

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontMatter(raw: string, docName: string): { frontMatter: unknown; body: string } {
  const m = raw.match(FRONT_MATTER_RE);
  if (!m) throw new Error(`${docName}: missing YAML front matter (--- ... ---)`);
  let frontMatter: unknown;
  try {
    frontMatter = parseYaml(m[1] ?? "");
  } catch (e) {
    throw new Error(`${docName}: invalid front matter YAML: ${e instanceof Error ? e.message : e}`);
  }
  if (!frontMatter || typeof frontMatter !== "object") {
    throw new Error(`${docName}: front matter is not a mapping`);
  }
  return { frontMatter, body: raw.slice(m[0].length) };
}

function document(frontMatter: Record<string, unknown>, body: string): string {
  const yamlSrc = stringifyYaml(frontMatter).trimEnd();
  const trimmedBody = body.trim();
  return `---\n${yamlSrc}\n---\n\n${trimmedBody}${trimmedBody ? "\n" : ""}`;
}

function validate<T>(schema: z.ZodType<T>, value: unknown, docName: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`${docName}: invalid front matter — ${issues}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Canonical repo paths
// ---------------------------------------------------------------------------

export const STRATEGY_PATH = "social/strategy.md";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function calendarPath(month: string): string {
  if (!MONTH_RE.test(month)) throw new Error(`calendarPath: month must be YYYY-MM, got "${month}"`);
  return `social/calendar/${month}.md`;
}

export function postPath(id: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`postPath: invalid post id "${id}"`);
  return `social/posts/${id}/post.md`;
}

// ---------------------------------------------------------------------------
// social/strategy.md
// ---------------------------------------------------------------------------

const strategyFrontMatterSchema = z.object({
  channels: z
    .array(
      z.object({
        channel: z.string().min(1).describe("Channel key, e.g. instagram"),
        register: z.string().min(1).describe("Editorial register for this channel"),
        cadencePerWeek: z.number().int().positive().describe("Planned posts per week"),
      }),
    )
    .min(1),
  pillars: z
    .array(
      z.object({
        name: z.string().min(1).describe("Pillar name"),
        messagingRef: z.string().min(1).describe("brand.md messaging framework ref"),
        weight: z.number().positive().describe("Relative rotation weight"),
      }),
    )
    .min(1),
  seasonalArcs: z
    .array(
      z.object({
        name: z.string().min(1),
        months: z.array(z.string().regex(MONTH_RE, "must be YYYY-MM")).optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

export function parseStrategy(raw: string): SocialStrategy {
  const { frontMatter, body } = splitFrontMatter(raw, "social/strategy.md");
  const fm = validate(strategyFrontMatterSchema, frontMatter, "social/strategy.md");
  const strategy: SocialStrategy = {
    channels: fm.channels,
    pillars: fm.pillars,
    body: body.trim(),
  };
  if (fm.seasonalArcs) strategy.seasonalArcs = fm.seasonalArcs;
  return strategy;
}

export function serializeStrategy(strategy: SocialStrategy): string {
  const fm: Record<string, unknown> = {
    channels: strategy.channels,
    pillars: strategy.pillars,
  };
  if (strategy.seasonalArcs) fm.seasonalArcs = strategy.seasonalArcs;
  return document(fm, strategy.body);
}

// ---------------------------------------------------------------------------
// social/calendar/{YYYY-MM}.md
// ---------------------------------------------------------------------------

const calendarFrontMatterSchema = z.object({
  month: z.string().regex(MONTH_RE, "must be YYYY-MM"),
  status: z.string().min(1),
});

const TABLE_COLUMNS = ["slot", "channel", "pillar", "intent", "postId", "status"] as const;

/** Empty-cell marker for unassigned postIds in the calendar table. */
const EMPTY_CELL = "—";

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|");
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function splitRow(line: string): string[] {
  const t = line.trim();
  return t
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

export function parseCalendar(raw: string): SocialCalendar {
  const { frontMatter, body } = splitFrontMatter(raw, "social/calendar");
  const fm = validate(calendarFrontMatterSchema, frontMatter, "social/calendar");

  const lines = body.split(/\r?\n/);
  const slots: CalendarSlot[] = [];
  const noteLines: string[] = [];
  let headerSeen = false;

  for (const line of lines) {
    if (!isTableRow(line)) {
      noteLines.push(line);
      continue;
    }
    if (isSeparatorRow(line)) continue;
    const cells = splitRow(line);
    if (!headerSeen) {
      // First pipe row is the header — verify the expected columns.
      const got = cells.map((c) => c.toLowerCase());
      const want = TABLE_COLUMNS.map((c) => c.toLowerCase());
      if (got.length !== want.length || got.some((c, i) => c !== want[i])) {
        throw new Error(
          `social/calendar/${fm.month}.md: unexpected table header [${cells.join(", ")}] — expected [${TABLE_COLUMNS.join(", ")}]`,
        );
      }
      headerSeen = true;
      continue;
    }
    if (cells.length !== TABLE_COLUMNS.length) {
      throw new Error(
        `social/calendar/${fm.month}.md: table row has ${cells.length} cells, expected ${TABLE_COLUMNS.length}: "${line.trim()}"`,
      );
    }
    const [slot, channel, pillar, intent, postId, status] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!ISO_DATE_RE.test(slot)) {
      throw new Error(`social/calendar/${fm.month}.md: slot "${slot}" is not an ISO date (YYYY-MM-DD)`);
    }
    slots.push({
      slot,
      channel,
      pillar,
      intent,
      postId: postId === EMPTY_CELL || postId === "-" || postId === "" ? null : postId,
      status,
    });
  }

  const notes = noteLines.join("\n").trim();
  const calendar: SocialCalendar = { month: fm.month, status: fm.status, slots };
  if (notes) calendar.notes = notes;
  return calendar;
}

export function serializeCalendar(calendar: SocialCalendar): string {
  const fm = { month: calendar.month, status: calendar.status };
  const rows: string[] = [
    `| ${TABLE_COLUMNS.join(" | ")} |`,
    `|${TABLE_COLUMNS.map(() => " --- ").join("|")}|`,
    ...calendar.slots.map(
      (s) =>
        `| ${s.slot} | ${s.channel} | ${s.pillar} | ${s.intent} | ${s.postId ?? EMPTY_CELL} | ${s.status} |`,
    ),
  ];
  const parts: string[] = [];
  if (calendar.notes) parts.push(calendar.notes.trim(), "");
  parts.push(rows.join("\n"));
  return document(fm, parts.join("\n"));
}

// ---------------------------------------------------------------------------
// social/posts/{id}/post.md
// ---------------------------------------------------------------------------

const postFrontMatterSchema = z.object({
  id: z.string().min(1),
  channel: z.string().min(1),
  scheduledAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO datetime the post is scheduled for"),
  copy: z.string().min(1).describe("The caption text"),
  copyFormulaRef: z.string().optional().describe("brand.md copy formula ref"),
  assetRefs: z.array(z.string()).describe("Repo-relative asset paths"),
  // Explicit, first-class: the front-matter schemas STRIP unknown keys on
  // parse (zod object default), so anything not named here would be silently
  // dropped by a load→save round-trip.
  designSurface: z
    .object({
      teamId: z.string().min(1).describe("Design Studio (Penpot) team id"),
      fileId: z.string().min(1).describe("Design file id"),
      pageId: z.string().min(1).optional().describe("Page within the file"),
    })
    .optional()
    .describe("Design Studio surface bound to this post (spec 23 boundTo)"),
  targetLink: z.string().min(1).describe("Product/collection/editorial link"),
  provenance: z.array(
    z.object({
      claim: z.string().min(1),
      origin: z.enum(["owner", "agent", "data"]),
    }),
  ),
  status: z.enum(POST_STATUSES),
});

export function parsePost(raw: string): SocialPost {
  const { frontMatter, body } = splitFrontMatter(raw, "social/posts/*/post.md");
  const fm = validate(postFrontMatterSchema, frontMatter, "social/posts/*/post.md");
  const post: SocialPost = {
    id: fm.id,
    channel: fm.channel,
    copy: fm.copy,
    assetRefs: fm.assetRefs,
    targetLink: fm.targetLink,
    provenance: fm.provenance,
    status: fm.status,
    body: body.trim(),
  };
  if (fm.scheduledAt !== undefined) post.scheduledAt = fm.scheduledAt;
  if (fm.copyFormulaRef !== undefined) post.copyFormulaRef = fm.copyFormulaRef;
  if (fm.designSurface !== undefined) post.designSurface = fm.designSurface;
  return post;
}

export function serializePost(post: SocialPost): string {
  const fm: Record<string, unknown> = { id: post.id, channel: post.channel };
  if (post.scheduledAt !== undefined) fm.scheduledAt = post.scheduledAt;
  fm.copy = post.copy;
  if (post.copyFormulaRef !== undefined) fm.copyFormulaRef = post.copyFormulaRef;
  fm.assetRefs = post.assetRefs;
  if (post.designSurface !== undefined) fm.designSurface = post.designSurface;
  fm.targetLink = post.targetLink;
  fm.provenance = post.provenance;
  fm.status = post.status;
  return document(fm, post.body);
}

/**
 * Bind a composed Design Surface to a post (SM1 design-link glue, spec 24 §3).
 * Pure: returns a new post with `designSurface` set — replacing any previous
 * binding — leaving the input untouched. The caller persists the result via
 * serializePost.
 */
export function linkDesignToPost(post: SocialPost, ref: DesignSurfaceRef): SocialPost {
  const designSurface: DesignSurfaceRef = {
    teamId: ref.teamId,
    fileId: ref.fileId,
    ...(ref.pageId !== undefined ? { pageId: ref.pageId } : {}),
  };
  return { ...post, designSurface };
}
