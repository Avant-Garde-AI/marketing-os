#!/usr/bin/env node
/**
 * design-conversion-mcp: run the Design Conversion MCP locally over stdio.
 *
 *   claude mcp add design-conversion -e DESIGN_CONVERSION_API_KEY=… -- npx -y @avant-garde/design-conversion-mcp
 *
 * Env (all optional; without a key the audit tools explain how to enable them):
 *   DESIGN_CONVERSION_API_KEY   key for the vision endpoint (falls back to GEMINI_API_KEY)
 *   DESIGN_CONVERSION_BASE_URL  any OpenAI-compatible endpoint (default: Gemini's)
 *   DESIGN_CONVERSION_MODEL     vision model id (default: gemini-3.1-pro-preview, the dataset's teacher)
 * Flags:
 *   --vocab <path> --benchmarks <path> [--taxonomy <path>] [--labels <path>]   use your own dataset
 *   --http <port>                                         serve stateless HTTP on localhost instead of stdio
 *   --allow-private-urls                                  allow auditing localhost / dev themes
 *   --no-capture                                          never launch a browser
 */
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { createOpenAIVisionModel } from "@avant-garde/design-craft";
import { capturePage } from "./capture.js";
import { bundledDatasetPaths, loadDataset } from "./data.js";
import { createDesignConversionServer } from "./server.js";
import { createHttpHandler, serveStdio } from "./transports.js";

const GEMINI_OPENAI = "https://generativelanguage.googleapis.com/v1beta/openai";

async function main() {
  const { values: a } = parseArgs({
    options: {
      vocab: { type: "string" },
      benchmarks: { type: "string" },
      labels: { type: "string" },
      taxonomy: { type: "string" },
      http: { type: "string" },
      "allow-private-urls": { type: "boolean", default: false },
      "no-capture": { type: "boolean", default: false },
    },
  });
  const paths = a.vocab || a.benchmarks
    ? { vocabulary: a.vocab ?? bundledDatasetPaths().vocabulary, benchmarks: a.benchmarks ?? bundledDatasetPaths().benchmarks, taxonomy: a.taxonomy, labels: a.labels }
    : bundledDatasetPaths();
  const data = await loadDataset(paths);
  const apiKey = process.env.DESIGN_CONVERSION_API_KEY ?? process.env.GEMINI_API_KEY;
  const baseUrl = process.env.DESIGN_CONVERSION_BASE_URL ?? GEMINI_OPENAI;
  // A custom endpoint (e.g. a local vLLM) may need no key; the default Gemini endpoint does.
  const vision = apiKey || process.env.DESIGN_CONVERSION_BASE_URL
    ? createOpenAIVisionModel({ baseUrl, model: process.env.DESIGN_CONVERSION_MODEL ?? "gemini-3.1-pro-preview", ...(apiKey ? { apiKey } : {}) })
    : undefined;
  const server = createDesignConversionServer({
    ...data,
    ...(vision ? { vision } : {}),
    ...(a["no-capture"] ? {} : { capture: capturePage }),
    allowPrivateUrls: a["allow-private-urls"],
    deployment: "local",
  });
  process.stderr.write(`design-conversion-mcp: ${data.benchmarks.source.brands} brands, ${data.benchmarks.vocabularyRef}; vision ${vision ? "on" : "off (set DESIGN_CONVERSION_API_KEY)"}\n`);

  if (a.http) {
    const handler = createHttpHandler(server);
    const port = Number(a.http);
    createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const r = await handler(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    }).listen(port, "127.0.0.1", () => process.stderr.write(`listening on http://127.0.0.1:${port}/mcp\n`));
    return;
  }
  await serveStdio(server);
}

main().catch((e) => {
  process.stderr.write(`design-conversion-mcp failed: ${(e as Error).message}\n`);
  process.exit(1);
});
