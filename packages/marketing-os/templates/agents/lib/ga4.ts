/**
 * GA4 client for Marketing OS agents.
 *
 * Access tokens are resolved through the Marketing OS credential broker: the
 * deployment holds only its deployment key (MARKETING_OS_DEPLOYMENT_KEY) and
 * the platform URL (MARKETING_OS_API_URL). The broker refreshes the store's
 * Google token (stored in Vault, behind the Shopify-app OAuth connection) and
 * returns a short-lived access token plus the selected GA4 property id.
 *
 * Auth resolves in order:
 *   1. The broker, when MARKETING_OS_API_URL + MARKETING_OS_DEPLOYMENT_KEY are set
 *   2. A raw GA4_ACCESS_TOKEN + GA4_PROPERTY_ID (local dev / manual setup)
 */

const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
const BROKER_TTL_SAFETY_MS = 60 * 1000; // refresh 60s before expiry

export class GA4ReconnectRequiredError extends Error {
  constructor(
    message: string,
    public readonly reconnectUrl?: string
  ) {
    super(message);
    this.name = "GA4ReconnectRequiredError";
  }
}

export class GA4ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "GA4ApiError";
  }
}

interface BrokerToken {
  accessToken: string;
  propertyId: string | null;
  expiresAt: number;
}

let _cached: BrokerToken | null = null;

async function fetchBrokerToken(): Promise<BrokerToken> {
  const apiUrl = process.env.MARKETING_OS_API_URL!;
  const deploymentKey = process.env.MARKETING_OS_DEPLOYMENT_KEY!;

  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/broker/token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deploymentKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider: "google", product: "ga4" }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string; message?: string; reconnect_url?: string; connect_url?: string }
      | null;
    if (body?.error === "RECONNECT_REQUIRED" || body?.error === "PROVIDER_NOT_CONNECTED") {
      throw new GA4ReconnectRequiredError(
        body.message ?? "Google must be reconnected.",
        body.reconnect_url ?? body.connect_url
      );
    }
    throw new GA4ApiError(
      `Marketing OS broker error: ${res.status} ${res.statusText}`,
      res.status,
      body
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    context?: { ga4_default_property_id?: string };
  };

  return {
    accessToken: data.access_token,
    propertyId: data.context?.ga4_default_property_id ?? null,
    expiresAt: Date.now() + data.expires_in * 1000 - BROKER_TTL_SAFETY_MS,
  };
}

async function resolveToken(): Promise<BrokerToken> {
  // Broker path
  if (process.env.MARKETING_OS_API_URL && process.env.MARKETING_OS_DEPLOYMENT_KEY) {
    if (_cached && Date.now() < _cached.expiresAt) return _cached;
    _cached = await fetchBrokerToken();
    return _cached;
  }
  // Raw-token fallback (local dev)
  if (process.env.GA4_ACCESS_TOKEN) {
    return {
      accessToken: process.env.GA4_ACCESS_TOKEN,
      propertyId: process.env.GA4_PROPERTY_ID ?? null,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
  }
  throw new GA4ReconnectRequiredError(
    "No GA4 credentials. Connect Google in the Shopify admin under Marketing OS → Integrations."
  );
}

/** Resolve the GA4 property id: explicit arg → broker context → env. */
async function resolveProperty(explicit?: string): Promise<string> {
  if (explicit) return explicit.replace(/^properties\//, "");
  const token = await resolveToken();
  const id = token.propertyId ?? process.env.GA4_PROPERTY_ID ?? null;
  if (!id) {
    throw new GA4ReconnectRequiredError(
      "No GA4 property selected. Pick one in the Shopify admin under Marketing OS → Integrations."
    );
  }
  return id.replace(/^properties\//, "");
}

async function adminGet<T>(path: string): Promise<T> {
  const { accessToken } = await resolveToken();
  const res = await fetch(`${ADMIN_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new GA4ApiError(`GA4 Admin API error: ${res.status} ${res.statusText}`, res.status, body);
  }
  return res.json() as Promise<T>;
}

async function dataPost<T>(propertyId: string, method: string, payload: unknown): Promise<T> {
  const { accessToken } = await resolveToken();
  const res = await fetch(`${DATA_BASE}/properties/${propertyId}:${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new GA4ApiError(`GA4 Data API error: ${res.status} ${res.statusText}`, res.status, body);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public client surface (official-parity operations)
// ---------------------------------------------------------------------------

export const ga4 = {
  /** The resolved default property id for this store. */
  getDefaultPropertyId: (explicit?: string) => resolveProperty(explicit),

  getAccountSummaries: () =>
    adminGet<{ accountSummaries?: unknown[] }>("accountSummaries?pageSize=200"),

  getPropertyDetails: async (propertyId?: string) => {
    const id = await resolveProperty(propertyId);
    return adminGet<Record<string, unknown>>(`properties/${id}`);
  },

  listGoogleAdsLinks: async (propertyId?: string) => {
    const id = await resolveProperty(propertyId);
    return adminGet<{ googleAdsLinks?: unknown[] }>(`properties/${id}/googleAdsLinks`);
  },

  getCustomDimensionsAndMetrics: async (propertyId?: string) => {
    const id = await resolveProperty(propertyId);
    const [dims, mets] = await Promise.all([
      adminGet<{ customDimensions?: unknown[] }>(`properties/${id}/customDimensions`),
      adminGet<{ customMetrics?: unknown[] }>(`properties/${id}/customMetrics`),
    ]);
    return {
      customDimensions: dims.customDimensions ?? [],
      customMetrics: mets.customMetrics ?? [],
    };
  },

  runReport: async (payload: Record<string, unknown>, propertyId?: string) => {
    const id = await resolveProperty(propertyId);
    return dataPost<Record<string, unknown>>(id, "runReport", payload);
  },

  runRealtimeReport: async (payload: Record<string, unknown>, propertyId?: string) => {
    const id = await resolveProperty(propertyId);
    return dataPost<Record<string, unknown>>(id, "runRealtimeReport", payload);
  },
};
