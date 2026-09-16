import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonSchemaFromZod, mirrorTools } from "../templates/agents/lib/mcp/zod-schema";

describe("jsonSchemaFromZod", () => {
  it("carries required vs optional across, which is what makes a tool callable", () => {
    const s = z.object({ id: z.string(), note: z.string().optional() });
    expect(jsonSchemaFromZod(s)).toEqual({
      type: "object",
      properties: { id: { type: "string" }, note: { type: "string" } },
      required: ["id"],
    });
  });

  it("treats a default as optional and nullable as required", () => {
    // Absence and null are different: a defaulted field may be omitted, a
    // nullable one must still be sent (as null).
    const s = z.object({ a: z.string().default("x"), b: z.string().nullable() });
    expect(jsonSchemaFromZod(s)).toMatchObject({ required: ["b"] });
  });

  it("keeps the description whichever side of the wrapper it was written on", () => {
    const inside = z.object({ a: z.string().describe("why").optional() });
    const outside = z.object({ a: z.string().optional().describe("why") });
    expect(jsonSchemaFromZod(inside)).toMatchObject({ properties: { a: { description: "why" } } });
    expect(jsonSchemaFromZod(outside)).toMatchObject({ properties: { a: { description: "why" } } });
  });

  it("carries formats an agent would otherwise have to guess", () => {
    const s = z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      when: z.string().datetime({ offset: true }),
      ttl: z.number().int().positive().max(90),
    });
    const out = jsonSchemaFromZod(s) as any;
    expect(out.properties.month.pattern).toBe("^\\d{4}-(0[1-9]|1[0-2])$");
    expect(out.properties.when.format).toBe("date-time");
    expect(out.properties.ttl).toMatchObject({ type: "integer", maximum: 90 });
  });

  it("describes nested arrays of objects — the shape every plan tool takes", () => {
    const s = z.object({
      slots: z.array(z.object({ slot: z.string(), postId: z.string().optional() })),
    });
    expect(jsonSchemaFromZod(s)).toEqual({
      type: "object",
      properties: {
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: { slot: { type: "string" }, postId: { type: "string" } },
            required: ["slot"],
          },
        },
      },
      required: ["slots"],
    });
  });

  it("handles enums, literals, unions and records", () => {
    const s = z.object({
      kind: z.enum(["image", "video"]),
      ok: z.literal(true),
      ref: z.union([z.string(), z.number()]),
      overrides: z.record(z.string()),
    });
    const out = jsonSchemaFromZod(s) as any;
    expect(out.properties.kind).toEqual({ type: "string", enum: ["image", "video"] });
    expect(out.properties.ok).toEqual({ const: true });
    expect(out.properties.ref.anyOf).toHaveLength(2);
    expect(out.properties.overrides).toEqual({
      type: "object",
      additionalProperties: { type: "string" },
    });
  });

  it("degrades an unknown construct to permissive rather than wrong", () => {
    // A confidently wrong constraint would make a VALID call fail at the
    // client and never reach the tool. `{}` reaches the tool, whose own zod
    // returns a precise error.
    const s = z.object({ weird: z.string().transform((v) => v.length) });
    expect(jsonSchemaFromZod(s)).toMatchObject({ properties: { weird: {} } });
  });
});

describe("mirrorTools", () => {
  const registry = {
    a_tool: {
      id: "a_tool",
      description: "does a thing",
      inputSchema: z.object({ x: z.string() }),
      execute: async (i: any) => ({ got: i.x }),
    },
  };

  it("mirrors id, description and a derived schema, and stays callable", async () => {
    const [t] = mirrorTools(registry as any, ["a_tool"]);
    expect(t!.name).toBe("a_tool");
    expect(t!.description).toBe("does a thing");
    expect(t!.inputSchema).toMatchObject({ required: ["x"] });
    await expect(t!.run({ x: "hi" })).resolves.toEqual({ got: "hi" });
  });

  it("THROWS on a name the registry lacks — a silent skip is the bug this prevents", () => {
    expect(() => mirrorTools(registry as any, ["nope"])).toThrow(/not in this registry/);
  });
});
