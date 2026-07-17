import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { instructions } from "../src/instructions";

describe("instructions", () => {
  it("src/instructions.ts stays in sync with instructions.md (the canonical copy)", () => {
    const md = readFileSync(fileURLToPath(new URL("../instructions.md", import.meta.url)), "utf8");
    expect(instructions).toBe(md);
  });

  it("carries the governance rules", () => {
    expect(instructions).toContain("Plan from the Brand Soul");
    expect(instructions).toContain("Every slot carries its why");
    expect(instructions).toContain("Never engagement bait");
    expect(instructions).toContain("writes are Actions");
  });

  it("carries the SM2 approve-at-schedule publishing rules", () => {
    expect(instructions).toContain("Approve-at-schedule");
    expect(instructions).toContain("social.schedule_post");
    expect(instructions).toContain("social.publish_post");
    expect(instructions).toContain("social.cancel_post");
    expect(instructions).toContain("consent to publish");
  });
});
