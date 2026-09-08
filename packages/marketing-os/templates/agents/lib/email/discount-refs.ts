/**
 * Checking that a campaign's discount code is real, before anyone approves it.
 *
 * The Labor Day campaign named LABORDAY15 in its body, rendered, committed to
 * git, passed a human review and reached the approval gate — and the store had
 * no such code, no way to create one, and nothing anywhere that checked. Had it
 * sent, 4,703 people would have been given a code that errors at checkout on a
 * bank holiday.
 *
 * ## Declared, then scanned
 *
 * The authoritative signal is `campaign.discountCode`, a field the author sets.
 * That makes the claim exact and cheap to verify. The prose scan below is a
 * SECOND, weaker signal for the case that actually happened: a code written
 * into a sentence and never declared. It only ever produces a warning, because
 * any heuristic loose enough to find LABORDAY15 in running text also finds
 * ARTHAUS, and a gate that cries wolf gets clicked through.
 *
 * ## Absent is not the same as unreadable
 *
 * `read_discounts` may not be granted — Arthaus's token carries neither
 * discount scope today. "Shopify says no such code" and "we could not ask
 * Shopify" are different facts with different consequences, so they are
 * returned as different verdicts and only the first is ever grounds to block.
 */

import { getShopifyClient } from "../shopify";
import type { EmailCampaign } from "./types";

export type CodeVerdict = "exists" | "missing" | "unverifiable";

export interface CodeCheck {
  code: string;
  verdict: CodeVerdict;
  /** Shopify's status when it knows the code: ACTIVE, EXPIRED, SCHEDULED. */
  status?: string;
  endsAt?: string;
  /** Why it could not be checked, when unverifiable. */
  reason?: string;
}

const LOOKUP = `
  query CampaignDiscount($q: String!) {
    codeDiscountNodeByCode(code: $q) {
      id
      codeDiscount {
        ... on DiscountCodeBasic { status endsAt }
        ... on DiscountCodeBxgy   { status endsAt }
        ... on DiscountCodeFreeShipping { status endsAt }
      }
    }
  }
`;

/**
 * Codes a campaign's prose appears to promise.
 *
 * Deliberately narrow: a run of 5–24 A–Z0–9 containing at least one digit, and
 * not a word the brand uses about itself. The digit requirement is what makes
 * it usable — ARTHAUS, IN CONTEXT and ARTIST DROP are all excluded, while
 * LABORDAY15, SPRING20 and TAKE15 are not. It will still miss a lettersonly
 * code, which is why the declared field is the one that governs.
 */
export function scanForCodes(campaign: EmailCampaign): string[] {
  const text: string[] = [campaign.body ?? "", campaign.subject ?? "", campaign.previewText ?? ""];
  for (const section of campaign.sections ?? []) {
    for (const block of (section as { blocks?: Array<Record<string, unknown>> }).blocks ?? []) {
      for (const v of Object.values(block)) {
        if (typeof v === "string") text.push(v);
      }
    }
  }
  const found = new Set<string>();
  for (const t of text) {
    for (const m of t.matchAll(/\b[A-Z0-9]{5,24}\b/g)) {
      const token = m[0];
      if (!/[0-9]/.test(token)) continue;
      if (!/[A-Z]/.test(token)) continue; // a bare number is not a code
      found.add(token);
    }
  }
  return [...found];
}

/** Ask the store about one code. Never throws — an unreachable Shopify is a
 *  verdict, not an exception, because the caller must not block on it. */
export async function verifyCode(code: string): Promise<CodeCheck> {
  try {
    const res = await getShopifyClient().graphql<{
      codeDiscountNodeByCode: { id: string; codeDiscount?: { status?: string; endsAt?: string } } | null;
    }>(LOOKUP, { q: code });
    if (res?.errors?.length) {
      const msg = res.errors.map((e) => e.message).join("; ");
      // A permissions failure must never read as "this code does not exist" —
      // that is the exact conflation that would turn a missing scope into a
      // blocked campaign.
      return { code, verdict: "unverifiable", reason: msg };
    }
    const node = res?.data?.codeDiscountNodeByCode ?? null;
    if (!node) return { code, verdict: "missing" };
    return {
      code,
      verdict: "exists",
      ...(node.codeDiscount?.status ? { status: node.codeDiscount.status } : {}),
      ...(node.codeDiscount?.endsAt ? { endsAt: node.codeDiscount.endsAt } : {}),
    };
  } catch (e) {
    return { code, verdict: "unverifiable", reason: e instanceof Error ? e.message : String(e) };
  }
}

export interface DiscountReport {
  /** Blocking problems: the store says the declared code does not exist. */
  errors: string[];
  /** Everything a human should see but which must not stop an approval. */
  warnings: string[];
  checks: CodeCheck[];
}

/**
 * Everything the approval gate should say about a campaign's discount code.
 *
 * Blocks only on a DECLARED code the store actively denies. A scanned code, an
 * unverifiable one, an expired one and a code whose window ends before the send
 * are all warnings — each is worth a human's attention and none is worth
 * refusing on, since the campaign may legitimately be ahead of the code.
 */
export async function checkDiscounts(campaign: EmailCampaign): Promise<DiscountReport> {
  const declared = campaign.discountCode?.trim().toUpperCase();
  const scanned = scanForCodes(campaign).filter((c) => c !== declared);
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: CodeCheck[] = [];

  if (declared) {
    const check = await verifyCode(declared);
    checks.push(check);
    if (check.verdict === "missing") {
      errors.push(
        `This campaign promises the code ${declared} and Shopify has no such discount. ` +
          `Create it first — shopify.create_discount_code will, under its own approval — ` +
          `or remove the code from the copy. Sending it would hand every recipient a code that fails at checkout.`,
      );
    } else if (check.verdict === "unverifiable") {
      warnings.push(
        `Could not confirm ${declared} exists in Shopify (${check.reason ?? "unknown"}). ` +
          `The app likely lacks read_discounts. Check the code by hand before sending.`,
      );
    } else {
      if (check.status && check.status !== "ACTIVE" && check.status !== "SCHEDULED") {
        warnings.push(`${declared} exists but Shopify reports it ${check.status.toLowerCase()}.`);
      }
      // A code that expires before the campaign lands is the subtler failure:
      // everything checks out at approval and the offer is dead on arrival.
      if (check.endsAt && campaign.scheduledAt) {
        const ends = new Date(check.endsAt).getTime();
        const sends = new Date(campaign.scheduledAt).getTime();
        if (Number.isFinite(ends) && Number.isFinite(sends) && ends <= sends) {
          warnings.push(
            `${declared} stops working ${check.endsAt}, which is before this campaign sends (${campaign.scheduledAt}).`,
          );
        }
      }
    }
  }

  if (scanned.length > 0) {
    warnings.push(
      `The copy mentions ${scanned.join(", ")}, which ${scanned.length === 1 ? "is" : "are"} not declared as this ` +
        `campaign's discountCode, so ${scanned.length === 1 ? "it was" : "they were"} not verified against the store. ` +
        `If ${scanned.length === 1 ? "it is" : "any is"} a real offer code, set discountCode so the gate can check it.`,
    );
  }

  return { errors, warnings, checks };
}
