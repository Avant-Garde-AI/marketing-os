import { describe, expect, it } from "vitest";
import {
  calendarPath,
  parseCalendar,
  parsePost,
  parseStrategy,
  postPath,
  serializeCalendar,
  serializePost,
  serializeStrategy,
} from "../src/artifacts";
import type { SocialCalendar, SocialPost, SocialStrategy } from "../src/types";

// ---------------------------------------------------------------------------
// Arthaus-flavored fixtures
// ---------------------------------------------------------------------------

const arthausStrategy: SocialStrategy = {
  channels: [
    { channel: "instagram", register: "gallery-editorial", cadencePerWeek: 3 },
    { channel: "pinterest", register: "collector-curatorial", cadencePerWeek: 2 },
  ],
  pillars: [
    { name: "artist-stories", messagingRef: "messaging.pillar.artist_first", weight: 3 },
    { name: "collecting-guides", messagingRef: "messaging.pillar.demystify_collecting", weight: 2 },
    { name: "new-arrivals", messagingRef: "messaging.pillar.living_collection", weight: 1 },
  ],
  seasonalArcs: [
    {
      name: "fall-salon",
      months: ["2026-09", "2026-10"],
      description: "Fall salon season — studio visits and new-collector onboarding.",
    },
  ],
  body: [
    "## Rationale",
    "",
    "Arthaus runs social as a gallery program, not a feed. Instagram carries the",
    "editorial register from brand.md §11; Pinterest serves the collector planning",
    "long-tail. Pillars mirror the messaging framework, weighted toward artist",
    "stories — the brand's differentiation is the artist relationship.",
  ].join("\n"),
};

const arthausCalendar: SocialCalendar = {
  month: "2026-09",
  status: "proposed",
  slots: [
    {
      slot: "2026-09-01",
      channel: "instagram",
      pillar: "artist-stories",
      intent: "messaging.pillar.artist_first",
      postId: "2026-09-ig-001",
      status: "approved",
    },
    {
      slot: "2026-09-03",
      channel: "instagram",
      pillar: "collecting-guides",
      intent: "feature: Marisol Vega — Terra Series",
      postId: null,
      status: "planned",
    },
    {
      slot: "2026-09-04",
      channel: "pinterest",
      pillar: "new-arrivals",
      intent: "messaging.pillar.living_collection",
      postId: "2026-09-pin-001",
      status: "proposed",
    },
  ],
  notes: "September opens the fall salon arc — front-load studio-visit content.",
};

const arthausPost: SocialPost = {
  id: "2026-09-ig-001",
  channel: "instagram",
  scheduledAt: "2026-09-01T16:00:00Z",
  copy: "In Marisol Vega's studio, the Terra Series begins as riverbed clay — pressed, fired, and glazed into fields of ochre. Meet the artist behind September's opening wall.",
  copyFormulaRef: "brand.md#art-description-formula",
  assetRefs: [
    "social/posts/2026-09-ig-001/assets/hero.png",
    "social/posts/2026-09-ig-001/assets/detail-01.png",
  ],
  targetLink: "https://myarthaus.com/collections/marisol-vega-terra-series",
  provenance: [
    { claim: "Terra Series is September's featured collection", origin: "owner" },
    { claim: "Terra Series pieces are top movers over the last 30 days", origin: "data" },
    { claim: "Copy instantiates the art description formula", origin: "agent" },
  ],
  status: "approved",
  body: [
    "Opens the fall-salon arc with the artist-first pillar. The semantic layer",
    "shows Terra Series in the top movers; the studio-visit frame follows the",
    "gallery-editorial register for Instagram.",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// strategy.md
// ---------------------------------------------------------------------------

describe("social/strategy.md", () => {
  it("round-trips parse(serialize(strategy))", () => {
    expect(parseStrategy(serializeStrategy(arthausStrategy))).toEqual(arthausStrategy);
  });

  it("round-trips without optional seasonalArcs", () => {
    const { seasonalArcs: _arcs, ...rest } = arthausStrategy;
    const minimal: SocialStrategy = { ...rest };
    expect(parseStrategy(serializeStrategy(minimal))).toEqual(minimal);
  });

  it("parses a hand-written document", () => {
    const raw = [
      "---",
      "channels:",
      "  - channel: instagram",
      "    register: gallery-editorial",
      "    cadencePerWeek: 3",
      "pillars:",
      "  - name: artist-stories",
      "    messagingRef: messaging.pillar.artist_first",
      "    weight: 3",
      "---",
      "",
      "Prose rationale here.",
      "",
    ].join("\n");
    const parsed = parseStrategy(raw);
    expect(parsed.channels).toHaveLength(1);
    expect(parsed.channels[0]).toEqual({
      channel: "instagram",
      register: "gallery-editorial",
      cadencePerWeek: 3,
    });
    expect(parsed.body).toBe("Prose rationale here.");
  });

  it("rejects a document without front matter", () => {
    expect(() => parseStrategy("just prose")).toThrow(/front matter/);
  });

  it("rejects invalid cadence", () => {
    const bad = serializeStrategy(arthausStrategy).replace("cadencePerWeek: 3", "cadencePerWeek: 0");
    expect(() => parseStrategy(bad)).toThrow(/cadencePerWeek/);
  });
});

// ---------------------------------------------------------------------------
// calendar/{YYYY-MM}.md
// ---------------------------------------------------------------------------

describe("social/calendar/{YYYY-MM}.md", () => {
  it("round-trips parse(serialize(calendar))", () => {
    expect(parseCalendar(serializeCalendar(arthausCalendar))).toEqual(arthausCalendar);
  });

  it("round-trips without notes and with empty slots", () => {
    const empty: SocialCalendar = { month: "2026-10", status: "proposed", slots: [] };
    expect(parseCalendar(serializeCalendar(empty))).toEqual(empty);
  });

  it("serializes unassigned postId as an em-dash cell and parses it back to null", () => {
    const md = serializeCalendar(arthausCalendar);
    expect(md).toContain("| — |");
    const back = parseCalendar(md);
    expect(back.slots[1]?.postId).toBeNull();
  });

  it("parses '-' as an unassigned postId too", () => {
    const md = serializeCalendar(arthausCalendar).replace("| — |", "| - |");
    expect(parseCalendar(md).slots[1]?.postId).toBeNull();
  });

  it("rejects a non-ISO slot date", () => {
    const md = serializeCalendar(arthausCalendar).replace("2026-09-01", "Sept 1");
    expect(() => parseCalendar(md)).toThrow(/ISO date/);
  });

  it("rejects an unexpected table header", () => {
    const md = serializeCalendar(arthausCalendar).replace("| slot |", "| when |");
    expect(() => parseCalendar(md)).toThrow(/unexpected table header/);
  });

  it("rejects a bad month in front matter", () => {
    const md = serializeCalendar(arthausCalendar).replace("month: 2026-09", "month: 2026-13");
    expect(() => parseCalendar(md)).toThrow(/YYYY-MM/);
  });

  it("builds canonical calendar paths", () => {
    expect(calendarPath("2026-09")).toBe("social/calendar/2026-09.md");
    expect(() => calendarPath("2026-9")).toThrow(/YYYY-MM/);
  });
});

// ---------------------------------------------------------------------------
// posts/{id}/post.md
// ---------------------------------------------------------------------------

describe("social/posts/{id}/post.md", () => {
  it("round-trips parse(serialize(post))", () => {
    expect(parsePost(serializePost(arthausPost))).toEqual(arthausPost);
  });

  it("round-trips a minimal proposed post (no schedule, no formula ref, no assets)", () => {
    const minimal: SocialPost = {
      id: "2026-10-pin-004",
      channel: "pinterest",
      copy: "How to hang a salon wall: the Arthaus guide to grouping works you love.",
      assetRefs: [],
      targetLink: "https://myarthaus.com/editorial/salon-wall-guide",
      provenance: [{ claim: "Guide topic proposed from the collecting-guides pillar", origin: "agent" }],
      status: "proposed",
      body: "Fills the collecting-guides pillar for week 2; editorial destination, evergreen.",
    };
    expect(parsePost(serializePost(minimal))).toEqual(minimal);
  });

  it("preserves multiline copy through YAML", () => {
    const post: SocialPost = {
      ...arthausPost,
      copy: "Line one of the caption.\n\nLine two — with an em-dash, \"quotes\", and: colons.",
    };
    expect(parsePost(serializePost(post)).copy).toBe(post.copy);
  });

  it("rejects an invalid status", () => {
    const md = serializePost(arthausPost).replace("status: approved", "status: yolo");
    expect(() => parsePost(md)).toThrow(/status/);
  });

  it("rejects an invalid provenance origin", () => {
    const md = serializePost(arthausPost).replace("origin: data", "origin: vibes");
    expect(() => parsePost(md)).toThrow(/origin/);
  });

  it("builds canonical post paths and rejects path-unsafe ids", () => {
    expect(postPath("2026-09-ig-001")).toBe("social/posts/2026-09-ig-001/post.md");
    expect(() => postPath("../evil")).toThrow(/invalid post id/);
  });
});
