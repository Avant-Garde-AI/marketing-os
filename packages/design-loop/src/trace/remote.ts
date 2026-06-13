// @ts-nocheck
/**
 * Remote trace sink — POSTs de-identified traces to the knowledge-plane
 * ingestion endpoint, where the de-id boundary is re-applied server-side
 * (PRD §5). Loaded only when DESIGN_TRACE_ENDPOINT is configured.
 */
export function createRemoteTraceSink(config) {
  const endpoint = config.traceEndpoint;
  const apiKey = process.env.DESIGN_TRACE_API_KEY;
  return {
    emit: async (trace) => {
      if (!endpoint) throw new Error("DESIGN_TRACE_ENDPOINT not set — cannot emit trace.");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(trace),
      });
      if (!res.ok) throw new Error(`trace ingestion ${res.status}: ${await res.text()}`);
    },
  };
}
