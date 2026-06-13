#!/usr/bin/env node
// @ts-nocheck
/**
 * MCP server exposing the Design Work Contract — the primary delegation surface.
 * Any MCP-speaking orchestrator (Claude Code in the GH runner, a Mastra planner,
 * …) drives it. The tool schemas ARE the contract.
 *
 * Tools:
 *   implement_design_change(TaskSpec, async_mode=true) → { task_id, status }
 *   get_work_report(task_id)                           → ReportEnvelope
 *   revise_design_change(RevisionSpec)                 → { task_id, status }
 *
 * Loaded only when run as the server (`design-loop mcp`); uses the MCP SDK,
 * declared as an optional dependency.
 */
import { z } from "zod";
import { DelegationService } from "./handlers.js";
import { taskSpecSchema, revisionSpecSchema } from "../contract.js";

async function main() {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

  const service = new DelegationService();
  const server = new McpServer({ name: "design-code-agent", version: "0.1.0" });

  server.tool(
    "implement_design_change",
    "Delegate an on-brand Shopify theme implementation to the design-code deep agent. " +
      "Returns a task_id immediately; poll get_work_report for the result.",
    { task: taskSpecSchema, async_mode: z.boolean().default(true) },
    async ({ task, async_mode }) => {
      const result = await service.implement(task, { async: async_mode });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    "get_work_report",
    "Fetch the WorkReport (and interim progress) for a delegated design task.",
    { task_id: z.string() },
    async ({ task_id }) => {
      const envelope = service.getReport(task_id);
      return { content: [{ type: "text", text: JSON.stringify(envelope) }] };
    },
  );

  server.tool(
    "revise_design_change",
    "Send corrections for a completed/escalated task; re-enters the refine loop.",
    { revision: revisionSpecSchema },
    async ({ revision }) => {
      const result = await service.revise(revision);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`design-code-agent MCP server failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
