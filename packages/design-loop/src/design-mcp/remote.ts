// @ts-nocheck
/**
 * RemoteDesignMcp — talks to the hosted Design MCP (PRD §4.1) over the MCP
 * Streamable HTTP transport. Loaded only when DESIGN_MCP_ENDPOINT is set; uses
 * @modelcontextprotocol/sdk (optional dep). Not typechecked/tested in the core
 * build — exercised against the live knowledge plane.
 */
import { assertAbstracted } from "./types.js";

export async function createRemoteDesignMcp(config) {
  const endpoint = config.designMcpEndpoint;
  if (!endpoint) throw new Error("DESIGN_MCP_ENDPOINT not set — cannot create remote Design MCP client.");

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

  const client = new Client({ name: "design-loop", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);

  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res?.content?.find?.((c) => c.type === "text")?.text ?? "{}";
    return JSON.parse(text);
  };

  return {
    getCategoryConventions: (input) => call("get_category_conventions", input),
    queryDesignPrinciples: (input) => call("query_design_principles", input),
    retrieveReferencePatterns: async (input) =>
      assertAbstracted(await call("retrieve_reference_patterns", input)),
    recommendDesignTokens: (input) => call("recommend_design_tokens", input),
    validateDesignConformance: (input) =>
      call("validate_design_conformance", {
        capture_bundle_ref: { location: input.captureBundleRef.location, manifest: input.captureBundleRef.manifest },
        brand_design_ref: input.brandDesignRef,
        brand: input.brand,
        intent: input.intent,
        wcag: input.wcag,
      }),
  };
}
