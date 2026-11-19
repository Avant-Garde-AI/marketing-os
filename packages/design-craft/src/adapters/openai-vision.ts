/**
 * VisionModel over any OpenAI-compatible chat-completions endpoint.
 *
 * One adapter covers every stage of spec 35: a frontier VLM as the P2 teacher
 * (Gemini's and most providers' OpenAI-compatible surfaces), our distilled open
 * model served by vLLM or similar as the P3 student, and the hosted Marketing OS
 * endpoint in P6. Only `baseUrl` + `model` change.
 *
 * The API key is read by the caller and passed in. It is never logged or
 * written into label records (the record carries only `model:<id>`).
 */
import type { VisionModel } from "../labeler.js";

export interface OpenAIVisionConfig {
  /** e.g. https://generativelanguage.googleapis.com/v1beta/openai or http://localhost:8000/v1 */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Request timeout in ms (default 120s). */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export function createOpenAIVisionModel(cfg: OpenAIVisionConfig): VisionModel {
  const doFetch = cfg.fetch ?? fetch;
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  return {
    id: cfg.model,
    async complete({ system, text, images }) {
      const content = [
        { type: "text", text },
        ...images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
      ];
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
      });
      if (!res.ok) {
        // Body may echo request details; truncate, and never include headers.
        const body = (await res.text()).slice(0, 500);
        throw new Error(`vision endpoint ${res.status}: ${body}`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const out = data.choices?.[0]?.message?.content;
      if (typeof out !== "string" || !out.trim()) throw new Error("vision endpoint returned no message content");
      return out;
    },
  };
}
