/**
 * Embedder + merge judge over OpenAI-compatible endpoints (spec 35 P2).
 * Same portability rule as `openai-vision`: only baseUrl + model change between
 * a frontier provider, a self-hosted open model, and the hosted Marketing OS plane.
 */
import { extractJsonObject } from "../labeler.js";
import { fetchWithRetry, type RetryOptions } from "./retry.js";
import { MERGE_JUDGE_SYSTEM, mergeJudgePrompt, type Embedder, type MergeJudge, type Verdict } from "../merge.js";
import { AXIS_JUDGE_SYSTEM, axisJudgePrompt, type AxisJudge } from "../axis-merge.js";
import { TAXONOMY_SYSTEM, taxonomyPrompt, type FamilyGrouper } from "../taxonomy.js";

export interface OpenAIEndpointConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  retry?: RetryOptions;
}

async function post(cfg: OpenAIEndpointConfig, path: string, body: unknown): Promise<any> {
  const res = await fetchWithRetry(() => (cfg.fetch ?? fetch)(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
  }), cfg.retry);
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

async function judgeJson(cfg: OpenAIEndpointConfig, system: string, user: string, ids: string[]): Promise<Verdict[]> {
  const d = await post(cfg, "/chat/completions", {
    model: cfg.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw = d?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new Error("merge judge returned no content");
  return parseVerdicts(raw, ids);
}

export function createOpenAIMergeJudge(cfg: OpenAIEndpointConfig): MergeJudge {
  return {
    id: cfg.model,
    judge: (axis, pairs) => judgeJson(cfg, MERGE_JUDGE_SYSTEM, mergeJudgePrompt(axis, pairs), pairs.map((p) => p.id)),
  };
}

export function createOpenAIAxisJudge(cfg: OpenAIEndpointConfig): AxisJudge {
  return {
    id: cfg.model,
    judge: (pairs) => judgeJson(cfg, AXIS_JUDGE_SYSTEM, axisJudgePrompt(pairs), pairs.map((p) => p.id)),
  };
}

/** Groups an axis's values into families (taxonomy.ts). Returns the raw JSON; `parseFamilies` validates it. */
export function createOpenAITaxonomyGrouper(cfg: OpenAIEndpointConfig): FamilyGrouper {
  return {
    id: `${cfg.model}+families@1`,
    async group(input) {
      const d = await post(cfg, "/chat/completions", {
        model: cfg.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: TAXONOMY_SYSTEM },
          { role: "user", content: taxonomyPrompt(input) },
        ],
      });
      const raw = d?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") throw new Error("taxonomy grouper returned no content");
      return raw;
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
