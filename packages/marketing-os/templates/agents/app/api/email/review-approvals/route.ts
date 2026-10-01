/**
 * "Send approvals to Slack" from the month review sheet.
 *
 * A sheet link may ASK for approval cards; it can never approve one. Each
 * selected campaign gets the card for its next gate step, posted to Slack and
 * the console, where a verified human still decides every one individually.
 *
 * Blast radius of a leaked link: cards for this month's campaigns appear in the
 * store's own approval channel. Bounded by the signed month, the batch cap, and
 * the skip for a campaign that already has that card waiting.
 */

import { NextRequest, NextResponse } from "next/server";
import { runWithTenant } from "../../../../lib/tenant-context";
import { verifyLink } from "../../../../lib/email/review-links";
import { loadCampaignDetail } from "../../../../lib/email/console-data";
import { nextGateStep } from "../../../../lib/email/next-step";
import { proposeAction } from "../../../../lib/actions/propose";

export const runtime = "nodejs";
export const maxDuration = 300;

const ID_RE = /^[A-Za-z0-9._-]+$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_BATCH = 25;

type Result = { campaignId: string; status: "posted" | "skipped" | "error"; message: string };

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const shop = typeof payload.shop === "string" ? payload.shop : "";
  const month = typeof payload.month === "string" ? payload.month : "";
  const t = typeof payload.t === "string" ? payload.t : null;
  const e = typeof payload.e === "string" ? payload.e : null;
  const ids = Array.isArray(payload.campaignIds)
    ? [...new Set(payload.campaignIds.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))]
    : [];

  if (!shop || !MONTH_RE.test(month)) return NextResponse.json({ error: "shop and month required" }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ error: "select at least one campaign" }, { status: 400 });
  if (ids.length > MAX_BATCH) return NextResponse.json({ error: `at most ${MAX_BATCH} at once` }, { status: 413 });

  const verdict = verifyLink("sheet", shop, month, t, e);
  if (verdict !== "ok") {
    return NextResponse.json(
      { error: verdict === "expired" ? "This review link expired. Ask for a fresh one." : "invalid review token" },
      { status: verdict === "expired" ? 410 : 403 },
    );
  }

  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  const results = await runWithTenant({ shop, storeSlug }, async () => {
    const out: Result[] = [];
    // Sequential on purpose: cards land in Slack in calendar order.
    for (const campaignId of ids) {
      try {
        const detail = await loadCampaignDetail(campaignId);
        // The token signs the MONTH, so a campaign outside it is out of scope.
        if (!detail?.row || detail.row.calendarMonth !== month) {
          out.push({ campaignId, status: "skipped", message: "Not in this month" });
          continue;
        }
        // The artifact is the truth; the index row lags it after an approval,
        // and a stale status would ask for a card the gate then refuses.
        const step = nextGateStep({
          id: campaignId,
          status: detail.artifact?.status ?? detail.row.status,
          scheduledAt: detail.artifact?.scheduledAt ?? detail.row.scheduledAt,
        });
        if (!step.ok) {
          out.push({ campaignId, status: "skipped", message: step.reason });
          continue;
        }
        if (detail.pending.some((p) => p.kind === step.kind)) {
          out.push({ campaignId, status: "skipped", message: `"${step.label}" is already waiting in Slack` });
          continue;
        }
        const proposed = await proposeAction({ kind: step.kind, params: step.params });
        out.push({
          campaignId,
          status: proposed.posted ? "posted" : "error",
          message: proposed.posted ? `${step.label}: card sent to Slack` : "Proposal saved but the Slack card did not post",
        });
      } catch (err) {
        out.push({ campaignId, status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  });

  return NextResponse.json({ results });
}
