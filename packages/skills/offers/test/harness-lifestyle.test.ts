import { describe, expect, it } from "vitest";
import {
  harness,
} from "../src/index";

const {
  rankLifestyleCandidates,
  rankRoomShots,
  roomShotFits,
  roomShotLabel,
  roomShotThumbnail,
  ROOM_SHOT_BATCH,
  withProgress,
  withLeadImage,
  OfferConceptSchema,
} = harness;

const CDN = "https://cdn.shopify.com/s/files/1/0001/files/";
const col = (title: string, image: string | null, metafields: Record<string, string> = {}) => ({
  title,
  image: image ? { url: image, altText: null } : null,
  metafields: { nodes: Object.entries(metafields).map(([key, value]) => ({ key, value })) },
});

describe("rankLifestyleCandidates", () => {
  it("puts curated heroes first, vendor pages last, and keeps input order within a rank", () => {
    const out = rankLifestyleCandidates(
      [
        col("Jane Doe", `${CDN}jane.jpg`, { hero_image_url: `${CDN}jane-hero.jpg` }), // vendor + hero → 2
        col("Living Room", `${CDN}living.jpg?v=3`), // curated, no hero → 1
        col("Bedroom", `${CDN}bed.jpg`, { hero_image_url: `  ${CDN}bed-hero.jpg?v=1 ` }), // curated hero → 0
        col("Studio", `${CDN}studio.jpg`, { lifestyle_img: `${CDN}studio-room.jpg` }), // curated hero → 0
        col("Bob Roe", `${CDN}bob.jpg`), // vendor, no hero → 3
      ],
      ["  JANE DOE ", "bob roe"],
    );
    expect(out.map((l) => l.imageSrc)).toEqual([
      `${CDN}bed-hero.jpg`,
      `${CDN}studio-room.jpg`,
      `${CDN}living.jpg`,
      `${CDN}jane-hero.jpg`,
      `${CDN}bob.jpg`,
    ]);
    expect(out[2]).toEqual({ title: "Living Room", imageSrc: `${CDN}living.jpg`, imageAlt: "Living Room — art in a room" });
  });

  it("refuses off-CDN images, ignores non-hero metafields, dedupes and honours the limit", () => {
    const out = rankLifestyleCandidates(
      [
        col("Evil", "https://evil.example/x.jpg"),
        col("No image", null, { hero_image_url: "https://evil.example/hero.jpg", sku: `${CDN}not-a-hero.jpg` }),
        col("A", `${CDN}a.jpg`),
        col("A again", `${CDN}a.jpg?v=2`),
        col("B", `${CDN}b.jpg`),
      ],
      [],
      1,
    );
    expect(out).toEqual([{ title: "A", imageSrc: `${CDN}a.jpg`, imageAlt: "A — art in a room" }]);
  });
});

describe("room-shot vision pass helpers", () => {
  const batch = [0, 1, 2].map((n) => ({ title: `Room ${n}`, imageSrc: `${CDN}r${n}.jpg`, imageAlt: "" }));

  it("labels and thumbnails each image; batches of 12", () => {
    expect(ROOM_SHOT_BATCH).toBe(12);
    expect(roomShotLabel(2, batch[2]!)).toBe("Image 2: Room 2");
    expect(roomShotThumbnail(batch[0]!)).toBe(`${CDN}r0.jpg?width=400`);
  });

  it("keeps fit ≥ 3 room shots, drops unknown indexes and malformed answers", () => {
    expect(roomShotFits(batch, { rooms: [{ n: 0, fit: 2 }, { n: 1, fit: 4 }, { n: 7, fit: 5 }, { n: 1.5, fit: 5 }] })).toEqual([
      { c: batch[1], fit: 4 },
    ]);
    expect(roomShotFits(batch, null)).toEqual([]);
    expect(roomShotFits(batch, { nope: 1 })).toEqual([]);
  });

  it("ranks best fit first and keeps candidate order on ties", () => {
    const [a, b, c] = batch as [typeof batch[0], typeof batch[0], typeof batch[0]];
    expect(rankRoomShots([{ c: a, fit: 3 }, { c: b, fit: 5 }, { c, fit: 3 }])).toEqual([b, a, c]);
    expect(rankRoomShots([{ c: a, fit: 3 }, { c: b, fit: 5 }], 1)).toEqual([b]);
  });
});

describe("compile normalizations", () => {
  const IMG = `${CDN}room.jpg`;
  const base = OfferConceptSchema.parse({
    archetype: "zero-party-quiz",
    title: "Which room?",
    hypothesis: "Room-led curators answer a room question and convert on picks.",
    composition: "split-image",
    imageSrc: IMG,
    imageAlt: "A room",
    incentive: { type: "content" },
    steps: [
      { id: "hook", kind: "hook", blocks: [{ kind: "headline", text: "Which wall?" }, { kind: "cta", label: "Go" }] },
      {
        id: "ask",
        kind: "ask",
        blocks: [
          { kind: "email", cta: "Send" },
          { kind: "consent", text: "Weekly at most. Unsubscribe anytime." },
        ],
      },
      { id: "reward", kind: "reward", blocks: [{ kind: "reward", mode: "message", headline: "Thanks." }] },
    ],
  });

  it("withProgress adds a progress block to every non-reward step of a multi-step concept, once", () => {
    const p = withProgress(base);
    expect(p.steps.map((s) => s.blocks[0]!.kind)).toEqual(["progress", "progress", "reward"]);
    expect(withProgress(p)).toEqual(p);
    const single = { ...base, steps: base.steps.slice(0, 1) };
    expect(withProgress(single)).toBe(single);
  });

  it("withLeadImage moves the concept image to the front of an image-led first step", () => {
    const led = withLeadImage(base);
    expect(led.steps[0]!.blocks[0]).toEqual({ kind: "image", src: IMG, alt: "A room" });
    expect(withLeadImage({ ...base, composition: "editorial-type" })).toEqual({ ...base, composition: "editorial-type" });
  });
});
