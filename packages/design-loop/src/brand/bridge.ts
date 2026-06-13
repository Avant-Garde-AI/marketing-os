/**
 * Bridge from the Brand Conversion Document to the design-loop BrandContext —
 * the slice the refine loop and conformance critic consume (PRD §2). This is how
 * `brand-design.md` becomes the north star the design-code agent adheres to.
 */
import type { BrandContext } from "../types.js";
import type { BrandDesignDoc } from "./schema.js";

export function toBrandContext(doc: BrandDesignDoc): BrandContext {
  return {
    brandId: doc.frontmatter.brandId,
    category: doc.frontmatter.category,
    tokens: doc.visualIdentity.tokens,
    persona: doc.persona.summary,
    principles: doc.designPrinciples,
  };
}
