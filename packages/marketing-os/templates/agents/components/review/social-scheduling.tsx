"use client";
import { useState } from "react";
import { PrimaryButton, OutlineButton } from "../primitives";
type PendingProposal = { proposalId: string; summary: string };
type Entry = { postId: string; scheduledAt: string; expectedMaterialHash: string };
/** Two deliberate clicks: proposal review, then final approval with the verified session actor. */
export function SocialScheduling({ entries, initialProposal = null }: { entries: Entry[]; initialProposal?: PendingProposal | null }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [signedOut, setSignedOut] = useState(false), [done, setDone] = useState(false);
  const [proposal, setProposal] = useState<PendingProposal | null>(initialProposal);
  async function request(operation: "propose" | "decide", approve?: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/social/scheduling", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, params: { entries }, ...(proposal ? { proposalId: proposal.proposalId } : {}),
          ...(approve !== undefined ? { approve } : {}) }) });
      if (response.status === 401) { setSignedOut(true); return; }
      const body = await response.json();
      if (!response.ok || body.ok === false) throw new Error(body.error ?? "Scheduling did not complete");
      if (operation === "propose") setProposal(body);
      else { setProposal(null); setMessage(body.summary ?? "Decision recorded."); setDone(!!approve); }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Scheduling unavailable"); }
    finally { setBusy(false); }
  }
  return <section className="my-6 border border-hairline bg-raised p-5 text-[14px] leading-relaxed">
    <h2 className="mb-2 font-display text-[22px]">Approve scheduled publishing</h2>
    <p>Review every image or video, the complete captions and the dates below. Approval schedules {entries.length} post{entries.length === 1 ? "" : "s"} to send automatically. Changes require fresh approval.</p>
    {signedOut ? <p><a href="/login?next=%2Fsocial%2Fschedule">Sign in to approve schedules</a>. A review link alone cannot approve.</p>
      : done ? <p><a href="/calendar">View the scheduled calendar</a></p>
      : proposal ? <><p className="my-3">{proposal.summary}</p><PrimaryButton disabled={busy} onClick={() => request("decide", true)}>Approve {entries.length} schedule{entries.length === 1 ? "" : "s"}</PrimaryButton>{" "}<OutlineButton disabled={busy} onClick={() => request("decide", false)}>Decline</OutlineButton></>
      : <PrimaryButton className="mt-4" disabled={busy || !entries.length} onClick={() => request("propose")}>Review {entries.length} schedule{entries.length === 1 ? "" : "s"}</PrimaryButton>}
    {busy && <p role="status" className="mt-3 text-ink-2">{proposal ? "Recording your decision…" : "Checking media and preparing your approval…"} Keep this page open until the result appears.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
