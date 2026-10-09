/**
 * An owner's own edit to a campaign's subject, preview text or send time.
 *
 * Narrow on purpose. The body of an email is authored and checked by the
 * agent's upsert path (block validation, imagery, audiences); the three fields
 * here are the ones an owner changes at the last minute, and none of them can
 * make an email fail to render. A drafted campaign may be edited — the Klaviyo
 * draft goes stale, and scheduling re-drafts it before it sends.
 */
import { campaignPath, parseCampaign, serializeCampaign } from "./artifacts";
import { syncCampaignIndex } from "./index-sync";
import { emailRepo } from "./repo";
import { getTenant } from "../tenant-context";
import type { EmailCampaign } from "./types";

const EDITABLE = new Set(["proposed", "approved", "drafted"]);

export interface CampaignEdit {
  subject?: string;
  previewText?: string;
  scheduledAt?: string;
}

export async function ownerEditCampaign(id: string, edit: CampaignEdit, actor: string): Promise<EmailCampaign> {
  const raw = await emailRepo.readFile(campaignPath(id));
  if (raw === null) throw new Error(`Campaign ${id} not found`);
  const campaign = parseCampaign(raw);
  if (!EDITABLE.has(campaign.status))
    throw new Error(`This email is ${campaign.status}, so it can no longer be edited here.`);

  const next: EmailCampaign = { ...campaign };
  const changed: string[] = [];
  if (edit.subject !== undefined) {
    const subject = edit.subject.replace(/\s+/g, " ").trim();
    if (!subject) throw new Error("A subject line cannot be empty.");
    if (subject.length > 150) throw new Error("Keep the subject line under 150 characters.");
    if (subject !== campaign.subject) {
      next.subject = subject;
      // Keep the option list honest: the chosen subject is one of the options.
      if (!campaign.subjectCandidates.includes(subject)) next.subjectCandidates = [subject, ...campaign.subjectCandidates];
      changed.push("subject");
    }
  }
  if (edit.previewText !== undefined) {
    const previewText = edit.previewText.replace(/\s+/g, " ").trim();
    if (!previewText) throw new Error("Preview text cannot be empty.");
    if (previewText.length > 200) throw new Error("Keep the preview text under 200 characters.");
    if (previewText !== campaign.previewText) { next.previewText = previewText; changed.push("preview text"); }
  }
  if (edit.scheduledAt !== undefined) {
    const at = new Date(edit.scheduledAt);
    if (Number.isNaN(at.getTime())) throw new Error("That is not a valid time.");
    if (at.getTime() <= Date.now()) throw new Error("Pick a time in the future.");
    const iso = at.toISOString();
    if (!campaign.scheduledAt || new Date(campaign.scheduledAt).getTime() !== at.getTime()) { next.scheduledAt = iso; changed.push("send time"); }
  }
  if (changed.length === 0) return campaign;

  next.provenance = [...campaign.provenance, { claim: `Edited in the console by ${actor} (${changed.join(", ")}).`, origin: "owner" }];
  await emailRepo.writeFile(campaignPath(id), serializeCampaign(next));
  await syncCampaignIndex(getTenant().shop, next);
  return next;
}
