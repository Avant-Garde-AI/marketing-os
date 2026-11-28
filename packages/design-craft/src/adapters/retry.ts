/**
 * Retry for OpenAI-compatible endpoints: 429 and 5xx are retried with
 * exponential backoff (honoring Retry-After); everything else fails at once.
 * A corpus run is hundreds of calls, so rate limits are expected, not exceptional.
 */
export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  { retries = 5, baseDelayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: RetryOptions = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) return res;
    const after = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
    await res.body?.cancel().catch(() => {});
    await sleep(Math.min(wait, 60_000));
  }
}
