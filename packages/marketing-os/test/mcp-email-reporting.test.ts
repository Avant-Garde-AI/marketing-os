import { expect, it, vi } from "vitest";
// These bindings are irrelevant to input-schema publication and require the
// generated console's runtime dependencies rather than the CLI test runtime.
vi.mock("../templates/agents/lib/email/retrospective", () => ({ loadCampaignRows: vi.fn() }));
import { klaviyoPerformanceReadInputSchema } from "../templates/agents/lib/email/tools";
import { jsonSchemaFromZod } from "../templates/agents/lib/mcp/zod-schema";

it("publishes the required reporting timeframe that the implementation reads", () => {
  const published = jsonSchemaFromZod(klaviyoPerformanceReadInputSchema);
  expect(published).toMatchObject({
    type: "object", required: ["timeframe"],
    properties: { timeframe: { type: "object", required: ["start", "end"], properties: { start: { type: "string" }, end: { type: "string" } } } },
  });
  const args = { timeframe: { start: "2026-11-05T00:00:00Z", end: "2026-11-06T00:00:00Z" } };
  expect(klaviyoPerformanceReadInputSchema.parse(args)).toEqual(args);
});

it("rejects the formerly advertised since/until fields before execution", () => {
  const result = klaviyoPerformanceReadInputSchema.safeParse({ since: "2026-11-05", until: "2026-11-06" });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.some(i => i.path[0] === "timeframe")).toBe(true);
});
