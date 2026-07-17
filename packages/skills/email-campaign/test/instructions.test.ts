import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { instructions } from "../src/instructions";

describe("instructions", () => {
  it("stays in sync with the canonical instructions.md", () => {
    const md = readFileSync(
      fileURLToPath(new URL("../instructions.md", import.meta.url)),
      "utf8",
    );
    expect(instructions).toBe(md);
  });

  it("routes intents to this pack's tools (05 H5.3)", () => {
    for (const tool of [
      "email_plan_propose",
      "email_calendar_read",
      "email_campaign_read",
      "klaviyo_audiences_read",
      "klaviyo_performance_read",
      "klaviyo_templates_read",
    ]) {
      expect(instructions).toContain(tool);
    }
  });

  it("states the write gate and the plan-approval semantics", () => {
    expect(instructions).toContain("propose_action");
    expect(instructions).toContain("DRAFTING only");
  });
});
