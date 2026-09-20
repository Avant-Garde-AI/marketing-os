import { join } from "node:path";
import { z } from "zod";

const text = z.string().trim().min(1);
const maybeText = z.string().nullable().optional();
const artistSchema = z
  .object({
    handle: text,
    name: maybeText,
    followers: z.number().finite().nonnegative().nullable().optional(),
    tier: maybeText,
    peer_indegree: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();
const postSchema = z
  .object({
    shortcode: text,
    url: text,
    type: z.enum(["Image", "Sidecar", "Video"]),
    caption: maybeText,
    likes: z.number().finite().nullable().optional(),
    comments: z.number().finite().nullable().optional(),
    timestamp: maybeText,
    imageUrl: maybeText,
    imageFile: maybeText,
  })
  .strict();
const recordSchema = z
  .object({
    artist: artistSchema,
    pulledAt: text,
    count: z.number().int().nonnegative(),
    posts: z.array(postSchema),
  })
  .strict();

export type FieldEntry = { sourceObject: string; raw: unknown };
export type FieldSingle = {
  postId: string;
  artistHandle: string;
  pulledAt: string;
  sourceObject: string;
  sourceUrl: string;
  imageObject: string;
  imageFile: string;
  localPath: string;
  caption: string;
  likes?: number;
  comments?: number;
  timestamp?: string;
};
export type FieldAudit = {
  postId: string;
  artistHandle: string;
  pulledAt?: string;
  sourceObject: string;
  reason:
    | "metadata-invalid"
    | "object-missing"
    | "count-mismatch"
    | "duplicate-post"
    | "not-single"
    | "missing-image"
    | "invalid-image-path";
  detail: string;
  type?: string;
  imageFile?: string;
  imageObject?: string;
};
export type FieldCohortResult = { singles: FieldSingle[]; audit: FieldAudit[] };

function postId(shortcode: string): string {
  return `instagram:${shortcode}`;
}
function imagePathSafe(imageFile: string): boolean {
  // The source uses flat filenames; accepting directories adds no valid coverage.
  return imageFile !== "." && imageFile !== ".." && /^[^/\\:]+$/.test(imageFile);
}

/** Normalize only durable single-image posts. Sidecar/Video covers remain audit rows. */
export function normalizeFieldCohort(
  entries: FieldEntry[],
  options: {
    imageDir: string;
    imageFiles: Iterable<string>;
    objectInventory: Iterable<string>;
    imageObjectPrefix: string;
  }
): FieldCohortResult {
  const imageFiles = new Set(options.imageFiles),
    objects = new Set(options.objectInventory),
    singles: FieldSingle[] = [],
    audit: FieldAudit[] = [];
  const parsed: Array<{ entry: FieldEntry; record: z.infer<typeof recordSchema> }> = [];
  for (const entry of entries) {
    const candidate =
      entry.raw && typeof entry.raw === "object"
        ? (entry.raw as { artist?: { handle?: unknown }; pulledAt?: unknown })
        : {};
    const handle =
        typeof candidate.artist?.handle === "string" ? candidate.artist.handle : "unknown",
      pulledAt = typeof candidate.pulledAt === "string" ? candidate.pulledAt : undefined;
    if (!objects.has(entry.sourceObject)) {
      audit.push({
        postId: `${handle}:__artist__`,
        artistHandle: handle,
        pulledAt,
        sourceObject: entry.sourceObject,
        reason: "object-missing",
        detail: "metadata source object is absent from the explicit object inventory",
      });
      continue;
    }
    const result = recordSchema.safeParse(entry.raw);
    if (!result.success) {
      audit.push({
        postId: `${handle}:__artist__`,
        artistHandle: handle,
        pulledAt,
        sourceObject: entry.sourceObject,
        reason: "metadata-invalid",
        detail: "metadata shape is not recognized",
      });
      continue;
    }
    parsed.push({ entry, record: result.data });
  }
  const counts = new Map<string, number>();
  for (const { record } of parsed)
    for (const post of record.posts)
      counts.set(post.shortcode, (counts.get(post.shortcode) ?? 0) + 1);
  const duplicates = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  for (const { entry, record } of parsed) {
    const artistHandle = record.artist.handle;
    if (record.count !== record.posts.length) {
      audit.push({
        postId: `${artistHandle}:__artist__`,
        artistHandle,
        pulledAt: record.pulledAt,
        sourceObject: entry.sourceObject,
        reason: "count-mismatch",
        detail: `declared ${record.count} posts but found ${record.posts.length}`,
      });
      continue;
    }
    for (const post of record.posts) {
      const id = postId(post.shortcode),
        imageFile = post.imageFile ?? undefined,
        imageObject = imageFile ? `${options.imageObjectPrefix}${imageFile}` : undefined;
      if (duplicates.has(post.shortcode)) {
        audit.push({
          postId: id,
          artistHandle,
          pulledAt: record.pulledAt,
          sourceObject: entry.sourceObject,
          reason: "duplicate-post",
          detail: "global Instagram shortcode occurs more than once",
          type: post.type,
          imageFile,
          imageObject,
        });
        continue;
      }
      if (post.type !== "Image") {
        audit.push({
          postId: id,
          artistHandle,
          pulledAt: record.pulledAt,
          sourceObject: entry.sourceObject,
          reason: "not-single",
          detail: "Sidecar and Video covers are not complete single-image posts",
          type: post.type,
          imageFile,
          imageObject,
        });
        continue;
      }
      if (!imageFile) {
        audit.push({
          postId: id,
          artistHandle,
          pulledAt: record.pulledAt,
          sourceObject: entry.sourceObject,
          reason: "missing-image",
          detail: "metadata has no durable imageFile",
          type: post.type,
          imageFile,
          imageObject,
        });
        continue;
      }
      if (!imagePathSafe(imageFile)) {
        audit.push({
          postId: id,
          artistHandle,
          pulledAt: record.pulledAt,
          sourceObject: entry.sourceObject,
          reason: "invalid-image-path",
          detail: "imageFile is absolute or path-traversing",
          type: post.type,
          imageFile,
          imageObject,
        });
        continue;
      }
      if (!imageFiles.has(imageFile) || !imageObject || !objects.has(imageObject)) {
        audit.push({
          postId: id,
          artistHandle,
          pulledAt: record.pulledAt,
          sourceObject: entry.sourceObject,
          reason: "missing-image",
          detail: "local image inventory and exact GCS image object are both required",
          type: post.type,
          imageFile,
          imageObject,
        });
        continue;
      }
      singles.push({
        postId: id,
        artistHandle,
        pulledAt: record.pulledAt,
        sourceObject: entry.sourceObject,
        sourceUrl: post.url,
        imageObject,
        imageFile,
        localPath: join(options.imageDir, imageFile),
        caption: post.caption ?? "",
        likes: typeof post.likes === "number" && post.likes >= 0 ? post.likes : undefined,
        comments:
          typeof post.comments === "number" && post.comments >= 0 ? post.comments : undefined,
        timestamp: post.timestamp ?? undefined,
      });
    }
  }
  return { singles, audit };
}
