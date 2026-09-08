/**
 * Audiences the agent can describe, compiled into Klaviyo segment conditions.
 *
 * ## Why a vocabulary and not raw Klaviyo JSON
 *
 * Klaviyo's segment definition is a nested condition language with several
 * traps that are invisible until the API refuses you, and every one of them
 * cost real time while building the September campaigns:
 *
 *   - Country is `properties['$country']`, not `$country`. The bare form is
 *     rejected with "All custom profile properties must be of the form
 *     properties['property name']".
 *   - `profile-group-membership` takes LISTS only, one `group_ids` entry per
 *     condition. Passing several ids in one condition, or a segment id, does
 *     not do what it looks like it does.
 *   - Conditions inside a group are OR'd; groups are AND'd. Getting this
 *     backwards produced a "full reach" segment of three profiles.
 *   - Metric conditions need the account's own metric id, and those ids differ
 *     per store — so they are looked up by name, never hardcoded.
 *   - Scoping a metric to one campaign uses `metric_filters: [{property, filter}]`
 *     — no `type` key, and `property` must be `$message` holding the campaign
 *     ID. `Campaign Name` with the human title is ACCEPTED and matches nobody.
 *
 * Every shape below was probed against live Klaviyo on 2026-09-08 rather than
 * recalled, because three of the five plausible ones were wrong and one of the
 * wrong ones was accepted silently (see `$message` above). A segment that is
 * accepted and empty looks exactly like a segment that is correct and small.
 *
 * Handing that surface to a model means it will occasionally produce a segment
 * that is syntactically valid and semantically wrong, and a wrong audience is
 * not visible in a preview: it is a number that looks plausible. So the agent
 * describes WHO it wants in terms this file understands, and the compiler is
 * the only thing that writes Klaviyo JSON.
 *
 * ## What this deliberately cannot express
 *
 * Arbitrary nesting, negation of groups, and time-windowed metric filters
 * beyond "ever" and "in the last N days". If a campaign genuinely needs one,
 * add it here with a name and a comment rather than widening the input to
 * free-form conditions — the point is that every audience the store can build
 * is one somebody has read.
 */

import { createKlaviyoClient } from "./klaviyo-client";
import type { KlaviyoClient } from "./types";

/** Klaviyo metric names this vocabulary can reference, resolved per store. */
const METRIC_NAMES = {
  clicked_email: "Clicked Email",
  opened_email: "Opened Email",
  placed_order: "Placed Order",
  viewed_product: "Viewed Product",
  ordered_product: "Ordered Product",
} as const;

export type MetricKey = keyof typeof METRIC_NAMES;

/**
 * Where the artist's name lives in each metric's event payload.
 *
 * It is not the same key twice: Shopify feeds "Viewed Product" a `Brand` and
 * "Ordered Product" a `Vendor`, both holding the artist. Asking for the wrong
 * one is not an error — it is a filter that matches nothing — so the mapping is
 * here rather than in the caller's head.
 *
 * `Placed Order` is deliberately absent: it is an order-level event with no
 * single artist, so affinity is only askable of the two line-level metrics.
 */
const ARTIST_PROPERTY: Partial<Record<MetricKey, string>> = {
  viewed_product: "Brand",
  ordered_product: "Vendor",
};

export type ArtistMetric = "viewed_product" | "ordered_product";

/** One thing that can be true about a profile. */
export type Predicate =
  /** Member of any of these Klaviyo LISTS (not segments). */
  | { kind: "in_list"; listIds: string[] }
  /** Location. Country names are Klaviyo's own spelling: "United States". */
  | { kind: "country"; equals: string }
  /** Did a thing at least `atLeast` times, ever or within a window. */
  | { kind: "did"; metric: MetricKey; atLeast?: number; withinDays?: number }
  /** Did a thing at least once against a specific campaign — the engagement
   *  follow-up case: "clicked THAT email". */
  | { kind: "did_for_campaign"; metric: MetricKey; campaignId: string; atLeast?: number }
  /** Showed interest in one artist's work — viewed or bought a piece of theirs.
   *  The basis of an artist-affinity audience. */
  | {
      kind: "did_for_artist";
      metric: ArtistMetric;
      artist: string;
      atLeast?: number;
      withinDays?: number;
    };

/**
 * An audience: groups of predicates. Within a group, ANY may match (OR).
 * Every group must match (AND). That is Klaviyo's own shape, named plainly,
 * because the OR/AND split is the part people get wrong.
 */
export interface AudienceSpec {
  name: string;
  anyOfGroups: Predicate[][];
}

interface MetricIndex {
  byName: Map<string, string>;
}

let metricCache: { at: number; index: MetricIndex } | null = null;
const METRIC_TTL_MS = 10 * 60 * 1000;

// Injectable so these functions can be exercised against a real account outside
// a tenant request — the compiled JSON is the whole point of this file, and a
// shape that is only ever built in production is a shape nobody has checked.
async function metrics(client?: KlaviyoClient): Promise<MetricIndex> {
  if (metricCache && Date.now() - metricCache.at < METRIC_TTL_MS) return metricCache.index;
  const rows = await (client ?? createKlaviyoClient()).listMetrics();
  const byName = new Map<string, string>();
  for (const m of rows) byName.set(m.name.toLowerCase(), m.id);
  const index = { byName };
  metricCache = { at: Date.now(), index };
  return index;
}

async function metricId(key: MetricKey, client?: KlaviyoClient): Promise<string> {
  const name = METRIC_NAMES[key];
  const { byName } = await metrics(client);
  const id = byName.get(name.toLowerCase());
  if (!id) {
    // Naming a metric the store does not have is a content problem, not a bug —
    // say which, so nobody goes looking for a broken client.
    throw new Error(
      `this store has no Klaviyo metric called "${name}", so an audience cannot be built from it`,
    );
  }
  return id;
}

async function compilePredicate(p: Predicate, client?: KlaviyoClient): Promise<Record<string, unknown>[]> {
  switch (p.kind) {
    case "in_list":
      // One condition per list. Several ids inside a single condition is
      // accepted by the API and does not mean "any of these".
      return p.listIds.map((id) => ({
        type: "profile-group-membership",
        is_member: true,
        group_ids: [id],
        timeframe_filter: null,
      }));

    case "country":
      return [
        {
          type: "profile-property",
          property: "properties['$country']",
          filter: { type: "string", operator: "equals", value: p.equals },
        },
      ];

    case "did":
      return [
        {
          type: "profile-metric",
          metric_id: await metricId(p.metric, client),
          measurement: "count",
          measurement_filter: {
            type: "numeric",
            operator: "greater-than",
            value: (p.atLeast ?? 1) - 1,
          },
          // Both arms are `type: "date"`. A `relative` type reads naturally and
          // is refused; `null` is refused too — "ever" has to be spelled
          // `alltime` explicitly.
          timeframe_filter: p.withinDays
            ? { type: "date", operator: "in-the-last", quantity: p.withinDays, unit: "day" }
            : { type: "date", operator: "alltime" },
          // `null`, not `[]` — an empty array is rejected.
          metric_filters: null,
        },
      ];

    case "did_for_campaign":
      // A campaign ID is a 26-character ULID. Anything else here — most likely
      // the campaign's human title, which is what a model reaches for — would
      // compile, be accepted, and match nobody.
      if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(p.campaignId)) {
        throw new Error(
          `"${p.campaignId}" is not a Klaviyo campaign ID. This filter needs the ID ` +
            `(26 characters, like 01M1ZNE07R8AR8EDS527S1Q7MT), not the campaign's name — ` +
            `a name here builds an empty audience without erroring.`,
        );
      }
      return [
        {
          type: "profile-metric",
          metric_id: await metricId(p.metric, client),
          measurement: "count",
          measurement_filter: {
            type: "numeric",
            operator: "greater-than",
            value: (p.atLeast ?? 1) - 1,
          },
          timeframe_filter: { type: "date", operator: "alltime" },
          // Scoped to one campaign — this is what makes "everyone who clicked
          // THAT email" expressible, which is the whole basis of a follow-up.
          //
          // `$message` carries the campaign ID. Klaviyo also accepts
          // `Campaign Name` against the human title, and that variant returned
          // zero profiles where this one returned 46 — accepted, evaluated, and
          // wrong. Hence the id check below: a title slipped in here would build
          // an empty audience that nothing downstream could distinguish from a
          // small one.
          metric_filters: [
            {
              property: "$message",
              filter: { type: "string", operator: "equals", value: p.campaignId },
            },
          ],
        },
      ];

    case "did_for_artist": {
      const property = ARTIST_PROPERTY[p.metric];
      if (!property) {
        throw new Error(
          `artist affinity cannot be asked of "${p.metric}" — only viewed_product and ` +
            `ordered_product carry an artist on the event`,
        );
      }
      return [
        {
          type: "profile-metric",
          metric_id: await metricId(p.metric, client),
          measurement: "count",
          measurement_filter: {
            type: "numeric",
            operator: "greater-than",
            value: (p.atLeast ?? 1) - 1,
          },
          timeframe_filter: p.withinDays
            ? { type: "date", operator: "in-the-last", quantity: p.withinDays, unit: "day" }
            : { type: "date", operator: "alltime" },
          // The artist name must match Shopify's spelling exactly — this is an
          // equality test on a string the store does not control from here.
          metric_filters: [
            { property, filter: { type: "string", operator: "equals", value: p.artist } },
          ],
        },
      ];
    }
  }
}

export async function compile(
  spec: AudienceSpec,
  client?: KlaviyoClient,
): Promise<Record<string, unknown>> {
  if (spec.anyOfGroups.length === 0) {
    throw new Error("an audience needs at least one group of conditions");
  }
  const condition_groups = [];
  for (const group of spec.anyOfGroups) {
    if (group.length === 0) throw new Error("a condition group cannot be empty");
    const conditions = (await Promise.all(group.map((p) => compilePredicate(p, client)))).flat();
    condition_groups.push({ conditions });
  }
  return { condition_groups };
}

/** Plain-English rendering, for the approval card. A definition nobody can read
 *  is a definition nobody is really approving. */
export function describe(spec: AudienceSpec): string[] {
  const say = (p: Predicate): string => {
    switch (p.kind) {
      case "in_list":
        return `on ${p.listIds.length === 1 ? "list" : "any of lists"} ${p.listIds.join(", ")}`;
      case "country":
        return `in ${p.equals}`;
      case "did": {
        const times = (p.atLeast ?? 1) === 1 ? "at least once" : `at least ${p.atLeast} times`;
        const when = p.withinDays ? `in the last ${p.withinDays} days` : "ever";
        return `${METRIC_NAMES[p.metric]} ${times} ${when}`;
      }
      case "did_for_campaign":
        return `${METRIC_NAMES[p.metric]} on campaign "${p.campaignId}"`;
      case "did_for_artist": {
        const verb = p.metric === "ordered_product" ? "bought" : "viewed";
        const times = (p.atLeast ?? 1) === 1 ? "" : ` at least ${p.atLeast} times`;
        const when = p.withinDays ? ` in the last ${p.withinDays} days` : "";
        return `someone who has ${verb} work by ${p.artist}${times}${when}`;
      }
    }
  };
  return spec.anyOfGroups.map(
    (g, i) => `${i === 0 ? "Must be" : "AND must be"} ${g.map(say).join(" OR ")}`,
  );
}

/**
 * The inverse: render a definition Klaviyo already holds as English.
 *
 * Needed because an audience reaches every other part of this system as a bare
 * code — `Y7THBS` in a campaign artifact tells a reviewer nothing about who is
 * in it. Segments built in Klaviyo's own UI can use condition types this
 * vocabulary cannot write, so anything unrecognised is reported as such rather
 * than skipped: an omitted condition would understate who receives an email,
 * which is the one direction this must never round in.
 */
export async function explainDefinition(
  definition: unknown,
  client?: KlaviyoClient,
): Promise<string[]> {
  const groups = (definition as { condition_groups?: Array<{ conditions?: unknown[] }> } | null)
    ?.condition_groups;
  if (!Array.isArray(groups) || groups.length === 0) {
    return ["No readable definition — check this audience in Klaviyo before mailing it."];
  }

  const { byName } = await metrics(client);
  const nameById = new Map([...byName].map(([name, id]) => [id, name]));

  const say = (c: unknown): string => {
    const k = c as Record<string, any>;
    switch (k.type) {
      case "profile-group-membership":
        return `${k.is_member === false ? "not on" : "on"} list ${(k.group_ids ?? []).join(", ")}`;
      case "profile-property": {
        const f = k.filter ?? {};
        return `${k.property} ${f.operator ?? "?"} ${JSON.stringify(f.value)}`;
      }
      case "profile-metric": {
        const metric = nameById.get(k.metric_id) ?? `metric ${k.metric_id}`;
        const mf = k.measurement_filter ?? {};
        const times =
          mf.operator === "greater-than" ? `more than ${mf.value} times` : `${mf.operator} ${mf.value}`;
        const tf = k.timeframe_filter ?? {};
        const when =
          tf.operator === "alltime"
            ? "ever"
            : tf.operator === "in-the-last"
              ? `in the last ${tf.quantity} ${tf.unit}`
              : `${tf.operator} ${tf.date ?? ""}`.trim();
        const scope = Array.isArray(k.metric_filters)
          ? k.metric_filters
              .map((f: any) => ` where ${f.property} = ${JSON.stringify(f.filter?.value)}`)
              .join("")
          : "";
        return `did "${metric}" ${times} ${when}${scope}`;
      }
      default:
        // Named, not dropped.
        return `an unrecognised condition of type "${k.type}" that this summary cannot read`;
    }
  };

  return groups.map((g, i) => {
    const conds = Array.isArray(g.conditions) ? g.conditions : [];
    return `${i === 0 ? "Must be" : "AND must be"} ${conds.map(say).join(" OR ")}`;
  });
}
