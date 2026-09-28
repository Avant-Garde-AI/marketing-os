/**
 * OfferPlatformClient binding for a self-hosted / client-owned deployment
 * (spec 32 OF0, spec 34) — talks to the platform's own offer endpoints
 * (`/api/offers/surfaces`, `/api/offers/stats`, `/api/offers/reallocate`,
 * and the harness's `/api/offers/audit|design|jobs/:id|audits/latest`) via
 * `MARKETING_OS_API_URL` + a per-tenant `MARKETING_OS_API_KEY`.
 *
 * This is the transport the template's three offer tool files each spoke
 * inline before consolidation; the pooled runtime binds the same seam
 * (`OfferPlatformClient`, packages/skills/offers) to its two-path broker
 * auth instead (service key + `x-mos-tenant-shop`) — see
 * marketing-os-hosted-agents/lib/offers/platform.ts.
 */

import { OfferQuotaError } from "./tools";
import type {
  OfferAuditReport,
  OfferJobState,
  AnyOfferManifest,
  OfferPlatformClient,
  OfferPlatformStatsResponse,
} from "./types";

class OfferPlatformError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_CONFIGURED" | "HTTP" | "NETWORK",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "OfferPlatformError";
  }
}

function apiBase(): string {
  const apiUrl = process.env.MARKETING_OS_API_URL;
  if (!apiUrl) throw new OfferPlatformError("MARKETING_OS_API_URL is not configured.", "NOT_CONFIGURED");
  return apiUrl.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const apiKey = process.env.MARKETING_OS_API_KEY;
  if (!apiKey) throw new OfferPlatformError("MARKETING_OS_API_KEY is not configured.", "NOT_CONFIGURED");
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

async function offerApi<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: init?.method ?? "GET",
    headers: authHeaders(),
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  }).catch((e: unknown) => {
    throw new OfferPlatformError(e instanceof Error ? e.message : "network error", "NETWORK");
  });
  if (!res.ok) {
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { error?: string; retryAfter?: string } | null;
      if (body?.error === "quota") throw new OfferQuotaError(body.retryAfter ?? null);
    }
    throw new OfferPlatformError(`Platform returned ${res.status}`, "HTTP", res.status);
  }
  return (await res.json()) as T;
}

export const offerPlatformClient: OfferPlatformClient = {
  async stageSurface(manifest: AnyOfferManifest, status: "PAUSED" | "ACTIVE") {
    return offerApi("/api/offers/surfaces", { method: "POST", body: { surface: manifest, status } });
  },
  async getStats(surfaceId: string, days: number) {
    return offerApi<OfferPlatformStatsResponse>(
      `/api/offers/stats?surfaceId=${encodeURIComponent(surfaceId)}&days=${days}`,
    );
  },
  async reallocate(surfaceId, mode, opts) {
    return offerApi("/api/offers/reallocate", {
      method: "POST",
      body: { surfaceId, mode, days: opts?.days, winner: opts?.winner },
    });
  },
  async startAudit() {
    return offerApi<{ jobId: string }>("/api/offers/audit", { method: "POST", body: {} });
  },
  async startDesign(goal, constraints) {
    return offerApi<{ jobId: string }>("/api/offers/design", {
      method: "POST",
      body: constraints ? { goal, constraints } : { goal },
    });
  },
  async getJob(jobId) {
    return offerApi<OfferJobState>(`/api/offers/jobs/${encodeURIComponent(jobId)}`);
  },
  async latestAudit() {
    try {
      const body = await offerApi<OfferAuditReport | { report: OfferAuditReport | null } | null>(
        "/api/offers/audits/latest",
      );
      if (body && "report" in body) return body.report;
      return body;
    } catch (err) {
      if (err instanceof OfferPlatformError && err.status === 404) return null;
      throw err;
    }
  },
};

/** Turn any failure into the `unavailable` shape the tools return to the
 * agent — the exact wording the three original tool files each used. */
export function unavailable(err: unknown, what: string): { unavailable: true; reason: string } {
  if (err instanceof OfferPlatformError && err.status === 403) {
    return { unavailable: true, reason: `${what} unavailable: this store's plan does not include it.` };
  }
  if (err instanceof OfferPlatformError) {
    if (err.code === "NOT_CONFIGURED") {
      return { unavailable: true, reason: `${what} unavailable: the platform link is not configured.` };
    }
    return { unavailable: true, reason: `${what} unavailable (${err.status ?? err.code}).` };
  }
  return { unavailable: true, reason: `${what} unavailable: ${err instanceof Error ? err.message : "unknown"}` };
}
