import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMastraStoryModel } from "../templates/agents/src/mastra/storyboard-model";

const sdk = vi.hoisted(() => ({ generate: vi.fn(), constructors: vi.fn() }));
vi.mock("@mastra/core/agent", () => ({
  Agent: class {
    constructor(config: unknown) { sdk.constructors(config); }
    generate = sdk.generate;
  },
}));

const schema = z.object({ storyboards: z.array(z.object({
  continuity: z.array(z.string()),
  transition: z.object({ change: z.string(), why: z.string(), patternRefs: z.array(z.string()) }),
})).length(3) });
const complete = { storyboards: Array.from({ length: 3 }, () => ({
  continuity: [], transition: { change: "reveal", why: "answer", patternRefs: [] },
})) };
const request = { task: "plan-storyboards", instruction: "Plan from facts", data: { brief: "data" }, schema,
  images: [{ label: "actual artwork", url: "https://cdn.shopify.com/work.jpg" }] };

beforeEach(() => { vi.clearAllMocks(); sdk.generate.mockResolvedValue({ object: complete, finishReason: "stop" }); });
describe("Mastra storyboard model boundary", () => {
  it("makes one bounded call with actual pixels, full required shape and explicit Gemini thinking", async () => {
    expect(await createMastraStoryModel("google/gemini-3.1-pro-preview").generate(request)).toEqual(complete);
    expect(sdk.generate).toHaveBeenCalledTimes(1);
    expect(sdk.constructors.mock.calls[0][0]).toMatchObject({ maxRetries: 0 });
    expect(sdk.constructors.mock.calls[0][0].instructions).toContain("Return exactly three complete storyboards");
    expect(sdk.constructors.mock.calls[0][0].instructions).toContain('"required":["change","why","patternRefs"]');
    expect(sdk.generate.mock.calls[0][0][0].content).toContainEqual({ type: "image", image: request.images[0].url });
    expect(sdk.generate.mock.calls[0][1]).toMatchObject({
      structuredOutput: { schema, errorStrategy: "strict" }, maxSteps: 1, maxProcessorRetries: 0,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
      modelSettings: { maxOutputTokens: 24000 },
    });
  });
  it("never invents the two missing storyboards or omitted required fields", async () => {
    sdk.generate.mockResolvedValue({ object: { storyboards: [{ transition: { change: "reveal", why: "answer" } }] }, finishReason: "stop" });
    await expect(createMastraStoryModel("google/gemini-3.1-pro-preview").generate(request)).rejects.toThrow();
    expect(sdk.generate).toHaveBeenCalledTimes(1);
  });
  it("rejects budget exhaustion even if the recovered partial JSON happens to validate", async () => {
    sdk.generate.mockResolvedValue({ object: complete, finishReason: "length" });
    await expect(createMastraStoryModel("google/gemini-3.1-pro-preview").generate(request)).rejects.toThrow("bounded output budget");
    expect(sdk.generate).toHaveBeenCalledTimes(1);
  });
  it("does not attach Gemini settings to other providers or older Google models", async () => {
    for (const model of ["anthropic/claude-sonnet-4-5", "google/gemini-2.5-pro"]) {
      await createMastraStoryModel(model).generate({ ...request, task: "narrative-critique" });
      expect(sdk.generate.mock.lastCall?.[1]).not.toHaveProperty("providerOptions");
      expect(sdk.generate.mock.lastCall?.[1].modelSettings).toEqual({ maxOutputTokens: 8000 });
    }
  });
  it("does not hide SDK/schema failures behind a retry or structuring model", async () => {
    sdk.generate.mockRejectedValue(new Error("Structured output validation failed"));
    await expect(createMastraStoryModel("google/gemini-3.1-pro-preview").generate(request)).rejects.toThrow("Structured output validation failed");
    expect(sdk.generate).toHaveBeenCalledTimes(1);
    expect(sdk.generate.mock.calls[0][1].structuredOutput).not.toHaveProperty("model");
  });
});
