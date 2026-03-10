import { Agent } from "@mastra/core/agent";

/**
 * Creative Agent
 *
 * A specialist agent for generating marketing creative content.
 *
 * Generates:
 * - Ad copy (headlines, body text, CTAs) for Meta, Google, and email
 * - Product descriptions optimized for conversion
 * - Creative briefs for campaigns
 * - A/B test variants for existing copy
 */
export const creativeAgent = new Agent({
  id: "creative-agent",
  name: "Creative Agent",
  model: "anthropic/claude-sonnet-4-20250514",
  instructions: `You are a specialist marketing creative agent.

You generate:
- Ad copy (headlines, body text, CTAs) for Meta, Google, and email
- Product descriptions optimized for conversion
- Creative briefs for campaigns
- A/B test variants for existing copy

You always:
- Follow the brand voice guidelines from /docs/brand-voice.md
- Generate multiple variants (at least 3) for any copy request
- Include character counts for platform-specific copy
- Tag each variant with the persona/angle it targets`,
});
