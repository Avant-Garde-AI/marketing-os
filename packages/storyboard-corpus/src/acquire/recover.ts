import {
  assessSnapshot,
  corpusSnapshotSchema,
  metricFromRaw,
  type CorpusSnapshot,
} from "./manifest";

export type RecoverySource = {
  shortcode: string;
  accountHandle: string;
  postUrl: string;
  expectedChildren: number;
  metadataCapturedAt: string;
  publishedAt?: string;
  likes?: number | null;
  comments?: number | null;
};

export type ProviderChild = {
  childId: string;
  ordinal: number;
  modality: "image" | "video" | "unknown";
  sourceRef: string;
};

export type ProviderPost = {
  shortcode: string;
  accountHandle: string;
  ownerHandle?: string;
  sourceAttribution?: "owner" | "coauthor";
  children: ProviderChild[];
  /** Durable reference to the provider response that proves child order. */
  orderEvidenceRef?: string;
};

export interface RecoveryProvider {
  fetchPost(source: RecoverySource): Promise<ProviderPost>;
}

export interface MediaMirror {
  /** Mirrors original source media bytes and returns a durable reference and hash. */
  mirror(child: ProviderChild): Promise<{
    objectRef: string;
    checksum: string;
    localPath?: string;
  }>;
}

export type RecoveryResult = {
  snapshot: CorpusSnapshot;
  assessment: ReturnType<typeof assessSnapshot>;
};

/**
 * Per-post recovery with an explicit provider and mirror. No scraped URL is
 * treated as durable media; failed child mirrors remain visible as gaps.
 */
export async function recoverCarousel(
  source: RecoverySource,
  provider: RecoveryProvider,
  mirror: MediaMirror,
  now: () => Date = () => new Date()
): Promise<RecoveryResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(source.shortcode)) throw new Error("source shortcode is invalid");
  if (
    !Number.isSafeInteger(source.expectedChildren) ||
    source.expectedChildren < 2 ||
    source.expectedChildren > 20
  )
    throw new Error("expected carousel child count must be 2–20");
  if (!source.accountHandle.trim() || !source.postUrl.trim())
    throw new Error("source account and post URL are required");
  const expectedUrl = `https://www.instagram.com/p/${source.shortcode}/`;
  if (source.postUrl !== expectedUrl) throw new Error("post URL must match source shortcode");

  const snapshot: CorpusSnapshot = {
    snapshotVersion: "corpus-snapshot-v2",
    source: {
      platform: "instagram",
      postId: `instagram:${source.shortcode}`,
      url: source.postUrl,
      account: source.accountHandle,
      publishedAt: source.publishedAt,
    },
    capture: { metadataCapturedAt: source.metadataCapturedAt, collector: "provider-normalized-v1" },
    media: { expected: [], actual: [] },
    coverage: {
      expectedCount: source.expectedChildren,
      acquiredCount: 0,
      orderingVerified: false,
      modalitiesObserved: [],
      visualSamplesCovered: false,
      fullVisualStreamCovered: false,
      audioCovered: false,
      transcriptCovered: false,
    },
    metrics: {
      likes: metricFromRaw(source.likes),
      comments: metricFromRaw(source.comments),
    },
    scope: { paidOrganic: "organic" },
    identity: {
      canonicalPostId: `instagram:${source.shortcode}`,
      occurrenceAliases: [`${source.accountHandle}:${source.shortcode}`],
    },
    disposition: "incomplete",
    reason: "media-not-recovered",
  };

  let fetched: ProviderPost;
  try {
    fetched = await provider.fetchPost(source);
  } catch {
    snapshot.disposition = "failed";
    snapshot.reason = "provider-fetch-failed";
    return { snapshot: corpusSnapshotSchema.parse(snapshot), assessment: assessSnapshot(snapshot) };
  }
  if (fetched.shortcode !== source.shortcode || fetched.accountHandle !== source.accountHandle) {
    snapshot.disposition = "failed";
    snapshot.reason = "provider-identity-mismatch";
    return { snapshot: corpusSnapshotSchema.parse(snapshot), assessment: assessSnapshot(snapshot) };
  }
  if (fetched.ownerHandle) snapshot.source.ownerAccount = fetched.ownerHandle;
  if (fetched.sourceAttribution) snapshot.source.attribution = fetched.sourceAttribution;
  const children = fetched.children;
  const orderIsValid =
    !!fetched.orderEvidenceRef &&
    children.every(
      (child, index) => child.ordinal === index && !!child.childId && !!child.sourceRef
    ) &&
    new Set(children.map((child) => child.childId)).size === children.length;
  snapshot.media.expected = children.map((child) => ({ ...child }));
  snapshot.coverage.orderingVerified = orderIsValid;
  snapshot.coverage.orderingEvidenceRef = fetched.orderEvidenceRef;
  if (!orderIsValid) {
    snapshot.reason = "provider-order-unverified";
    return { snapshot: corpusSnapshotSchema.parse(snapshot), assessment: assessSnapshot(snapshot) };
  }

  for (const child of children) {
    try {
      const mirrored = await mirror.mirror(child);
      snapshot.media.actual.push({ ...child, ...mirrored, assetRole: "source" });
    } catch {
      // The expected child remains in the snapshot; later recovery can retry it.
    }
  }
  snapshot.capture.mediaCapturedAt = now().toISOString();
  snapshot.coverage.acquiredCount = snapshot.media.actual.length;
  snapshot.coverage.modalitiesObserved = [
    ...new Set(snapshot.media.actual.map((child) => child.modality)),
  ];
  const onlyImages = children.length > 0 && children.every((child) => child.modality === "image");
  snapshot.coverage.visualSamplesCovered =
    onlyImages && snapshot.media.actual.length === children.length;
  snapshot.coverage.fullVisualStreamCovered = snapshot.coverage.visualSamplesCovered;
  const assessment = assessSnapshot(snapshot);
  snapshot.disposition = assessment.status;
  snapshot.reason = assessment.complete
    ? undefined
    : assessment.reasons.join(",") || "visual-coverage-missing";
  return { snapshot: corpusSnapshotSchema.parse(snapshot), assessment: assessSnapshot(snapshot) };
}
