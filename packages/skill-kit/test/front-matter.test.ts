import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  frontMatterDocument,
  splitFrontMatter,
  validateFrontMatter,
} from "../src/front-matter";

describe("splitFrontMatter", () => {
  it("splits front matter and body", () => {
    const doc = "---\nname: test\ncount: 2\n---\n\nBody prose.\n";
    const { frontMatter, body } = splitFrontMatter(doc, "test.md");
    expect(frontMatter).toEqual({ name: "test", count: 2 });
    expect(body.trim()).toBe("Body prose.");
  });

  it("throws with docName context when front matter is missing", () => {
    expect(() => splitFrontMatter("no front matter", "email/strategy.md")).toThrow(
      /email\/strategy\.md: missing YAML front matter/,
    );
  });

  it("throws on invalid YAML", () => {
    expect(() => splitFrontMatter("---\n[: bad\n---\nbody", "x.md")).toThrow(
      /x\.md: invalid front matter YAML/,
    );
  });

  it("throws when front matter is not a mapping", () => {
    expect(() => splitFrontMatter("---\n42\n---\nbody", "x.md")).toThrow(
      /x\.md: front matter is not a mapping/,
    );
  });

  it("handles CRLF documents", () => {
    const doc = "---\r\nname: crlf\r\n---\r\nBody.";
    const { frontMatter, body } = splitFrontMatter(doc, "x.md");
    expect(frontMatter).toEqual({ name: "crlf" });
    expect(body).toBe("Body.");
  });
});

describe("frontMatterDocument", () => {
  it("round-trips through splitFrontMatter", () => {
    const fm = { id: "c-1", tags: ["a", "b"], nested: { k: 1 } };
    const body = "## Rationale\n\nBecause.";
    const doc = frontMatterDocument(fm, body);
    const back = splitFrontMatter(doc, "x.md");
    expect(back.frontMatter).toEqual(fm);
    expect(back.body.trim()).toBe(body);
  });

  it("emits no trailing newline after an empty body", () => {
    const doc = frontMatterDocument({ a: 1 }, "");
    expect(doc.endsWith("---\n\n")).toBe(true);
  });
});

describe("validateFrontMatter", () => {
  const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

  it("returns typed data on success", () => {
    expect(validateFrontMatter(schema, { month: "2026-08" }, "cal.md")).toEqual({
      month: "2026-08",
    });
  });

  it("reports paths in errors", () => {
    expect(() => validateFrontMatter(schema, { month: 8 }, "cal.md")).toThrow(
      /cal\.md: invalid front matter — month:/,
    );
  });
});
