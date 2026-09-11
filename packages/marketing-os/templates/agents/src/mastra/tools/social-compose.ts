/**
 * Compose a post's creative FROM A GENOME ARCHETYPE (spec 29 → spec 24 §6).
 *
 * This is the tool that closes the loop. Everything either side of it has
 * existed for a while and nothing joined them: `social_concept_instantiate`
 * returns plans naming an archetype per frame, `specFromArchetype` turns an
 * archetype plus bindings into a composable spec, and `createSurface` draws it.
 * Until now an agent had to read the genome, get resolved slot pixels back, and
 * hand-place elements through `compose_design_surface` — which is why a store
 * with seven archetypes shipped posts that all used one.
 *
 * WHAT THIS TOOL WILL NOT DO, and why each refusal is load-bearing:
 *
 * - It will not compose an archetype whose roles the caller has not filled. A
 *   partial surface passes the fit-check, exports cleanly, and is missing its
 *   subject; that failure is invisible to every automated check we have.
 * - It will not stretch an image to fill a slot. Penpot fills have no
 *   object-fit, so a mismatch distorts rather than crops and the result looks
 *   like a bad photograph rather than a bug. Assets are cut to the slot first
 *   (croppingMaterializer); anything left over is a real aspect problem.
 * - It will not invent a role the archetype does not declare. A binding for an
 *   unknown role is an error, not a no-op, because silently dropping it is how
 *   a caller believes a caption shipped that never existed.
 *
 * Type and colour come from the store's DESIGN.md, never from the genome — the
 * archetype supplies structure and the brand supplies everything visible. That
 * split is what makes consulting a market-derived genome safe at all.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getTenant } from "../../../lib/tenant-context";
import {
  getDesignSurfaceAdapter,
  isDesignSurfacesConfigured,
  NOT_CONFIGURED_NOTE,
  penpotEditUrl,
} from "../../../lib/design-surfaces/config";
import { getTenantTeam } from "../../../lib/design-surfaces/tenancy";
import { createSurface } from "../../../lib/design-surfaces/surface";
import { checkComposeFit } from "../../../lib/design-surfaces/compose";
import { croppingMaterializer } from "../../../lib/design-surfaces/materialize";
import type { ComposeSpec } from "../../../lib/design-surfaces/types";
import { loadBrandTokens, studioPath } from "./design-surfaces";
import { socialRepo } from "../../../lib/social/repo";
import { findArchetype, parseGenome, GENOME_PATH } from "../../../lib/social/reference";
import { specFromArchetype } from "../../../lib/social/archetype-surface";
import type { SlotBindings } from "../../../lib/social/resolve";
import { surfaceStyleFromTokens } from "../../../lib/social/surface-style";

/** Named formats, so a caller does not have to remember platform pixel sizes. */
const BOARDS = {
  "instagram-portrait": { width: 1080, height: 1350 },
  "instagram-square": { width: 1080, height: 1080 },
  "instagram-story": { width: 1080, height: 1920 },
} as const;

const bindingInput = z.object({
  role: z
    .string()
    .min(1)
    .describe("The archetype role this fills — 'room', 'wall', 'work', 'band', 'headline', 'eyebrow'…"),
  kind: z.enum(["image", "text", "band"]),
  imageUrl: z
    .string()
    .optional()
    .describe(
      "https URL of an image the STORE owns (kind 'image'). Cut to the slot's aspect before " +
        "placement, so a room scene need not already be the right shape.",
    ),
  characters: z.string().optional().describe("The words (kind 'text'). Sized to fit its slot automatically."),
  color: z.string().optional().describe("Hex fill (kind 'band'); defaults to the brand's ground colour"),
});

export const composePostFromArchetype = createTool({
  id: "compose_post_from_archetype",
  description:
    "Compose a post's creative from a LAYOUT ARCHETYPE in the store's social genome, filling each of its roles. " +
    "PREFER this over compose_design_surface for social posts: the archetype supplies proven structure and the store's DESIGN.md supplies type and colour, so you place content by ROLE ('the room goes here, the caption band there') instead of inventing pixel coordinates. Use compose_design_surface only for a one-off layout no archetype covers. " +
    "Call social_genome_read first to see the archetypes and their roles, or social_concept_instantiate to get plans that already name one per frame. " +
    "Every role the archetype declares must be bound. If you cannot fill one, choose a different archetype — a surface missing its subject still exports cleanly and nothing downstream will notice. " +
    "Images are cut to their slot, so a 928x1152 room scene composes correctly on a 1080x1350 board without you resizing anything. " +
    "Drafts are free; this never publishes. Returns fileId/pageId and a studioPath to open the canvas — then call social_link_design to bind it to the post.",
  inputSchema: z.object({
    postId: z.string().min(1).describe("The post this creative belongs to"),
    archetypeId: z.string().min(1).describe("Archetype id from social_genome_read"),
    format: z
      .enum(["instagram-portrait", "instagram-square", "instagram-story"])
      .default("instagram-portrait")
      .describe("Board size. Portrait (1080x1350) suits room scenes; story is 9:16."),
    title: z.string().optional().describe("Design file title; defaults to the post id"),
    bindings: z.array(bindingInput).min(1).describe("One entry per role the archetype declares"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    note: z.string().optional(),
    archetypeId: z.string().optional(),
    fileId: z.string().optional(),
    pageId: z.string().optional(),
    teamId: z.string().optional(),
    studioPath: z.string().optional(),
    editUrl: z.string().optional(),
  }),
  execute: async (input: {
    postId: string;
    archetypeId: string;
    format?: keyof typeof BOARDS;
    title?: string;
    bindings: z.infer<typeof bindingInput>[];
  }) => {
    if (!isDesignSurfacesConfigured()) return { ok: false, note: NOT_CONFIGURED_NOTE };
    const { shop } = getTenant();
    try {
      const raw = await socialRepo.readFile(GENOME_PATH);
      if (raw === null) {
        return {
          ok: false,
          note:
            `This store has no ${GENOME_PATH}, so there are no archetypes to compose from. ` +
            `Use compose_design_surface, or build the genome first.`,
        };
      }
      const archetype = findArchetype(parseGenome(raw), input.archetypeId);
      if (!archetype) {
        return { ok: false, note: `No archetype "${input.archetypeId}" in the genome. Call social_genome_read.` };
      }

      // An unknown role is an error rather than a no-op: dropping it silently
      // is how a caller comes to believe a caption shipped that never existed.
      const roles = new Set(archetype.slots.map((s) => s.role));
      const unknown = input.bindings.filter((b) => !roles.has(b.role)).map((b) => b.role);
      if (unknown.length > 0) {
        return {
          ok: false,
          archetypeId: archetype.id,
          note:
            `"${archetype.id}" has no role${unknown.length > 1 ? "s" : ""} ${unknown.map((r) => `"${r}"`).join(", ")}. ` +
            `Its roles are: ${[...roles].join(", ")}.`,
        };
      }

      const brand = await loadBrandTokens(shop);
      const style = surfaceStyleFromTokens(brand.tokens);

      const bindings: SlotBindings = {};
      for (const b of input.bindings) {
        if (b.kind === "image") {
          if (!b.imageUrl) return { ok: false, note: `role "${b.role}" is an image but has no imageUrl` };
          bindings[b.role] = { kind: "image", assetRef: b.imageUrl };
        } else if (b.kind === "text") {
          if (!b.characters) return { ok: false, note: `role "${b.role}" is text but has no characters` };
          bindings[b.role] = { kind: "text", characters: b.characters };
        } else {
          bindings[b.role] = { kind: "band", color: b.color ?? style.bandColor };
        }
      }

      const board = BOARDS[input.format ?? "instagram-portrait"];
      const fileName = input.title ?? input.postId;

      let spec: ComposeSpec;
      try {
        const built = await specFromArchetype({
          archetype,
          board,
          bindings,
          fileName,
          boardName: archetype.id,
          style,
          materialize: croppingMaterializer,
          ...(brand.tokens ? { tokens: brand.tokens } : {}),
          ...(brand.libraryColors ? { libraryColors: brand.libraryColors } : {}),
        });
        spec = built.spec as ComposeSpec;
      } catch (e) {
        // specFromArchetype's refusals are already written for a reader — an
        // unfilled role names every missing one at once, an aspect mismatch
        // reports both aspects. Relay verbatim rather than flattening them.
        return {
          ok: false,
          archetypeId: archetype.id,
          note: `Could not compose "${archetype.id}": ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      const fit = checkComposeFit(spec);
      const blocking = [...fit.errors, ...fit.warnings.filter((w) => w.code === "text-board-clip")];
      if (blocking.length > 0) {
        return {
          ok: false,
          archetypeId: archetype.id,
          note:
            "The composed layout does not fit its board — this is an archetype/board mismatch rather " +
            "than something you can fix by adjusting content:\n" +
            blocking.map((f) => `- ${f.message}`).join("\n"),
        };
      }

      const home = await getTenantTeam(shop);
      const adapter = getDesignSurfaceAdapter();
      const { surface } = await createSurface(adapter, {
        tenantId: shop,
        teamId: home.teamId,
        projectId: home.projectId,
        kind: "social.post",
        boundTo: { type: "post", id: input.postId },
        spec,
        brandLineage:
          brand.designMdVersion != null
            ? { designMdVersion: brand.designMdVersion, tokensVersion: brand.designMdVersion }
            : {},
        createdBy: "agent",
      });

      const { fileId, pageId, teamId } = surface.penpot;
      const advisory = fit.warnings.filter((w) => w.code !== "text-board-clip");
      return {
        ok: true,
        archetypeId: archetype.id,
        fileId,
        pageId,
        teamId,
        studioPath: studioPath(teamId, fileId, pageId),
        editUrl: penpotEditUrl(teamId, fileId, pageId),
        note:
          `Composed "${input.postId}" on archetype "${archetype.id}" at ${board.width}x${board.height}. ` +
          `Call social_link_design to bind it to the post.` +
          (advisory.length ? ` Fit notes: ${advisory.map((w) => w.message).join(" ")}` : ""),
      };
    } catch (e) {
      return { ok: false, note: `Archetype composition failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
});
