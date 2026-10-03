"use client";
import { useState } from "react";
type Entry = { postId: string; scheduledAt: string; expectedMaterialHash: string };
/** Two deliberate clicks: proposal review, then final approval with the verified session actor. */
export function SocialScheduling({ entries }: { entries: Entry[] }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [signedOut, setSignedOut] = useState(false), [done, setDone] = useState(false);
  const [proposal, setProposal] = useState<{ proposalId: string; summary: string } | null>(null);
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
  return <section style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: 8, margin: "1rem 0" }}>
    <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Approve scheduled publishing</h2>
    <p>Review every image or video, the complete captions and the dates below. Approval schedules {entries.length} post{entries.length === 1 ? "" : "s"} to send automatically. Changes require fresh approval.</p>
    {signedOut ? <p><a href="/login?next=%2Fsocial%2Fschedule">Sign in to approve schedules</a>. A review link alone cannot approve.</p>
      : done ? <p><a href="/calendar">View the scheduled calendar</a></p>
      : proposal ? <><p>{proposal.summary}</p><button disabled={busy} onClick={() => request("decide", true)}>Approve {entries.length} schedule{entries.length === 1 ? "" : "s"}</button>{" "}<button disabled={busy} onClick={() => request("decide", false)}>Decline</button></>
      : <button disabled={busy || !entries.length} onClick={() => request("propose")}>Review {entries.length} schedule{entries.length === 1 ? "" : "s"}</button>}
    {busy && <p role="status">Recording schedules… keep this page open and wait for the result before retrying.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
