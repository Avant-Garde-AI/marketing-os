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
import { estimateVideoCost } from "../../../lib/social/concepts";
import type { SlotBindings } from "../../../lib/social/resolve";
import { surfaceStyleFromTokens } from "../../../lib/social/surface-style";
import { componentResolver, loadLibrary, surfaceStyleFromLibrary } from "../../../lib/design-surfaces/library-source";

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
  kind: z.enum(["image", "text", "band", "component"]),
  ref: z
    .string()
    .optional()
    .describe(
      "Design-library component name (kind 'component') — e.g. 'caption-band'. Takes the brand's " +
        "whole lockup (ground, rule, type, optical spacing) rather than re-deriving it here.",
    ),
  overrides: z
    .record(z.string())
    .optional()
    .describe("Text overrides for a component, by element name — e.g. { eyebrow: 'Vent Stripe — Shelly Bremmer' }"),
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
      // The store's design library wins where it speaks; DESIGN.md tokens fill
      // the rest (spec 30 §3). A store with no library composes exactly as
      // before.
      const library = await loadLibrary();
      const style = surfaceStyleFromLibrary(library, surfaceStyleFromTokens(brand.tokens));

      const bindings: SlotBindings = {};
      for (const b of input.bindings) {
        if (b.kind === "image") {
          if (!b.imageUrl) return { ok: false, note: `role "${b.role}" is an image but has no imageUrl` };
          bindings[b.role] = { kind: "image", assetRef: b.imageUrl };
        } else if (b.kind === "text") {
          if (!b.characters) return { ok: false, note: `role "${b.role}" is text but has no characters` };
          bindings[b.role] = { kind: "text", characters: b.characters };
        } else if (b.kind === "component") {
          if (!b.ref) return { ok: false, note: `role "${b.role}" is a component but has no ref` };
          bindings[b.role] = { kind: "component", ref: b.ref, ...(b.overrides ? { overrides: b.overrides } : {}) };
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
          resolveComponent: componentResolver(library),
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


/**
 * Compose a concept's beats as KEYFRAME BOARDS on one page (spec 29 §9).
 *
 * A video's editable artifact is not the film — it is the pair of pictures each
 * segment interpolates between, and those are boards. Composing them onto ONE
 * page is what makes continuity structural instead of hoped-for: the first real
 * render of "How it was made" held its board, surface and light for six seconds
 * and changed both in the last two, because the last keyframe was an
 * independently generated still shot on a different desk. The model followed
 * its instructions exactly; the brief contradicted itself. Two boards that
 * share a page, a background asset and a crop cannot contradict each other in
 * that way.
 *
 * This composes and prices. It does not render: the render step walks
 * consecutive boards into a video model, and video bills per second of output,
 * so the number goes in front of a human first.
 */
export const composePostKeyframes = createTool({
  id: "compose_post_keyframes",
  description:
    "Compose a video concept's beats as KEYFRAME boards on one Design Studio page — one board per beat, named for its role. " +
    "This is how a video is authored here: you do not edit a film, you edit the pictures it interpolates between, and those are ordinary boards with brand type and real assets. Each beat is composed from a layout archetype exactly like a still post. " +
    "Composing every beat onto ONE page is what holds continuity: boards that share a page and a background asset cannot drift in surface, light or crop the way independently generated frames do — which is the single most common way a generated sequence fails. " +
    "Returns the board names in order plus an estimated render cost. Rendering is a separate, approved step: a video model bills per second of OUTPUT, and n beats is n-1 renders, not one. " +
    "Use compose_post_from_archetype instead for a single still.",
  inputSchema: z.object({
    postId: z.string().min(1),
    format: z
      .enum(["instagram-portrait", "instagram-square", "instagram-story"])
      .default("instagram-story")
      .describe("Board size for every keyframe. Story (1080x1920) is the usual video shape."),
    title: z.string().optional(),
    ratePerSecond: z
      .number()
      .default(0.15)
      .describe("Video model price per second of output, for the estimate"),
    beats: z
      .array(
        z.object({
          role: z.string().min(1).describe("This beat's job — setup, build, turn, payoff"),
          archetypeId: z.string().min(1).describe("Layout archetype for this keyframe"),
          seconds: z.number().optional().describe("Duration of the segment ENDING on this beat"),
          bindings: z.array(bindingInput).min(1).describe("Roles for this keyframe"),
        }),
      )
      .min(2)
      .describe("Two or more beats. One beat is a still, not a video."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    note: z.string().optional(),
    fileId: z.string().optional(),
    pageId: z.string().optional(),
    teamId: z.string().optional(),
    studioPath: z.string().optional(),
    boards: z.array(z.string()).optional().describe("Board names, in beat order"),
    estimate: z
      .object({ renders: z.number(), seconds: z.number(), cost: z.number(), summary: z.string() })
      .optional(),
  }),
  execute: async (inputData: {
    postId: string;
    format?: keyof typeof BOARDS;
    title?: string;
    ratePerSecond?: number;
    beats: {
      role: string;
      archetypeId: string;
      seconds?: number;
      bindings: z.infer<typeof bindingInput>[];
    }[];
  }) => {
    if (!isDesignSurfacesConfigured()) return { ok: false, note: NOT_CONFIGURED_NOTE };
    const { shop } = getTenant();
    try {
      const raw = await socialRepo.readFile(GENOME_PATH);
      if (raw === null) {
        return { ok: false, note: `This store has no ${GENOME_PATH}, so there are no archetypes to compose beats from.` };
      }
      const genome = parseGenome(raw);
      const brand = await loadBrandTokens(shop);
      const library = await loadLibrary();
      const style = surfaceStyleFromLibrary(library, surfaceStyleFromTokens(brand.tokens));
      const board = BOARDS[inputData.format ?? "instagram-story"];

      // Board names must be unique — exportSurfaceBoards addresses by name, so
      // two beats called "setup" would make one of them unreachable.
      const names = inputData.beats.map((b, i) => `${i + 1}-${b.role}`);
      const boards = [];
      for (const [i, beat] of inputData.beats.entries()) {
        const archetype = findArchetype(genome, beat.archetypeId);
        if (!archetype) {
          return { ok: false, note: `Beat ${i + 1} ("${beat.role}"): no archetype "${beat.archetypeId}" in the genome.` };
        }
        const roles = new Set(archetype.slots.map((s) => s.role));
        const unknown = beat.bindings.filter((b) => !roles.has(b.role)).map((b) => b.role);
        if (unknown.length > 0) {
          return {
            ok: false,
            note: `Beat ${i + 1} ("${beat.role}"): "${archetype.id}" has no role ${unknown.map((r) => `"${r}"`).join(", ")}. Its roles are: ${[...roles].join(", ")}.`,
          };
        }

        const bindings: SlotBindings = {};
        for (const b of beat.bindings) {
          if (b.kind === "image") {
            if (!b.imageUrl) return { ok: false, note: `Beat ${i + 1}: role "${b.role}" is an image with no imageUrl` };
            bindings[b.role] = { kind: "image", assetRef: b.imageUrl };
          } else if (b.kind === "text") {
            if (!b.characters) return { ok: false, note: `Beat ${i + 1}: role "${b.role}" is text with no characters` };
            bindings[b.role] = { kind: "text", characters: b.characters };
          } else if (b.kind === "component") {
            if (!b.ref) return { ok: false, note: `Beat ${i + 1}: role "${b.role}" is a component with no ref` };
            bindings[b.role] = { kind: "component", ref: b.ref, ...(b.overrides ? { overrides: b.overrides } : {}) };
          } else {
            bindings[b.role] = { kind: "band", color: b.color ?? style.bandColor };
          }
        }

        try {
          const built = await specFromArchetype({
            archetype,
            board,
            bindings,
            fileName: inputData.title ?? inputData.postId,
            boardName: names[i]!,
            style,
            materialize: croppingMaterializer,
            resolveComponent: componentResolver(library),
          });
          boards.push({
            name: names[i]!,
            width: board.width,
            height: board.height,
            ...(built.spec.board?.background ? { background: built.spec.board.background } : {}),
            elements: built.spec.elements ?? [],
          });
        } catch (e) {
          return {
            ok: false,
            note: `Beat ${i + 1} ("${beat.role}") could not be composed: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      }

      const spec: ComposeSpec = {
        fileName: inputData.title ?? inputData.postId,
        boards,
        ...(brand.tokens ? { tokens: brand.tokens } : {}),
        ...(brand.libraryColors ? { libraryColors: brand.libraryColors } : {}),
      };

      const fit = checkComposeFit(spec);
      const blocking = [...fit.errors, ...fit.warnings.filter((w) => w.code === "text-board-clip")];
      if (blocking.length > 0) {
        return { ok: false, note: "Keyframes do not fit their board:\n" + blocking.map((f) => `- ${f.message}`).join("\n") };
      }

      const home = await getTenantTeam(shop);
      const { surface } = await createSurface(getDesignSurfaceAdapter(), {
        tenantId: shop,
        teamId: home.teamId,
        projectId: home.projectId,
        kind: "social.keyframes",
        boundTo: { type: "post", id: inputData.postId },
        spec,
        brandLineage:
          brand.designMdVersion != null
            ? { designMdVersion: brand.designMdVersion, tokensVersion: brand.designMdVersion }
            : {},
        createdBy: "agent",
      });

      const estimate = estimateVideoCost(
        inputData.beats.map((b) => ({ role: b.role, direction: "", ...(b.seconds !== undefined ? { seconds: b.seconds } : {}) })),
        inputData.ratePerSecond ?? 0.15,
      );
      const { fileId, pageId, teamId } = surface.penpot;
      return {
        ok: true,
        fileId,
        pageId,
        teamId,
        studioPath: studioPath(teamId, fileId, pageId),
        boards: names,
        estimate,
        note:
          `Composed ${names.length} keyframes for "${inputData.postId}" on one page at ` +
          `${board.width}x${board.height}. ${estimate.summary} Edit any keyframe on the canvas ` +
          `before rendering — that is where a crop, a caption or a frame colour gets fixed.`,
      };
    } catch (e) {
      return { ok: false, note: `Keyframe composition failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
});
