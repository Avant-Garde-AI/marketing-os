// @ts-nocheck
/**
 * Real Implementer adapter — the code-writing step of the deep agent. On a live
 * run the design-code agent edits Liquid in the workspace toward the intent,
 * informed by the prior iteration's critique.
 *
 * This default adapter asks an OpenAI-compatible endpoint for a set of file
 * writes and applies them. In the hosted product the implementer is the Mastra
 * agent in the harness (injected via the providers seam) rather than this
 * adapter. It also enforces the asset-boundary refusal (PRD §4.4).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ASSET_BOUNDARY = /\b(recreate|copy|clone|replicate)\b.*\b(hero|page|site|store|brand)\b/i;

export function createLlmImplementer(config) {
  return {
    implement: async ({ intent, brand, scope, iteration, priorCritique, workspaceDir }) => {
      if (ASSET_BOUNDARY.test(intent)) {
        return {
          touchedFiles: [],
          note: "asset-boundary refusal",
          refusal: { reason: "Request would reproduce another brand's assets/copy — abstaining (PRD §4.4)." },
        };
      }

      const endpoint = config.criticEndpoint;
      if (!endpoint) {
        throw new Error("No implementer endpoint configured (DESIGN_CRITIC_ENDPOINT).");
      }

      const critiqueNote = priorCritique
        ? `Prior critique (address these): ${JSON.stringify(priorCritique.flags)} ; persona notes: ${priorCritique.personaFit.notes.join("; ")}`
        : "First pass.";
      const system =
        "You are a maniacal, on-brand Shopify theme implementer. Edit Liquid/sections/blocks/tokens to " +
        "achieve the intent while adhering to the brand. Never use dark patterns. Return strict JSON: " +
        '{"files":[{"path","content"}],"note":""}.';
      const user = [
        `Intent: ${intent}`,
        `Iteration: ${iteration}`,
        `Scope: pages=${scope.pages.join(",")} sections=${scope.sections.join(",")}`,
        `Brand tokens: ${JSON.stringify(brand.tokens)}`,
        `Principles: ${(brand.principles || []).join(" | ")}`,
        critiqueNote,
      ].join("\n");

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
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`Implementer endpoint ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{"files":[]}');
      const files = Array.isArray(parsed.files) ? parsed.files : [];
      const touched = [];
      for (const f of files) {
        if (!f?.path || typeof f.content !== "string") continue;
        const abs = join(workspaceDir, f.path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, f.content);
        touched.push(f.path);
      }
      return { touchedFiles: touched, note: parsed.note ?? `iteration ${iteration} edits` };
    },
  };
}
