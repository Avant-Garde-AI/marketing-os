import type { RecoveryProvider, RecoverySource, ProviderPost } from "./recover";

export type ApifyFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type RawResponseWriter = (record: {
  source: RecoverySource;
  response: unknown;
  capturedAt: string;
}) => Promise<string>;

export type ApifyProviderOptions = {
  token: string;
  /** Apify actor id or username/actor-name. */
  actorId?: string;
  /** Maximum items returned by this one-post actor run. */
  maxItems: number;
  /** Apify run charge ceiling in USD for this invocation. */
  maxTotalChargeUsd: number;
  /** Synchronous actor run deadline, independent of the local HTTP timeout. */
  timeoutSeconds?: number;
  writeRawResponse: RawResponseWriter;
  fetch?: ApifyFetch;
  now?: () => Date;
};

type ApifyChild = {
  id?: unknown;
  type?: unknown;
  displayUrl?: unknown;
  videoUrl?: unknown;
};

type ApifyPost = {
  shortCode?: unknown;
  ownerUsername?: unknown;
  coauthorProducers?: unknown;
  caption?: unknown;
  type?: unknown;
  childPosts?: unknown;
};

const API_BASE = "https://api.apify.com/v2";

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function accountMatches(actual: unknown, expected: string): boolean {
  if (!nonempty(actual)) return false;
  return (
    actual.trim().replace(/^@/, "").toLowerCase() ===
    expected.trim().replace(/^@/, "").toLowerCase()
  );
}

function modalityFor(type: unknown): "image" | "video" {
  if (typeof type !== "string") throw new Error("Apify child media type is missing");
  const normalized = type.toLowerCase();
  if (normalized === "image") return "image";
  if (normalized === "video") return "video";
  throw new Error("Apify child media type is unsupported");
}

function mediaUrl(value: unknown): string {
  if (!nonempty(value)) throw new Error("Apify child source media URL is missing");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Apify child source media URL is invalid");
  }
  if (url.protocol !== "https:" || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname))
    throw new Error("Apify child source media host is unsupported");
  return url.toString();
}

/** A bounded, one-post adapter for Apify's Instagram Scraper actor. */
export function createApifyRecoveryProvider(options: ApifyProviderOptions): RecoveryProvider {
  if (!nonempty(options.token)) throw new Error("Apify token is required");
  if (!Number.isSafeInteger(options.maxItems) || options.maxItems !== 1)
    throw new Error("Apify recovery maxItems must be exactly 1");
  if (
    !Number.isFinite(options.maxTotalChargeUsd) ||
    options.maxTotalChargeUsd <= 0 ||
    options.maxTotalChargeUsd > 1
  )
    throw new Error("Apify recovery maxTotalChargeUsd must be above 0 and at most 1");
  if (typeof options.writeRawResponse !== "function")
    throw new Error("A durable raw-response writer is required for order evidence");

  const actorId = (options.actorId ?? "apify/instagram-scraper").trim();
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(actorId))
    throw new Error("Apify actor id must be owner/name");
  const timeoutSeconds = options.timeoutSeconds ?? 120;
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 300)
    throw new Error("Apify timeoutSeconds must be 30–300");
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    async fetchPost(source: RecoverySource): Promise<ProviderPost> {
      if (
        !/^[A-Za-z0-9_-]+$/.test(source.shortcode) ||
        source.postUrl !== `https://www.instagram.com/p/${source.shortcode}/` ||
        !Number.isSafeInteger(source.expectedChildren) ||
        source.expectedChildren < 2 ||
        source.expectedChildren > 20
      )
        throw new Error("Apify recovery source must be one exact carousel post");
      const endpoint = new URL(
        `${API_BASE}/acts/${actorId.replace(/\//g, "~")}/run-sync-get-dataset-items`
      );
      endpoint.searchParams.set("maxItems", String(options.maxItems));
      endpoint.searchParams.set("maxTotalChargeUsd", String(options.maxTotalChargeUsd));
      endpoint.searchParams.set("timeout", String(timeoutSeconds));

      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            directUrls: [source.postUrl],
            resultsType: "posts",
            resultsLimit: 1,
          }),
          signal: AbortSignal.timeout((timeoutSeconds + 10) * 1000),
        });
      } catch {
        throw new Error("Apify request failed");
      }
      if (!response.ok) throw new Error(`Apify request failed with HTTP ${response.status}`);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Apify response was not valid JSON");
      }
      if (!Array.isArray(payload) || payload.length !== 1)
        throw new Error("Apify must return exactly one post for the requested URL");
      if (!payload[0] || typeof payload[0] !== "object")
        throw new Error("Apify returned an invalid post record");
      const post = payload[0] as ApifyPost;
      if (post.shortCode !== source.shortcode)
        throw new Error("Apify post identity does not match the requested source");
      const ownerMatches = accountMatches(post.ownerUsername, source.accountHandle);
      const coauthorMatches =
        Array.isArray(post.coauthorProducers) &&
        post.coauthorProducers.some(
          (coauthor) =>
            coauthor &&
            typeof coauthor === "object" &&
            accountMatches((coauthor as { username?: unknown }).username, source.accountHandle)
        );
      if (!nonempty(post.ownerUsername) || (!ownerMatches && !coauthorMatches))
        throw new Error("Apify post identity does not match owner or coauthor evidence");
      if (post.type !== "Sidecar") throw new Error("Apify post is not a carousel");
      if (!Array.isArray(post.childPosts) || post.childPosts.length !== source.expectedChildren)
        throw new Error("Apify child count does not match source metadata");

      const children = (post.childPosts as ApifyChild[]).map((child, ordinal) => {
        if (!nonempty(child.id)) throw new Error("Apify child id is missing");
        const modality = modalityFor(child.type);
        const sourceRef = mediaUrl(modality === "video" ? child.videoUrl : child.displayUrl);
        return {
          childId: child.id.trim(),
          ordinal,
          modality,
          sourceRef,
        };
      });
      if (new Set(children.map((child) => child.childId)).size !== children.length)
        throw new Error("Apify child ids are not unique");

      let orderEvidenceRef: string;
      try {
        orderEvidenceRef = await options.writeRawResponse({
          source,
          response: payload,
          capturedAt: now().toISOString(),
        });
      } catch {
        throw new Error("Apify raw response could not be durably recorded");
      }
      if (!nonempty(orderEvidenceRef))
        throw new Error("Apify raw-response writer did not return a durable evidence reference");

      return {
        shortcode: source.shortcode,
        accountHandle: source.accountHandle,
        ownerHandle: post.ownerUsername.trim(),
        sourceAttribution: ownerMatches ? "owner" : "coauthor",
        caption: nonempty(post.caption) ? post.caption : undefined,
        children,
        orderEvidenceRef: orderEvidenceRef.trim(),
      };
    },
  };
}
