/**
 * Creating a Klaviyo segment, under the Action gate.
 *
 * ## Why an audience is a gated write
 *
 * A segment sends nothing. It is tempting to treat it as a read — a saved
 * query — and let the agent make them freely. But every campaign here is
 * addressed to an audience by reference, and the reference is a code. Once
 * `kaethe-fans` exists in the roster, later steps use it without re-reading
 * what it means, and the last human check on WHO receives an email is the
 * moment the definition is written. So the definition gets an approval while it
 * is still legible, rather than the send inheriting an audience nobody read.
 *
 * The failure this prevents is specific and has already happened once in this
 * store: an audience that is syntactically valid, accepted by Klaviyo, and
 * matches the wrong people. Nothing downstream can detect it. A 46-profile
 * segment and a 0-profile segment look identical in a campaign artifact.
 *
 * ## What the card can and cannot promise
 *
 * It shows the rule in plain English (`describe()`), because that is the thing
 * being approved. It CANNOT show a size: Klaviyo evaluates a segment only after
 * it exists. Any number on this card would be invented, so there is none — and
 * the execute polls afterwards and reports the real count in its result, which
 * is the first honest moment to state one.
 *
 * ## What it deliberately does not do
 *
 * It does not attach the segment to a campaign, and it does not delete or edit
 * existing ones. Creating an audience and choosing to mail it are separate
 * decisions; deletion is destructive and stays a human action in the Klaviyo UI.
 */

import { z } from "zod";
import { hashPreview } from "../actions/hash";
import { createKlaviyoClient } from "./klaviyo-client";
import { getShopifyClient } from "../shopify";
import { compile, describe, type AudienceSpec, type Predicate } from "./segments";
import type { ActionPreview, ActionResult, RuntimeAction } from "../actions/types";

const predicateSchema: z.ZodType<Predicate> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("in_list"),
    listIds: z
      .array(z.string().min(1))
      .min(1)
      .describe("Klaviyo LIST ids. Segment ids do not work here."),
  }),
  z.object({
    kind: z.literal("country"),
    equals: z.string().min(2).describe('Klaviyo\'s own spelling, e.g. "United States".'),
  }),
  z.object({
    kind: z.literal("did"),
    metric: z.enum(["clicked_email", "opened_email", "placed_order", "viewed_product", "ordered_product"]),
    atLeast: z.number().int().min(1).optional().describe("Times, default 1."),
    withinDays: z.number().int().min(1).max(3650).optional().describe("Omit for ever."),
  }),
  z.object({
    kind: z.literal("did_for_campaign"),
    metric: z.enum(["clicked_email", "opened_email", "placed_order", "viewed_product"]),
    campaignId: z
      .string()
      .regex(
        /^[0-9A-HJKMNP-TV-Z]{26}$/,
        "must be the Klaviyo campaign ID (26 chars), not the campaign name — a name here silently matches nobody",
      ),
    atLeast: z.number().int().min(1).optional(),
  }),
  z.object({
    kind: z.literal("did_for_artist"),
    // Only the line-level metrics carry an artist; "Placed Order" is an order,
    // which may span several.
    metric: z.enum(["viewed_product", "ordered_product"]),
    artist: z
      .string()
      .min(2)
      .describe(
        "Exactly as Shopify spells the vendor/brand, e.g. \"Kaethe Butcher\". This is an equality test — a near-miss matches nobody.",
      ),
    atLeast: z.number().int().min(1).optional(),
    withinDays: z.number().int().min(1).max(3650).optional(),
  }),
]) as z.ZodType<Predicate>;

const params = z.object({
  name: z
    .string()
    .min(3)
    .max(120)
    .describe("Shown in Klaviyo. Name it for who is in it, not the campaign that prompted it."),
  key: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(3)
    .max(64)
    .describe("Roster key campaigns will use to reference this audience, e.g. kaethe-fans."),
  anyOfGroups: z
    .array(z.array(predicateSchema).min(1))
    .min(1)
    .max(6)
    .describe(
      "Groups of conditions. Within a group ANY may match (OR); every group must match (AND). " +
        "Two conditions in one group is a union; two groups of one is an intersection.",
    ),
});

type Params = z.infer<typeof params>;

const specOf = (p: Params): AudienceSpec => ({ name: p.name, anyOfGroups: p.anyOfGroups });

export function createSegmentAction(): RuntimeAction<Params> {
  return {
    kind: "klaviyo.create_segment",
    title: "Create a Klaviyo audience",
    // Medium, not high: it sends nothing and is deletable. What makes it worth
    // an approval at all is that it decides who a later send reaches.
    risk: "medium",
    scopes: ["klaviyo:write"],
    paramsSchema: params,

    async preview(p) {
      const spec = specOf(p);
      const warnings: string[] = [];

      // Compiling here, before approval, means a shape Klaviyo would refuse
      // fails on the card rather than after someone has clicked. The compiler
      // reaches Klaviyo to resolve metric names, so this also proves the
      // account actually has the metrics the rule names.
      let definition: Record<string, unknown>;
      try {
        definition = await compile(spec);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        return {
          summary: `Cannot build audience "${p.name}"`,
          rows: [{ label: "Problem", value: why }],
          warnings: [`This audience cannot be created as described: ${why}`],
          previewHash: hashPreview({ kind: "klaviyo.create_segment", error: why }),
        } satisfies ActionPreview;
      }

      // An artist name is an equality test against Shopify's own spelling, so a
      // near-miss ("Kathe Butcher", "kaethe butcher") builds a segment matching
      // nobody — the same silent failure as a campaign name in a $message
      // filter. Check the spelling while a human is still looking at it.
      const artists = p.anyOfGroups
        .flat()
        .filter((c): c is Extract<Predicate, { kind: "did_for_artist" }> => c.kind === "did_for_artist")
        .map((c) => c.artist);
      if (artists.length > 0) {
        try {
          const shopify = getShopifyClient();
          const res = await shopify.graphql<{
            shop?: { productVendors?: { edges?: Array<{ node?: string }> } };
          }>(`{ shop { productVendors(first: 250) { edges { node } } } }`);
          // `graphql()` returns the JSON:API envelope, so the payload is under
          // `.data` — reading `res.shop` directly yields undefined, which would
          // make this check silently pass on every name.
          const vendors = (res.data?.shop?.productVendors?.edges ?? [])
            .map((e) => e.node)
            .filter((v): v is string => typeof v === "string");
          if (vendors.length === 0) {
            warnings.push(
              `Shopify returned no vendor list, so "${artists.join('", "')}" could not be checked — ` +
                `the spelling is unverified rather than confirmed.`,
            );
          } else {
            for (const artist of new Set(artists)) {
              if (vendors.includes(artist)) continue;
              const near = vendors.find((v) => v.toLowerCase() === artist.toLowerCase());
              warnings.push(
                near
                  ? `No Shopify vendor is spelled "${artist}" — the store spells it "${near}". ` +
                    `This match is case-sensitive, so as written it would select NOBODY.`
                  : `No Shopify vendor named "${artist}". As written this audience would select NOBODY. ` +
                    `Check the spelling against the store's vendor list.`,
              );
            }
          }
        } catch (e) {
          // Unreachable vendors is not "the artist does not exist".
          warnings.push(
            `Could not check "${artists.join('", "')}" against Shopify's vendor list ` +
              `(${e instanceof Error ? e.message : e}) — the spelling is unverified.`,
          );
        }
      }

      const client = createKlaviyoClient();
      let existing: string | null = null;
      try {
        const audiences = await client.listAudiences();
        existing = audiences.find((a) => a.name.toLowerCase() === p.name.toLowerCase())?.id ?? null;
      } catch (e) {
        // Not evidence the name is free. Say which of the two this is.
        warnings.push(
          `Could not check for an existing audience of the same name (${e instanceof Error ? e.message : e}) — ` +
            `a duplicate would not be caught before creation.`,
        );
      }
      if (existing) {
        warnings.push(
          `Klaviyo already has an audience called "${p.name}" (${existing}). ` +
            `Approving this creates a second one with the same name.`,
        );
      }

      const rules = describe(spec);
      return {
        summary: `Create audience "${p.name}" (${p.key}) in Klaviyo`,
        rows: [
          { label: "Name", value: p.name },
          { label: "Roster key", value: p.key },
          ...rules.map((r, i) => ({ label: i === 0 ? "Rule" : "", value: r })),
          // Stated rather than left to be assumed from an absent number.
          { label: "Size", value: "not known until it exists — Klaviyo evaluates after creation" },
        ],
        warnings,
        previewHash: hashPreview({ kind: "klaviyo.create_segment", name: p.name, key: p.key, definition }),
      } satisfies ActionPreview;
    },

    async execute(p) {
      const spec = specOf(p);
      const definition = await compile(spec);
      const client = createKlaviyoClient();
      const segment = await client.createSegment({ name: p.name, definition });

      // Klaviyo evaluates asynchronously. Poll briefly so the result carries a
      // real number — an audience nobody can size is an audience nobody can
      // sanity-check, and this is the first point a true count exists.
      let count: number | null = null;
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const c = await client.describeSegment(segment.id);
          if (!c.processing && c.count !== null) {
            count = c.count;
            break;
          }
        } catch {
          // Counting is a courtesy; the segment exists either way and the
          // result must not read as a failed creation.
          break;
        }
      }

      const sized =
        count === null
          ? "Klaviyo is still evaluating it — check the size in Klaviyo before mailing it."
          : count === 0
            ? "It currently matches NOBODY. Check the rule before any campaign uses it."
            : `It currently matches ${count.toLocaleString()} profiles.`;

      return {
        ok: true,
        summary: `Created "${p.name}" (${segment.id}). ${sized}`,
        detail: { id: segment.id, key: p.key, name: p.name, profileCount: count },
      } satisfies ActionResult;
    },
  };
}
