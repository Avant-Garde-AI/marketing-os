// @ts-nocheck
/**
 * Real CriticProvider adapter — a VLM read of the screenshots against the brand
 * persona/principles. Endpoint-configurable (PRD §3): the OSS harness can point
 * at any OpenAI-compatible vision endpoint; the hosted product points at the
 * central GCP serving plane. Loaded only on a live run.
 *
 * When DESIGN_MCP_ENDPOINT is set, callers should instead route conformance
 * through the hosted `validate_design_conformance` and skip this adapter.
 */
import { readFile } from "node:fs/promises";

export function createVlmCritic(config) {
  return {
    critique: async ({ bundle, brand, intent }) => {
      const endpoint = config.criticEndpoint;
      if (!endpoint) {
        throw new Error("DESIGN_CRITIC_ENDPOINT not set — cannot run the real VLM critic.");
      }
      const shot = bundle.screenshots["desktop:above-fold"] || bundle.screenshots["desktop:full"];
      const imageB64 = shot ? (await readFile(shot)).toString("base64") : null;

      const system =
        "You are a commerce design critic. Score how well the rendered page serves the documented " +
        "persona and brand principles. Return strict JSON: " +
        '{"personaFit":{"score":0..1,"notes":[...]},"flags":[{"code","message","severity":"info|warn|error"}]}.';
      const user = [
        `Intent: ${intent}`,
        `Brand: ${brand.brandId} (${brand.category ?? "uncategorized"})`,
        `Persona: ${brand.persona ?? "n/a"}`,
        `Principles:\n- ${(brand.principles || []).join("\n- ")}`,
      ].join("\n");

      const content = [{ type: "text", text: user }];
      if (imageB64) {
        content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${imageB64}` } });
      }

      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.DESIGN_CRITIC_API_KEY ? { authorization: `Bearer ${process.env.DESIGN_CRITIC_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: config.criticModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`Critic endpoint ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw);
      return {
        personaFit: {
          score: clamp01(Number(parsed?.personaFit?.score ?? 0)),
          notes: Array.isArray(parsed?.personaFit?.notes) ? parsed.personaFit.notes : [],
        },
        flags: Array.isArray(parsed?.flags) ? parsed.flags : [],
      };
    },
  };
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
