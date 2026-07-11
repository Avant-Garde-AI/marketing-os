// Gemini Deep Research client (spec 22 §4 stage 2, decision: wrap not build).
// Raw Interactions API — POST /v1beta/interactions starts a background run,
// GET /v1beta/interactions/{id} polls it; the final report is the last step's
// text. Uses the same GOOGLE_GENERATIVE_AI_API_KEY as the chat models (spec 16).

const BASE = "https://generativelanguage.googleapis.com/v1beta/interactions";

function apiKey(): string {
  const k = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!k) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required for deep research");
  return k;
}

export type ResearchDepth = "standard" | "max";

export async function startDeepResearch(brief: string, depth: ResearchDepth = "standard"): Promise<{ id: string }> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey() },
    body: JSON.stringify({
      input: brief,
      agent: depth === "max" ? "deep-research-max-preview-04-2026" : "deep-research-preview-04-2026",
      background: true,
      stream: false,
      agent_config: { type: "deep-research", thinking_summaries: "auto" },
      tools: [{ type: "google_search" }, { type: "url_context" }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`deep research start failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("deep research start: no interaction id returned");
  return { id: data.id };
}

export interface ResearchStatus {
  status: "in_progress" | "completed" | "failed" | string;
  report?: string;
  error?: string;
}

export async function getDeepResearch(interactionId: string): Promise<ResearchStatus> {
  const res = await fetch(`${BASE}/${encodeURIComponent(interactionId)}`, {
    headers: { "x-goog-api-key": apiKey() },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`deep research poll failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    status?: string;
    error?: { message?: string } | string;
    steps?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const status = data.status ?? "in_progress";
  if (status === "completed") {
    const last = data.steps?.[data.steps.length - 1];
    const report = last?.content?.map((c) => c.text ?? "").join("") ?? "";
    return { status, report };
  }
  if (status === "failed") {
    const err = typeof data.error === "string" ? data.error : data.error?.message;
    return { status, error: err ?? "unknown error" };
  }
  return { status };
}
