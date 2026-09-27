import { describe, expect, it } from "vitest";

import { recoverCarousel, type MediaMirror, type RecoveryProvider } from "../src/acquire/recover";

const source = {
  shortcode: "abc",
  accountHandle: "artist",
  postUrl: "https://www.instagram.com/p/abc/",
  expectedChildren: 2,
  metadataCapturedAt: "2026-09-01T00:00:00.000Z",
  likes: -1,
  comments: 0,
};
const children = [0, 1].map((ordinal) => ({
  childId: `child-${ordinal}`,
  ordinal,
  modality: "image" as const,
  sourceRef: `provider:child-${ordinal}`,
}));
const provider: RecoveryProvider = {
  fetchPost: async () => ({
    shortcode: "abc",
    accountHandle: "artist",
    children,
    orderEvidenceRef: "provider-run:1",
  }),
};
const mirror: MediaMirror = {
  mirror: async (child) => ({
    objectRef: `gs://recovered/${child.childId}`,
    checksum: "a".repeat(64),
  }),
};

describe("carousel recovery", () => {
  it("admits both source children and preserves unknown engagement", async () => {
    const { snapshot, assessment } = await recoverCarousel(source, provider, mirror);
    expect(assessment).toMatchObject({ status: "ready", complete: true });
    expect(snapshot.media.actual.map((child) => child.childId)).toEqual(["child-0", "child-1"]);
    expect(snapshot.metrics).toEqual({
      likes: { status: "unknown", reason: "sentinel" },
      comments: { status: "measured", value: 0 },
    });
  });

  it("keeps the source artist occurrence distinct from a verified owning coauthor", async () => {
    const collaborative: RecoveryProvider = {
      fetchPost: async () => ({
        shortcode: "abc",
        accountHandle: "artist",
        ownerHandle: "gallery",
        sourceAttribution: "coauthor",
        children,
        orderEvidenceRef: "gs://evidence/collaborative.json",
      }),
    };
    const { snapshot, assessment } = await recoverCarousel(source, collaborative, mirror);
    expect(assessment.complete).toBe(true);
    expect(snapshot.source).toMatchObject({
      account: "artist",
      ownerAccount: "gallery",
      attribution: "coauthor",
    });
    expect(snapshot.identity.occurrenceAliases).toEqual(["artist:abc"]);
  });

  it("passes the source caption beside the snapshot for a later labeled interpretation", async () => {
    const result = await recoverCarousel(
      source,
      {
        fetchPost: async () => ({
          ...(await provider.fetchPost(source)),
          caption: "Artist describes the piece",
        }),
      },
      mirror
    );
    expect(result.caption).toBe("Artist describes the piece");
    expect(result.snapshot).not.toHaveProperty("caption");
  });

  it("does not mirror a provider response for another shortcode", async () => {
    let called = false;
    const result = await recoverCarousel(
      source,
      {
        fetchPost: async () => ({ ...(await provider.fetchPost(source)), shortcode: "different" }),
      },
      {
        mirror: async () => {
          called = true;
          return mirror.mirror(children[0]!);
        },
      }
    );
    expect(result.assessment.status).toBe("failed");
    expect(result.snapshot.reason).toBe("provider-identity-mismatch");
    expect(called).toBe(false);
  });

  it("retains a missing child and a wrong provider count as incomplete", async () => {
    const missing = await recoverCarousel(source, provider, {
      mirror: async (child) => {
        if (child.ordinal === 1) throw new Error("expired tokenized URL");
        return mirror.mirror(child);
      },
    });
    expect(missing.assessment).toMatchObject({
      status: "incomplete",
      reasons: expect.arrayContaining(["media-incomplete"]),
    });
    expect(missing.snapshot.media.expected).toHaveLength(2);
    expect(missing.snapshot.media.actual).toHaveLength(1);
    const wrongCount = await recoverCarousel({ ...source, expectedChildren: 3 }, provider, mirror);
    expect(wrongCount.assessment.reasons).toEqual(
      expect.arrayContaining(["expected-identities-unknown", "media-incomplete"])
    );
  });

  it("does not trust an unordered child list or a cover posing as source media", async () => {
    const unordered = await recoverCarousel(
      source,
      {
        fetchPost: async () => ({
          shortcode: "abc",
          accountHandle: "artist",
          children: [children[1]!, children[0]!],
          orderEvidenceRef: "run",
        }),
      },
      mirror
    );
    expect(unordered.assessment.status).toBe("incomplete");
    expect(unordered.snapshot.media.actual).toHaveLength(0);
  });

  it("keeps mixed video media out of visual extraction until samples exist", async () => {
    const mixed = await recoverCarousel(
      source,
      {
        fetchPost: async () => ({
          shortcode: "abc",
          accountHandle: "artist",
          children: [children[0]!, { ...children[1]!, modality: "video" }],
          orderEvidenceRef: "run",
        }),
      },
      mirror
    );
    expect(mixed.assessment.status).toBe("incomplete");
    expect(mixed.assessment.modalityGaps).toEqual([
      "visual",
      "full-visual-stream",
      "audio",
      "transcript",
    ]);
  });
});
