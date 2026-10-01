/**
 * Note-driven refinement — closes the loop review-notes.ts describes as
 * manual: "build → share link → notes → agent revises → Slack approves."
 *
 * Deliberately NOT an agentic tool-loop. Handing an unattended cron a
 * general-purpose chat agent with a broad tool surface and a write path is a
 * bigger blast radius than this needs — the same reasoning that made the
 * review-notes API route accept only one write ("bounded on purpose"). This
 * is a single constrained structured-output call, scoped to exactly the
 * fields a review note can plausibly ask to change: subject, previewText,
 * and section copy. It never touches audience, schedule, status, or utm, and
 * it only ever acts on a `proposed` campaign — one already `approved` or
 * `drafted` in Klaviyo must not have its local artifact silently diverge
 * from what a human already signed off on there (spec 31's whole point).
 */

import { generateObject } from "ai";
import { z } from "zod";
import { emailBlockSchema } from "../email-assembly/types";
import { campaignPath, serializeCampaign } from "./artifacts";
import { addNote, resolveNotes } from "./review-notes";
import type { ReviewNote } from "./review-note-shape";
import type { EmailCampaign, EmailRepo } from "./types";

const REFINE_MODEL = "google/gemini-2.5-flash";

const htmlSectionRevision = z.object({
  slot: z.string().min(1),
  blocks: z.array(emailBlockSchema).min(1),
});

const revisionSchema = z.object({
  subject: z.string().min(1),
  previewText: z.string().min(1),
  sections: z
    .array(htmlSectionRevision)
    .min(1)
    .describe(
      "One entry per HTML section slot in the campaign, same slots, same order — do not add, remove, or rename a slot.",
    ),
  changeSummary: z
    .string()
    .min(1)
    .describe(
      "One short paragraph addressed to the person who left the notes: exactly what changed and why. Reference each note it addresses.",
    ),
});

/** Who the loop signs its own replies as. The loop must never treat a note
 *  carrying this author as reviewer feedback — see refineCampaignFromNotes. */
export const AGENT_AUTHOR = "Agent (auto-revise)";

export interface RefineResult {
  campaignId: string;
  action:
    | "revised"
    | "no-open-notes"
    | "skipped-not-proposed"
    | "no-html-sections"
    | "revision-failed"
    | "structural-mismatch";
  detail?: string;
}

function notesBlock(notes: ReviewNote[]): string {
  return notes.map((n, i) => `${i + 1}. [slot: ${n.slot ?? "general"}] ${n.author}: ${n.body}`).join("\n");
}

export async function refineCampaignFromNotes(
  repo: EmailRepo,
  campaign: EmailCampaign,
  allNotes: ReviewNote[],
): Promise<RefineResult> {
  // The loop's own replies land in the same thread, unresolved, and
  // listOpenNotes returns them alongside the reviewer's. Fed back in, each
  // reply became "feedback" for the next pass: 165 model calls, bot commits
  // and provenance entries per campaign in the week after this shipped, every
  // one concluding "this note is just a summary of previous actions." A reply
  // is the loop's OUTPUT. It is closed out here and never used as input.
  const ownReplies = allNotes.filter((n) => n.author === AGENT_AUTHOR);
  const notes = allNotes.filter((n) => n.author !== AGENT_AUTHOR);
  if (ownReplies.length > 0) await resolveNotes(ownReplies.map((n) => n.id));
  if (notes.length === 0) return { campaignId: campaign.id, action: "no-open-notes" };

  // A note left after a campaign moved past `proposed` is still worth a
  // human's attention (that is what listOpenNotes / the console's open-notes
  // view is for) — it just does not get auto-applied. Silently rewriting a
  // campaign's content out from under an approval or a live Klaviyo draft is
  // the exact drift spec 31 was written to stop.
  if (campaign.status !== "proposed") {
    return { campaignId: campaign.id, action: "skipped-not-proposed", detail: campaign.status };
  }

  const htmlSections = campaign.sections.filter(
    (s): s is Extract<EmailCampaign["sections"][number], { type: "html" }> => s.type === "html",
  );
  if (htmlSections.length === 0) {
    return { campaignId: campaign.id, action: "no-html-sections" };
  }

  const prompt = `You are revising an existing email campaign draft to address reviewer feedback. Change ONLY what a note below asks you to change — do not rewrite copy nobody flagged, do not change tone or voice, do not add or remove sections.

You cannot see or generate real photography, screenshots, or any other external asset. If a note asks for real imagery (e.g. "add a screenshot of the dashboard", "intermix real photos") — do NOT invent, guess, or fabricate an image/surface block or a src/imageUrl to satisfy it. That is not something you can do; a human has to supply the actual asset separately. Skip that part of the note entirely and say so plainly in changeSummary (e.g. "Could not add real dashboard imagery — needs a human to supply the actual screenshot; everything else in your notes is applied.") so it stays visible as still-open instead of silently dropped.

A note can be STALE: left before an earlier pass (human or automated) already fixed the exact thing it describes. The PROVENANCE LOG below is the record of decisions and corrections already made on this campaign — read it BEFORE applying a note. If a note's ask is already satisfied by something in provenance (a value it names as wrong may already have been corrected; a choice it asks you to make may already have been made and recorded), do NOT re-litigate or undo that decision — leave that part of the campaign as it is and say in changeSummary that it was already addressed. Only change things a note asks for that provenance does not already show as settled.

PROVENANCE LOG (most recent last):
${campaign.provenance.map((p, i) => `${i + 1}. [${p.origin}] ${p.claim}`).join("\n")}

CURRENT SUBJECT: ${campaign.subject ?? "(none)"}
CURRENT PREVIEW TEXT: ${campaign.previewText ?? "(none)"}
CURRENT SECTIONS (slot -> blocks):
${JSON.stringify(
  htmlSections.map((s) => ({ slot: s.slot, blocks: s.blocks })),
  null,
  2,
)}

REVIEWER NOTES:
${notesBlock(notes)}

Return the complete revised subject, previewText, and the full sections array — every slot from CURRENT SECTIONS must appear exactly once, same order — with edits applied only where a note calls for one. Also return a changeSummary addressed to the reviewer.`;

  let revision: z.infer<typeof revisionSchema>;
  try {
    const result = await generateObject({ model: REFINE_MODEL, schema: revisionSchema, prompt });
    revision = result.object;
  } catch (e) {
    return { campaignId: campaign.id, action: "revision-failed", detail: e instanceof Error ? e.message : String(e) };
  }

  const beforeSlots = htmlSections.map((s) => s.slot).sort();
  const afterSlots = revision.sections.map((s) => s.slot).sort();
  if (JSON.stringify(beforeSlots) !== JSON.stringify(afterSlots)) {
    return {
      campaignId: campaign.id,
      action: "structural-mismatch",
      detail: `slots changed: had [${beforeSlots.join(", ")}], got [${afterSlots.join(", ")}]`,
    };
  }

  // Belt-and-suspenders on top of the prompt instruction: the model has no
  // way to produce a real asset, so any `src` that was not already present
  // before this pass is a fabrication, not a revision. Reject outright
  // rather than ship a broken image into a live campaign.
  const knownSrcs = new Set(
    htmlSections.flatMap((s) => s.blocks).flatMap((b) => (b.kind === "image" ? [(b as { src: string }).src] : [])),
  );
  const newSrcs = revision.sections
    .flatMap((s) => s.blocks)
    .flatMap((b) => (b.kind === "image" ? [b.src] : []))
    .filter((src) => !knownSrcs.has(src));
  if (newSrcs.length > 0) {
    return {
      campaignId: campaign.id,
      action: "structural-mismatch",
      detail: `revision introduced ${newSrcs.length} image src(s) not present before this pass — fabricated asset, rejected: ${newSrcs.join(", ")}`,
    };
  }

  const revisedBySlot = new Map(revision.sections.map((s) => [s.slot, s.blocks]));
  const nextSections: EmailCampaign["sections"] = campaign.sections.map((s) =>
    s.type === "html" ? { ...s, blocks: revisedBySlot.get(s.slot)! } : s,
  );

  const next: EmailCampaign = {
    ...campaign,
    subject: revision.subject,
    previewText: revision.previewText,
    sections: nextSections,
    provenance: [
      ...campaign.provenance,
      {
        claim: `Auto-revised by the note-driven refine loop in response to ${notes.length} open note(s): ${revision.changeSummary}`,
        origin: "agent",
      },
    ],
  };

  await repo.writeFile(campaignPath(next.id), serializeCampaign(next));

  // Resolve the notes this pass acted on, then reply so the thread shows what
  // happened — the same shape a human reviewer would see from a colleague.
  await resolveNotes(notes.map((n) => n.id));
  await addNote({
    campaignId: campaign.id,
    author: AGENT_AUTHOR,
    body: revision.changeSummary,
    source: "console",
  });

  return { campaignId: campaign.id, action: "revised", detail: revision.changeSummary };
}
