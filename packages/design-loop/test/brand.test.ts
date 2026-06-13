import { describe, expect, it } from "vitest";
import {
  draftBrandDesign,
  serializeBrandDesign,
  parseBrandDesign,
  toBrandContext,
  elicitedPersona,
  neurographPersonaStub,
  commitBrandDesign,
  memoryCommitter,
  brandDesignDocSchema,
  type BrandDesignDoc,
} from "../src/brand/index.js";
import { MockDesignKnowledge } from "../src/design-mcp/mock.js";

const knowledge = new MockDesignKnowledge();
const now = () => "2026-06-13T00:00:00Z";

describe("brand-design.md document model", () => {
  it("round-trips a fully-populated doc losslessly", () => {
    const doc: BrandDesignDoc = brandDesignDocSchema.parse({
      frontmatter: { brandId: "arthaus", neurographPersona: null, category: "Home & Garden > Decor", version: "1.2.0", updated: now() },
      essence: "Quiet-luxury home objects with provenance.",
      persona: {
        source: "elicited",
        summary: "Design-led collector who values craftsmanship.",
        drivers: ["provenance", "timeless design"],
        objections: ["price justification"],
        trustRequirements: ["maker story", "returns"],
      },
      valueProp: "Hand-made pieces that outlast trends.",
      visualIdentity: { tokens: { primary: "#111111", bg: "#ffffff" }, typography: "serif", imagery: "editorial", summary: "restrained palette" },
      voice: { tone: "considered, warm", vocabulary: ["crafted", "enduring"], donts: ["hype", "FOMO"] },
      designPrinciples: ["lead with craftsmanship", "quiet typography"],
      categoryContext: "Premium decor buyers expect editorial layouts.",
      conversionPriorities: ["sticky add-to-cart", "maker story near buy box"],
      guardrails: { wcag: "AA", noDarkPatterns: true, custom: ["no fake scarcity"] },
    });

    const round = parseBrandDesign(serializeBrandDesign(doc));
    expect(round).toEqual(doc);
  });

  it("serializes the PRD §2 front-matter and headings", () => {
    const doc = brandDesignDocSchema.parse({
      frontmatter: { brandId: "x", category: "c", updated: now() },
      persona: { source: "elicited" },
    });
    const md = serializeBrandDesign(doc);
    expect(md).toMatch(/^---\nbrand_id: x/);
    expect(md).toContain("## 2. Target Persona");
    expect(md).toContain("## 9. Guardrails");
  });
});

describe("guided draft (MCP-grounded)", () => {
  it("drafts a complete doc grounded in category conventions + persona", async () => {
    const doc = await draftBrandDesign({
      brandId: "arthaus",
      category: "Home & Garden > Decor",
      now,
      knowledge,
      persona: elicitedPersona,
    });
    expect(doc.frontmatter.brandId).toBe("arthaus");
    expect(doc.frontmatter.neurographPersona).toBeNull();
    expect(doc.persona.source).toBe("elicited");
    expect(Object.keys(doc.visualIdentity.tokens).length).toBeGreaterThan(0);
    expect(doc.designPrinciples.length).toBeGreaterThan(0);
    expect(doc.conversionPriorities.length).toBeGreaterThan(0);
    // Draft must survive a serialize round-trip too.
    expect(parseBrandDesign(serializeBrandDesign(doc))).toEqual(doc);
  });

  it("takes the NeuroGraph fork when a persona ref is provided", async () => {
    const doc = await draftBrandDesign({
      brandId: "arthaus",
      category: "Home & Garden > Decor",
      now,
      knowledge,
      persona: neurographPersonaStub("pdo://arthaus@3"),
    });
    expect(doc.persona.source).toBe("neurograph");
    expect(doc.frontmatter.neurographPersona).toBe("pdo://arthaus@3");
  });
});

describe("bridge + commit", () => {
  it("bridges the doc to a design-loop BrandContext", async () => {
    const doc = await draftBrandDesign({ brandId: "arthaus", category: "Decor", now, knowledge, persona: elicitedPersona });
    const ctx = toBrandContext(doc);
    expect(ctx.brandId).toBe("arthaus");
    expect(ctx.tokens).toEqual(doc.visualIdentity.tokens);
    expect(ctx.principles).toEqual(doc.designPrinciples);
  });

  it("commits the serialized doc via the committer", async () => {
    const doc = await draftBrandDesign({ brandId: "arthaus", category: "Decor", now, knowledge, persona: elicitedPersona });
    const committer = memoryCommitter();
    const res = await commitBrandDesign(committer, doc);
    expect(res.path).toBe("docs/brand-design.md");
    expect(committer.written.get("docs/brand-design.md")).toContain("# Brand Conversion Document — arthaus");
  });
});
