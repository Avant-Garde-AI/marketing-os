/**
 * Register the email pack's four Actions with the runtime registry (WS3-R5 →
 * spec 20 A1). Factories construct per call inside runWithTenant — bindings
 * (repo, Klaviyo client, assembler) resolve from the tenant context.
 *
 * Import side effect: pulled in once by the agent/tool layer; the gate's
 * /api/actions/execute sees the same registry.
 */

import { createEmailActions, type EmailActionDeps } from "./actions";
import { assembleCampaign } from "./assemble";
import { createKlaviyoClient } from "./klaviyo-client";
import { emailRepo } from "./repo";
import { emailPreviewUrl } from "./preview-url";
import { registerAction } from "../actions/registry";
import { getTenant } from "../tenant-context";

function deps(): EmailActionDeps {
  return {
    repo: emailRepo,
    klaviyo: createKlaviyoClient(),
    assemble: assembleCampaign,
    // Board exports are binary; the DB-backed artifact repo stores text, so
    // asset bytes come from the design-surface export route (same bytes the
    // export wrote to the repo path — deterministic server render).
    readAsset: async (path: string) => {
      const base = process.env.MOS_AGENTS_PUBLIC_URL;
      if (!base) throw new Error("MOS_AGENTS_PUBLIC_URL not configured — cannot fetch board exports");
      // assetPath convention: email/campaigns/{id}/assets/{surfaceId}--{board}.png
      // (written by the drafting flow); resolve back through the export route.
      const m = path.match(/assets\/([^/]+?)(?:--([\w-]+))?\.png$/);
      if (!m) throw new Error(`unrecognized asset path "${path}"`);
      const url = `${base.replace(/\/$/, "")}/api/design-surfaces/export/${m[1]}${m[2] ? `?board=${encodeURIComponent(m[2])}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`asset fetch failed (${res.status}) for ${path}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    previewUrl: (campaignId: string) => emailPreviewUrl(getTenant().shop, campaignId),
    defaultSkeletonRef: "default",
  };
}

let registered = false;

/** Idempotent module-level registration. */
export function registerEmailActions(): void {
  if (registered) return;
  registered = true;
  registerAction("email.approve_plan", () => createEmailActions(deps()).approvePlan);
  registerAction("klaviyo.create_campaign_draft", () => createEmailActions(deps()).createCampaignDraft);
  registerAction("klaviyo.schedule_campaign", () => createEmailActions(deps()).scheduleCampaign);
  registerAction("klaviyo.cancel_send", () => createEmailActions(deps()).cancelSend);
}

registerEmailActions();
