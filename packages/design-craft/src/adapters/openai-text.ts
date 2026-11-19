/**
 * Embedder + merge judge over OpenAI-compatible endpoints (spec 35 P2).
 * Same portability rule as `openai-vision`: only baseUrl + model change between
 * a frontier provider, a self-hosted open model, and the hosted Marketing OS plane.
 */
import { extractJsonObject } from "../labeler.js";
import { MERGE_JUDGE_SYSTEM, mergeJudgePrompt, type Embedder, type MergeJudge, type Verdict } from "../merge.js";

export interface OpenAIEndpointConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

async function post(cfg: OpenAIEndpointConfig, path: string, body: unknown): Promise<any> {
  const res = await (cfg.fetch ?? fetch)(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

export function createOpenAIEmbedder(cfg: OpenAIEndpointConfig & { batchSize?: number }): Embedder {
  const batch = cfg.batchSize ?? 100; // Gemini's OpenAI surface caps a request at 100 inputs.
  return {
    id: cfg.model,
    async embed(texts) {
      const out: number[][] = [];
      for (let o = 0; o < texts.length; o += batch) {
        const d = await post(cfg, "/embeddings", { model: cfg.model, input: texts.slice(o, o + batch) });
        const rows = (d?.data ?? []) as { index?: number; embedding: number[] }[];
        rows.sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
        out.push(...rows.map((r) => r.embedding));
      }
      return out;
    },
  };
}

export function createOpenAIMergeJudge(cfg: OpenAIEndpointConfig): MergeJudge {
  return {
    id: cfg.model,
    async judge(axis, pairs) {
      const d = await post(cfg, "/chat/completions", {
        model: cfg.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: MERGE_JUDGE_SYSTEM },
          { role: "user", content: mergeJudgePrompt(axis, pairs) },
        ],
      });
      const raw = d?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") throw new Error("merge judge returned no content");
      return parseVerdicts(raw, pairs.map((p) => p.id));
    },
  };
}

/** Parse judge output. Unknown ids are ignored; missing ids get no verdict (treated as reject). */
export function parseVerdicts(raw: string, ids: string[]): Verdict[] {
  const parsed = extractJsonObject(raw) as { verdicts?: unknown };
  const want = new Set(ids);
  const out: Verdict[] = [];
  for (const x of Array.isArray(parsed.verdicts) ? parsed.verdicts : []) {
    const id = String((x as any)?.id ?? "");
    if (!want.has(id)) continue;
    // Only a literal `true` merges. Strings like "yes" or "probably" do not.
    out.push({ id, same: (x as any).same === true, reason: typeof (x as any).reason === "string" ? (x as any).reason : undefined });
  }
  return out;
}
