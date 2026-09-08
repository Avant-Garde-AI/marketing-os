/**
 * Choosing the campaign's headline, from the review room.
 *
 * WHY THIS IS A WRITE AND APPROVAL IS NOT. The review room deliberately cannot
 * approve: a token proves possession of a link, not identity, and authorising a
 * send needs a real user id in the audit trail. Choosing which of three
 * already-written headlines runs is a different kind of act — it selects among
 * options the campaign already contains, it changes no audience and no offer,
 * it sends nothing, and it is reversible by choosing again. It is content
 * feedback with a narrower shape than a note, so it lives where the reviewing
 * happens rather than forcing a round trip through chat.
 *
 * The send gate is untouched: `email.approve_campaign` and
 * `klaviyo.create_campaign_draft` still run through Slack.
 *
 * A custom headline is accepted too, and recorded as a `custom` option so the
 * artifact still shows what was chosen and what it beat. Nothing is lost by
 * writing your own.
 */

import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../lib/tenant-context";
import { verifyLink } from "../../../../lib/email/review-links";
import { emailRepo } from "../../../../lib/email/repo";
import { campaignPath, parseCampaign, serializeCampaign } from "../../../../lib/email/artifacts";
import { syncCampaignIndex } from "../../../../lib/email/index-sync";
import type { HeadlineOption } from "../../../../lib/email/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9._-]+$/;
const MAX_HEADLINE = 200;
const MAX_SUBHEADLINE = 300;

/** A campaign already drafted into Klaviyo must not have its subject changed
 *  underneath the approval that staged it. */
const FROZEN = new Set(["drafted", "scheduled", "sent", "measured"]);

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const campaignId = typeof payload.campaignId === "string" ? payload.campaignId : "";
  const shop = typeof payload.shop === "string" ? payload.shop : "";
  const t = typeof payload.t === "string" ? payload.t : null;
  const e = typeof payload.e === "string" ? payload.e : null;
  const optionId = typeof payload.optionId === "string" ? payload.optionId.trim() : "";
  const headline = typeof payload.headline === "string" ? payload.headline.trim() : "";
  const subheadline = typeof payload.subheadline === "string" ? payload.subheadline.trim() : "";
  const author = typeof payload.author === "string" ? payload.author.trim().slice(0, 80) : "";

  if (!campaignId || !ID_RE.test(campaignId) || !shop) {
    return NextResponse.json({ error: "campaignId and shop required" }, { status: 400 });
  }
  if (!optionId && !headline) {
    return NextResponse.json(
      { error: "choose one of the options, or write a headline of your own" },
      { status: 400 },
    );
  }
  if (headline.length > MAX_HEADLINE || subheadline.length > MAX_SUBHEADLINE) {
    return NextResponse.json({ error: "that headline is too long to be a subject line" }, { status: 413 });
  }

  const verdict = verifyLink("review", shop, campaignId, t, e);
  if (verdict !== "ok") {
    return NextResponse.json(
      { error: verdict === "expired" ? "this review link has expired" : "this link isn't valid" },
      { status: verdict === "expired" ? 410 : 403 },
    );
  }

  try {
    const result = await runWithTenant(
      { shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") },
      async () => {
        const raw = await emailRepo.readFile(campaignPath(campaignId));
        if (raw === null) throw new Error("no such campaign");
        const campaign = parseCampaign(raw);
        if (FROZEN.has(campaign.status)) {
          throw new Error(
            `this campaign is "${campaign.status}" — its subject is locked to the draft that was already staged`,
          );
        }

        const options = [...(campaign.headlineOptions ?? [])];
        let chosen: HeadlineOption | undefined;

        if (headline) {
          // Written by hand. Keep it as an option so the artifact records what
          // ran and what it was chosen over, rather than the set silently
          // disagreeing with the live subject.
          chosen = {
            id: "custom",
            headline,
            subheadline: subheadline || campaign.previewText || "",
            why: author ? `Written by ${author} during review` : "Written during review",
          };
          const at = options.findIndex((o) => o.id === "custom");
          if (at >= 0) options[at] = chosen;
          else options.push(chosen);
        } else {
          chosen = options.find((o) => o.id === optionId);
          if (!chosen) throw new Error(`no headline option "${optionId}" on this campaign`);
        }

        const next = {
          ...campaign,
          headlineOptions: options,
          selectedHeadlineId: chosen.id,
          subject: chosen.headline,
          previewText: chosen.subheadline,
          provenance: [
            ...campaign.provenance,
            {
              claim: `headline "${chosen.headline}" selected during review${author ? ` by ${author}` : ""}`,
              origin: "owner" as const,
            },
          ],
        };
        await emailRepo.writeFile(campaignPath(campaignId), serializeCampaign(next));
        // Without this the console and calendar keep showing the old subject —
        // the exact half-built state where a change looks applied and isn't.
        await syncCampaignIndex(shop, next);
        return { subject: next.subject, previewText: next.previewText, selectedHeadlineId: chosen.id };
      },
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email/headline] ${campaignId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
