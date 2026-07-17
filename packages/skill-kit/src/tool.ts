import type { z } from "zod";

/**
 * Plain tool definition — deliberately NOT a Mastra `createTool` instance
 * (spec 20 §5 / the social pack's convention). Packs stay free of
 * @mastra/core so the hosted runtime (which owns the Mastra version) wraps
 * these at merge time:
 *
 *   createTool({ id, description, inputSchema, outputSchema,
 *                execute: ({ context }) => def.execute(context) })
 */
export interface SkillToolDefinition<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  id: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  execute: (input: z.infer<I>) => Promise<z.infer<O>>;
}
