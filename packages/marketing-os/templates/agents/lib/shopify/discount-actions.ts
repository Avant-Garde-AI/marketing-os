/**
 * Creating a Shopify discount code, under the Action gate.
 *
 * ## Why this is an Action when campaign authoring is not
 *
 * Spec 20's line is that writes to EXTERNAL state are Actions. Authoring a
 * campaign writes a file into the store's own repo and can be undone with a
 * revert. This creates a live, redeemable instrument in a commerce system: the
 * moment it exists, anyone who learns the string can spend the store's margin
 * with it, and "delete it" does not undo an order already placed. It is the
 * clearest possible case for propose → preview → human approval → execute.
 *
 * ## What it deliberately does not do
 *
 * It does not send anything, and it does not put the code in an email. A code
 * and a campaign are separate decisions with separate approvals — a code that
 * exists is not a promise to broadcast it, and coupling them would mean one
 * approval authorised both.
 *
 * ## The guards, and why each one exists
 *
 * A discount is the one write here where a plausible-looking mistake is
 * expensive, so the schema refuses the expensive mistakes outright rather than
 * describing them in a summary a human might skim:
 *
 *   - `endsAt` is REQUIRED. Shopify is happy to create a code that never
 *     expires; a promotion that never ends is not a promotion, it is a price
 *     change nobody decided to make. Every code here is time-boxed.
 *   - Percentages are capped at 50. Above that the likeliest explanation is a
 *     unit error — 90 meaning "pay 90%" — and the cost of being wrong is the
 *     whole catalogue at a tenth of its price.
 *   - `usageLimit` and `appliesOncePerCustomer` default to the careful side.
 *   - The code is normalised and checked for collision BEFORE approval, so the
 *     card cannot promise a code that Shopify will then refuse.
 *
 * ## Scope
 *
 * Needs BOTH `read_discounts` (the collision check) and `write_discounts` (the
 * create) on the Admin token. Arthaus's token carries 16 scopes and has
 * neither, so `preview` says so plainly rather than letting an approval succeed
 * and the execute fail after a human has already clicked. The collision check
 * degrades to a warning rather than a hard stop when it cannot run — an
 * unreadable discount list is not evidence that the code is free, and the
 * execute re-checks anyway.
 */

import { z } from "zod";
import { getShopifyClient } from "../shopify";
import { hashPreview } from "../actions/hash";
import type { ActionPreview, ActionResult, RuntimeAction } from "../actions/types";

const params = z.object({
  code: z
    .string()
    .min(3)
    .max(64)
    .describe('The code customers type, e.g. "LABORDAY15". Normalised to upper case.'),
  title: z.string().min(1).max(120).describe("Internal name shown in Shopify admin."),
  percentage: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe("Percent off, 1–50. Above 50 is refused: it is far more often a unit error than an intent."),
  startsAt: z.string().describe("ISO datetime the code becomes usable."),
  endsAt: z
    .string()
    .describe("ISO datetime the code stops working. Required — a promotion with no end is an undecided price change."),
  usageLimit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Total redemptions across all customers. Omit for unlimited."),
  appliesOncePerCustomer: z
    .boolean()
    .optional()
    .describe("Defaults to true. One redemption per customer is the careful default for a broadcast code."),
});

export type CreateDiscountParams = z.infer<typeof params>;

const CREATE = `
  mutation CreateDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            status
            startsAt
            endsAt
            codes(first: 1) { nodes { code } }
          }
        }
      }
      userErrors { field message code }
    }
  }
`;

const LOOKUP = `
  query FindDiscount($q: String!) {
    codeDiscountNodeByCode(code: $q) {
      id
      codeDiscount { ... on DiscountCodeBasic { title status endsAt } }
    }
  }
`;

/** Normalised the way Shopify presents codes, so the email and the store agree. */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

/** Does the token carry write_discounts? Asked before approval, not after. */
async function hasDiscountScope(): Promise<boolean | null> {
  const store = process.env.SHOPIFY_STORE_URL;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ACCESS_TOKEN;
  if (!store || !token) return null;
  try {
    const res = await fetch(`https://${store}/admin/oauth/access_scopes.json`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_scopes?: Array<{ handle?: string }> };
    return (body.access_scopes ?? []).some((s) => s.handle === "write_discounts");
  } catch {
    // Unknown is not "missing" — say nothing rather than block on a flaky read.
    return null;
  }
}

async function existing(code: string): Promise<{ id: string; status?: string } | null> {
  const res = await getShopifyClient().graphql<{
    codeDiscountNodeByCode: { id: string; codeDiscount?: { status?: string } } | null;
  }>(LOOKUP, { q: code });
  if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
  const node = res?.data?.codeDiscountNodeByCode;
  if (!node) return null;
  return { id: node.id, ...(node.codeDiscount?.status ? { status: node.codeDiscount.status } : {}) };
}

function window(p: CreateDiscountParams): string {
  const f = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  return `${f(p.startsAt)} → ${f(p.endsAt)} UTC`;
}

export function createDiscountCode(): RuntimeAction<CreateDiscountParams> {
  return {
    kind: "shopify.create_discount_code",
    title: "Create a Shopify discount code",
    risk: "high",
    scopes: ["shopify:read_discounts", "shopify:write_discounts"],
    paramsSchema: params,

    async preview(p): Promise<ActionPreview> {
      const code = normaliseCode(p.code);
      const start = new Date(p.startsAt);
      const end = new Date(p.endsAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error("startsAt and endsAt must both be valid ISO datetimes");
      }
      if (end <= start) throw new Error(`endsAt (${p.endsAt}) must be after startsAt (${p.startsAt})`);

      const warnings: string[] = [];

      // Ask about permission BEFORE a human approves, not after. An approval
      // that cannot execute wastes the one thing the gate is protecting.
      const scoped = await hasDiscountScope();
      if (scoped === false) {
        warnings.push(
          "The Admin token does not carry write_discounts, so this WILL fail on execute. " +
            "Re-authorize the app with read_discounts and write_discounts first — " +
            "approving now achieves nothing.",
        );
      } else if (scoped === null) {
        warnings.push("Could not read the token's scopes, so write_discounts is unconfirmed.");
      }

      // A collision is the difference between creating a code and silently
      // reusing someone else's terms. Catch it while it is still a preview.
      let collision: { id: string; status?: string } | null = null;
      try {
        collision = await existing(code);
      } catch (e) {
        warnings.push(`Could not check whether "${code}" already exists: ${e instanceof Error ? e.message : e}`);
      }
      if (collision) {
        throw new Error(
          `discount code "${code}" already exists in Shopify (${collision.status ?? "unknown status"}). ` +
            `Nothing was created. Pick a different code, or use the existing one as-is.`,
        );
      }

      const hours = Math.round((end.getTime() - start.getTime()) / 3600000);
      if (hours > 24 * 14) warnings.push(`This runs for ${Math.round(hours / 24)} days — long for a promotion.`);
      if (!p.usageLimit) {
        warnings.push("No total usage limit: redeemable by every recipient, and by anyone they forward it to.");
      }

      return {
        summary: `Create "${code}" — ${p.percentage}% off everything, ${window(p)}`,
        rows: [
          { label: "Code", value: code },
          { label: "Discount", value: `${p.percentage}% off the whole catalogue` },
          { label: "Active", value: window(p) },
          { label: "Total redemptions", value: p.usageLimit ? String(p.usageLimit) : "unlimited" },
          { label: "Per customer", value: (p.appliesOncePerCustomer ?? true) ? "once" : "unlimited" },
          { label: "Store", value: process.env.SHOPIFY_STORE_URL ?? "—" },
        ],
        ...(warnings.length ? { warnings } : {}),
        // Binds the nonce to every term that changes what gets created. Change
        // the percentage or the window and the card re-arms.
        previewHash: hashPreview({
          kind: "shopify.create_discount_code",
          code,
          percentage: p.percentage,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          usageLimit: p.usageLimit ?? null,
          appliesOncePerCustomer: p.appliesOncePerCustomer ?? true,
        }),
      };
    },

    async execute(p): Promise<ActionResult> {
      const code = normaliseCode(p.code);

      // Re-check at execute. Preview and execute are separated by a human, and
      // a code can be created by someone else in that gap; creating a second
      // one with the same string is how two sets of terms end up in play.
      const clash = await existing(code);
      if (clash) {
        return {
          ok: false,
          summary: `"${code}" already exists in Shopify — nothing was created.`,
          detail: { code, existingId: clash.id, status: clash.status ?? null },
        };
      }

      const res = await getShopifyClient().graphql<{
        discountCodeBasicCreate: {
          codeDiscountNode: { id: string } | null;
          userErrors: Array<{ field?: string[]; message: string; code?: string }>;
        };
      }>(CREATE, {
        basicCodeDiscount: {
          title: p.title,
          code,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          customerSelection: { all: true },
          customerGets: {
            value: { percentage: p.percentage / 100 },
            items: { all: true },
          },
          appliesOncePerCustomer: p.appliesOncePerCustomer ?? true,
          ...(p.usageLimit ? { usageLimit: p.usageLimit } : {}),
        },
      });

      if (res?.errors?.length) {
        throw new Error(`Shopify rejected the request: ${res.errors.map((e) => e.message).join("; ")}`);
      }
      const out = res?.data?.discountCodeBasicCreate;
      const userErrors = out?.userErrors ?? [];
      if (userErrors.length > 0) {
        // These are the store's own objections and usually actionable — surface
        // them verbatim rather than as "creation failed".
        throw new Error(
          `Shopify refused: ${userErrors.map((e) => `${(e.field ?? []).join(".")} ${e.message}`.trim()).join("; ")}`,
        );
      }
      const id = out?.codeDiscountNode?.id;
      if (!id) throw new Error("Shopify returned no discount node and no error — nothing can be confirmed created.");

      return {
        ok: true,
        summary: `Created "${code}" — ${p.percentage}% off, ${window(p)}`,
        detail: {
          code,
          discountNodeId: id,
          percentage: p.percentage,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          usageLimit: p.usageLimit ?? null,
          appliesOncePerCustomer: p.appliesOncePerCustomer ?? true,
        },
      };
    },
  };
}
