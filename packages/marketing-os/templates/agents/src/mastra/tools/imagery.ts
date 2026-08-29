/**
 * Imagery tools — the agent's read surface over the store's mockup pipeline.
 *
 * Conventions mirror design-surfaces.ts: createTool + zod, tenant comes from
 * context, and the tools READ (they generate candidates, they publish nothing),
 * so they compose freely rather than routing through the Action gate. What a
 * campaign ultimately SENDS is still gated — the draft Action uploads the
 * chosen image to the ESP and a human approves that.
 *
 * The resolver itself (lib/imagery/resolve) holds the house rules and the
 * reasons for them; these tools are the thin agent-facing wrapper.
 *
 * Cost posture: `imagery_resolve` composites into the built room-template
 * library — no image generation, ~$0, ~8s. It is safe to call per artwork. The
 * novel-scene tier (a pro image generation per call) is deliberately NOT
 * exposed here; a caller that wants it should ask for it explicitly so the
 * spend is a decision rather than a side effect.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveImagery, listRooms, type ImageryRole } from "../../../lib/imagery/resolve";

const roleEnum = z.enum(["hero-editorial", "hero-room", "hero-artist", "hero-product", "thumbnail"]);

export const imageryResolveTool = createTool({
  id: "imagery_resolve",
  description:
    "Resolve a lifestyle or studio shot for one artwork. Give the artwork's public image URL, a stable key (its Shopify handle), and the ROLE the image plays — hero-editorial and hero-room put the work in a styled room; hero-artist and hero-product use the leaning studio shot. Returns the chosen image plus ranked alternatives, each with the reason it ranked there, and a provenance line to record on the campaign. Composites into the store's built room library: no image generation, so it is cheap and safe to call per piece. The URLs are SIGNED and expire — fine to preview, but a campaign that will be sent must upload the chosen image to the ESP first (the draft Action does this).",
  inputSchema: z.object({
    artworkUrl: z.string().describe("Public https URL of the artwork image to composite."),
    artworkKey: z
      .string()
      .describe("Stable key, normally the Shopify handle — seeds template selection so the same piece resolves consistently across campaigns."),
    role: roleEnum.describe("What the image is for; picks the treatment."),
    orientation: z
      .enum(["portrait", "landscape", "square"])
      .optional()
      .describe("Artwork orientation. 'square' suppresses room scenes — the library has no square room templates, so a room composite would silently centre-crop."),
    rooms: z.array(z.string()).optional().describe("Optional preferred room ids (see imagery_rooms), e.g. to match a seasonal mood."),
    title: z.string().optional(),
  }),
  execute: async (inputData: {
    artworkUrl: string;
    artworkKey: string;
    role: ImageryRole;
    orientation?: "portrait" | "landscape" | "square";
    rooms?: string[];
    title?: string;
  }) => {
    const out = await resolveImagery(inputData);
    return {
      chosen: out.chosen,
      alternatives: out.candidates.slice(1),
      provenance: out.provenance,
      expiresInMinutes: out.expiresInMinutes,
      warnings: out.warnings,
      // Stated in the payload so the model cannot treat a signed URL as durable.
      note:
        out.chosen === null
          ? "No eligible image. Degrade honestly — say so rather than substituting an unrelated picture."
          : "Signed URL with a finite life. Preview freely; anything that will be SENT must be uploaded to the ESP first.",
    };
  },
});

export const imageryRoomsTool = createTool({
  id: "imagery_rooms",
  description:
    "List the room settings imagery_resolve can composite into — built templates only, with each room's mood and room type. Use this to choose a seasonal or tonal room by id rather than guessing.",
  inputSchema: z.object({}),
  execute: async () => ({ rooms: await listRooms() }),
});

export const imageryTools = {
  imageryResolve: imageryResolveTool,
  imageryRooms: imageryRoomsTool,
};
