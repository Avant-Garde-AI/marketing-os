// agents/src/mastra/tools/brand-design.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  draftBrandDesign,
  serializeBrandDesign,
  parseBrandDesign,
  elicitedPersona,
  neurographPersonaStub,
  MockDesignKnowledge,
  DEFAULT_BRAND_DESIGN_PATH,
  type DesignKnowledge,
} from "@marketing-os/design-loop";

/**
 * Brand-definition tools for the guided onboarding flow (PRD §1 Phase A).
 *
 * `draft-brand-design` produces an MCP-grounded first pass for the owner to
 * react to; the agent co-edits the markdown with the owner, then commits the
 * agreed version with `commit-brand-design`. Generated-with-the-human: the
 * commit step is explicit, never silent.
 *
 * The Design MCP defaults to the in-process mock until DESIGN_MCP_ENDPOINT is
 * configured; the NeuroGraph persona path is a stub until Phase 5 wires the
 * NeuroGraph MCP.
 */
function getDesignKnowledge(): DesignKnowledge {
  // Swap to the RemoteDesignMcp client when DESIGN_MCP_ENDPOINT is set.
  return new MockDesignKnowledge();
}

const draftBrandDesignTool = createTool({
  id: "draft-brand-design",
  description:
    "Produce a first-pass Brand Conversion Document (brand-design.md), grounded in " +
    "category conventions from the Design MCP and the target persona. Present the " +
    "returned markdown to the owner and refine it together before committing.",
  inputSchema: z.object({
    brandId: z.string().describe("Brand/store identifier"),
    category: z.string().describe("Shopify taxonomy node for the store"),
    neurographPersonaRef: z
      .string()
      .optional()
      .describe("PDO persona ref@version if NeuroGraph is connected; omit to elicit one"),
    storeName: z.string().optional(),
  }),
  outputSchema: z.object({
    markdown: z.string(),
    personaSource: z.enum(["elicited", "neurograph"]),
  }),
  execute: async (inputData) => {
    const persona = inputData.neurographPersonaRef
      ? neurographPersonaStub(inputData.neurographPersonaRef)
      : elicitedPersona;
    const doc = await draftBrandDesign({
      brandId: inputData.brandId,
      category: inputData.category,
      now: () => new Date().toISOString(),
      knowledge: getDesignKnowledge(),
      persona,
      storeSignals: inputData.storeName ? { name: inputData.storeName } : undefined,
    });
    return { markdown: serializeBrandDesign(doc), personaSource: doc.persona.source };
  },
});

const commitBrandDesignTool = createTool({
  id: "commit-brand-design",
  description:
    "Commit the agreed brand-design.md to the client repo. Validates the markdown " +
    "before committing. Use only after the owner has approved the content.",
  inputSchema: z.object({
    markdown: z.string().describe("The final, owner-approved brand-design.md content"),
    path: z.string().optional().describe(`Repo path (default: ${DEFAULT_BRAND_DESIGN_PATH})`),
    message: z.string().optional(),
  }),
  outputSchema: z.object({
    path: z.string(),
    commitUrl: z.string(),
    version: z.string(),
  }),
  execute: async (inputData) => {
    // Validate by round-tripping through the parser — refuses malformed docs.
    const doc = parseBrandDesign(inputData.markdown);
    const path = inputData.path ?? DEFAULT_BRAND_DESIGN_PATH;
    const message = inputData.message ?? `chore(brand): update brand-design.md to ${doc.frontmatter.version}`;
    const commitUrl = await commitFile(path, inputData.markdown, message);
    return { path, commitUrl, version: doc.frontmatter.version };
  },
});

async function commitFile(path: string, content: string, message: string): Promise<string> {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error("GITHUB_REPO and GITHUB_TOKEN must be set to commit brand-design.md");

  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = { Authorization: `token ${token}`, Accept: "application/vnd.github+json" };

  let sha: string | undefined;
  const existing = await fetch(api, { headers });
  if (existing.ok) {
    const json = (await existing.json()) as { sha?: string };
    sha = json.sha;
  }

  const res = await fetch(api, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub commit failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { commit?: { html_url?: string } };
  return json.commit?.html_url ?? `https://github.com/${repo}/blob/main/${path}`;
}

export const brandDesignTools = {
  draftBrandDesign: draftBrandDesignTool,
  commitBrandDesign: commitBrandDesignTool,
};
