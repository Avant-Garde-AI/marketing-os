import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Skill Metadata — exported for the skills registry and UI card generation.
 */
export const metadata = {
  id: "ad-copy-generator",
  name: "Ad Copy Generator",
  description: "Generate Meta/Google ad copy variants based on brand voice and product selection.",
  category: "creative",
  icon: "sparkles",
  executionMode: "sync" as const,
  version: "1.0.0",
  author: "Marketing OS",
};

/**
 * Input schema — used for both validation and UI form generation.
 */
export const inputSchema = z.object({
  platform: z
    .enum(["meta", "google", "email"])
    .describe("Target advertising platform"),
  productId: z
    .string()
    .optional()
    .describe("Optional Shopify product ID to generate copy for"),
  productName: z
    .string()
    .optional()
    .describe("Optional product name if productId is not provided"),
  objective: z
    .enum(["awareness", "consideration", "conversion"])
    .default("conversion")
    .describe("Campaign objective"),
  tone: z
    .enum(["professional", "casual", "playful", "urgent", "luxury"])
    .default("professional")
    .describe("Tone of voice for the copy"),
  variantCount: z
    .number()
    .min(3)
    .max(10)
    .default(5)
    .describe("Number of copy variants to generate"),
  includeEmoji: z
    .boolean()
    .default(false)
    .describe("Include emojis in the copy"),
});

/**
 * Output schema — defines the structured response.
 */
export const outputSchema = z.object({
  variants: z.array(
    z.object({
      id: z
        .string()
        .describe("Unique identifier for this variant"),
      headline: z
        .string()
        .describe("Ad headline"),
      body: z
        .string()
        .describe("Ad body text"),
      cta: z
        .string()
        .describe("Call-to-action text"),
      characterCounts: z.object({
        headline: z.number().describe("Character count of headline"),
        body: z.number().describe("Character count of body"),
        cta: z.number().describe("Character count of CTA"),
      }),
      targetPersona: z
        .string()
        .describe("Target audience persona for this variant"),
      angle: z
        .string()
        .describe("Marketing angle used in this variant"),
      platformLimits: z.object({
        headlineWithinLimit: z.boolean().describe("Is headline within platform limits"),
        bodyWithinLimit: z.boolean().describe("Is body text within platform limits"),
      }),
    })
  ).describe("Generated ad copy variants"),
  productContext: z.object({
    name: z.string().describe("Product name"),
    price: z.string().optional().describe("Product price"),
    description: z.string().optional().describe("Product description"),
  }).optional().describe("Product context used for generation"),
  brandVoiceApplied: z
    .boolean()
    .describe("Whether brand voice guidelines were applied"),
  recommendations: z
    .array(z.string())
    .describe("Recommendations for using these variants"),
});

/**
 * The skill tool — the actual executable.
 */
export const tool = createTool({
  id: metadata.id,
  description: metadata.description,
  inputSchema,
  outputSchema,
  execute: async ({ context, mastra }) => {
    // Platform character limits
    const platformLimits: Record<string, { headline: number; body: number }> = {
      meta: { headline: 40, body: 125 },
      google: { headline: 30, body: 90 },
      email: { headline: 50, body: 200 },
    };
    const limits = platformLimits[context.platform as string];

    // Fetch product data if productId is provided
    let productContext: { name: string; price?: string; description?: string } | undefined;

    if (context.productId) {
      try {
        const productRes = await fetch(
          `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/products/${context.productId}.json`,
          {
            headers: {
              "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
            },
          }
        );
        const productData = await productRes.json();
        const product = productData.product;

        productContext = {
          name: product.title,
          price: product.variants?.[0]?.price,
          description: product.body_html?.replace(/<[^>]*>/g, "").substring(0, 200),
        };
      } catch (error) {
        // Fall back to productName if fetch fails
        productContext = context.productName ? { name: context.productName } : undefined;
      }
    } else if (context.productName) {
      productContext = { name: context.productName };
    }

    // Generate variants using the agent (if available) or template-based generation
    const variants = [];
    const angles = [
      "problem-solution",
      "social-proof",
      "scarcity",
      "benefit-focused",
      "curiosity-driven",
      "value-proposition",
      "lifestyle-aspiration",
    ];
    const personas = [
      "budget-conscious shopper",
      "quality-seeker",
      "early adopter",
      "lifestyle enthusiast",
      "practical buyer",
    ];

    for (let i = 0; i < context.variantCount; i++) {
      const angle = angles[i % angles.length];
      const persona = personas[i % personas.length];

      // Template-based copy generation (in production, this would use the creative agent)
      const productName = productContext?.name || "our product";
      const emoji = context.includeEmoji ? ["✨", "🎉", "🔥", "💫", "⭐"][i % 5] + " " : "";

      let headline = "";
      let body = "";
      let cta = "";

      // Generate based on objective and angle
      switch (context.objective) {
        case "awareness":
          headline = `${emoji}Discover ${productName}`;
          body = `Introducing ${productName} - the solution you've been waiting for. Join thousands of satisfied customers.`;
          cta = "Learn More";
          break;
        case "consideration":
          headline = `${emoji}Why Choose ${productName}?`;
          body = `${productName} offers unmatched quality and value. See what makes us different.`;
          cta = "Compare Now";
          break;
        case "conversion":
          headline = `${emoji}Get ${productName} Today`;
          body = `Limited time offer! ${productName} at an incredible price. Don't miss out.`;
          cta = "Shop Now";
          break;
      }

      // Adjust tone
      if (context.tone === "urgent") {
        body = `⚡ ${body} Act fast!`;
        cta = `Get It Now`;
      } else if (context.tone === "luxury") {
        headline = `${emoji}Experience ${productName}`;
        body = `Indulge in the finest quality. ${productName} represents excellence.`;
      }

      const headlineLength = headline.length;
      const bodyLength = body.length;
      const ctaLength = cta.length;

      variants.push({
        id: `variant-${i + 1}`,
        headline,
        body,
        cta,
        characterCounts: {
          headline: headlineLength,
          body: bodyLength,
          cta: ctaLength,
        },
        targetPersona: persona,
        angle,
        platformLimits: {
          headlineWithinLimit: headlineLength <= limits.headline,
          bodyWithinLimit: bodyLength <= limits.body,
        },
      });
    }

    const recommendations = [
      `Test variants 1-3 first as they target different personas`,
      `Monitor ${context.platform} performance metrics after 48 hours`,
      `A/B test headlines to optimize click-through rate`,
    ];

    if (variants.some(v => !v.platformLimits.headlineWithinLimit)) {
      recommendations.push(
        `Some headlines exceed ${context.platform} limits (${limits.headline} chars). Consider shortening.`
      );
    }

    return {
      variants,
      productContext,
      brandVoiceApplied: false, // Would check for /docs/brand-voice.md in production
      recommendations,
    };
  },
});
