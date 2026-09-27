import { describe, expect, it } from "vitest";
import { normalizeFieldCohort, type FieldEntry } from "../src/field-cohort";

const artist = { handle: "artist", name: "Artist", followers: 10, tier: "small", peer_indegree: 1 };
const post = (
  shortcode: string,
  type: "Image" | "Sidecar" | "Video" = "Image",
  imageFile = `${shortcode}.jpg`
) => ({
  shortcode,
  url: `https://instagram.test/p/${shortcode}/`,
  type,
  caption: "caption",
  likes: 4,
  comments: 2,
  timestamp: "2026-09-01T00:00:00Z",
  imageUrl: "https://cdn.test/cover.jpg",
  imageFile,
});
const entry = (
  posts: unknown[],
  count = posts.length,
  sourceObject = "artist.json",
  artistOverride = artist
): FieldEntry => ({
  sourceObject,
  raw: { artist: artistOverride, pulledAt: "2026-09-01T00:00:00Z", count, posts },
});
const options = {
  imageDir: "/pixels",
  imageFiles: ["a.jpg", "side.jpg", "video.jpg"],
  objectInventory: [
    "artist.json",
    "gs://bucket/images/a.jpg",
    "gs://bucket/images/side.jpg",
    "gs://bucket/images/video.jpg",
  ],
  imageObjectPrefix: "gs://bucket/images/",
};

describe("field cohort normalization", () => {
  it("emits only durable Image singles and preserves source provenance", () => {
    const out = normalizeFieldCohort(
      [entry([post("a"), post("side", "Sidecar"), post("video", "Video")])],
      options
    );
    expect(out.singles).toHaveLength(1);
    expect(out.singles[0]).toMatchObject({
      postId: "instagram:a",
      imageObject: "gs://bucket/images/a.jpg",
      localPath: "/pixels/a.jpg",
      sourceObject: "artist.json",
      pulledAt: "2026-09-01T00:00:00Z",
    });
    expect(out.audit.map((x) => x.reason)).toEqual(["not-single", "not-single"]);
  });
  it("audits missing images and count mismatches without promoting covers", () => {
    const out = normalizeFieldCohort([entry([post("missing", "Image", "gone.jpg")], 2)], options);
    expect(out.singles).toEqual([]);
    expect(out.audit.map((x) => x.reason)).toEqual(["count-mismatch"]);
    const missing = normalizeFieldCohort([entry([post("missing", "Image", "gone.jpg")])], options);
    expect(missing.audit[0]?.reason).toBe("missing-image");
  });
  it("fails closed on unknown metadata and missing source objects", () => {
    const unknown = normalizeFieldCohort(
      [{ sourceObject: "artist.json", raw: { artist } }],
      options
    );
    expect(unknown.singles).toEqual([]);
    expect(unknown.audit[0]?.reason).toBe("metadata-invalid");
    const absent = normalizeFieldCohort([entry([post("a")], 1, "missing.json")], options);
    expect(absent.audit[0]?.reason).toBe("object-missing");
  });
  it("rejects duplicate global Instagram shortcodes", () => {
    const otherArtist = { ...artist, handle: "other" };
    const out = normalizeFieldCohort(
      [entry([post("a")]), entry([post("a")], 1, "artist-2.json", otherArtist)],
      { ...options, objectInventory: [...options.objectInventory, "artist-2.json"] }
    );
    expect(out.singles).toEqual([]);
    expect(out.audit).toHaveLength(2);
    expect(out.audit.every((x) => x.reason === "duplicate-post")).toBe(true);
  });
  it("rejects traversal and absolute image paths", () => {
    const traversal = normalizeFieldCohort([entry([post("x", "Image", "../x.jpg")])], {
      ...options,
      imageFiles: ["../x.jpg"],
    });
    const absolute = normalizeFieldCohort([entry([post("y", "Image", "/tmp/y.jpg")])], {
      ...options,
      imageFiles: ["/tmp/y.jpg"],
    });
    expect(traversal.audit[0]?.reason).toBe("invalid-image-path");
    expect(absolute.audit[0]?.reason).toBe("invalid-image-path");
    for (const path of [String.raw`\\server\share.jpg`, String.raw`C:\temp\x.jpg`, "nested/x.jpg"]) {
      const result = normalizeFieldCohort([entry([post("x", "Image", path)])], options);
      expect(result.audit[0]?.reason).toBe("invalid-image-path");
    }
  });
});
