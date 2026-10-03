"use client";
import { useEffect, useState } from "react";
type State = { account: { id: string; username: string }; status: string; expectedManifestHash: string;
  scheduledAt: string | null; platform: { permalink: string; id: string } | null; attempt: string | null };
/** The review remains readable by link holders; decisions require a verified console session. */
export function SocialPublishing({ postId, manifestHash }: { postId: string; manifestHash: string }) {
  const [state, setState] = useState<State | null>(null), [message, setMessage] = useState("");
  const [signedOut, setSignedOut] = useState(false), [busy, setBusy] = useState(false);
  const [time, setTime] = useState(""), [proposal, setProposal] = useState<{ proposalId: string; summary: string; mode: "publish" | "schedule" } | null>(null);
  async function refresh() {
    const res = await fetch(`/api/social/carousel/publishing?postId=${encodeURIComponent(postId)}`, { cache: "no-store" });
    if (res.status === 401) { setSignedOut(true); return; }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Publishing unavailable");
    if (body.expectedManifestHash !== manifestHash) throw new Error("This carousel changed. Reload to review the latest post.");
    setState(body); setSignedOut(false);
  }
  useEffect(() => { refresh().catch(e => setMessage(e.message)); }, [postId, manifestHash]);
  async function request(body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/social/carousel/publishing", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, expectedManifestHash: manifestHash, ...body }) });
      const out = await res.json();
      if (!res.ok || out.ok === false) throw new Error(out.error ?? out.summary ?? "The request did not complete");
      if (body.operation === "propose") setProposal({ ...out, mode: body.mode as "publish" | "schedule" });
      else { setProposal(null); setMessage(out.summary ?? (body.approve ? "Decision recorded. Reload to check the final status." : "Approval declined.")); await refresh(); }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Publishing unavailable"); }
    finally { setBusy(false); }
  }
  const blocked = !!state && (state.status === "published" || (state.attempt !== null && state.attempt !== "completed"));
  return <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem", margin: "1.5rem 0", maxWidth: 720 }}>
    <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Publish this carousel</h2>
    {signedOut ? <p><a href={`/login?next=${encodeURIComponent(typeof window === "undefined" ? "/" : window.location.pathname + window.location.search)}`}>Sign in to publish or schedule</a>. Anyone with this review link can still view the post and leave notes.</p>
      : state ? <>
        <p>Instagram <strong>@{state.account.username}</strong> · {state.status}{state.scheduledAt ? ` · ${new Date(state.scheduledAt).toLocaleString()}` : ""}</p>
        {state.platform && <p><a href={state.platform.permalink || `https://www.instagram.com/${state.account.username}/`} target="_blank" rel="noopener noreferrer">View published post</a></p>}
        {blocked && state.status !== "published" && <p>Publishing needs reconciliation before another attempt. Check Instagram and the approval result.</p>}
        {!blocked && !proposal && <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <button disabled={busy} onClick={() => request({ operation: "propose", mode: "publish", accountId: state.account.id, accountUsername: state.account.username })}>Publish now</button>
          <label>Publish time (your local time) <input type="datetime-local" value={time} disabled={busy} onChange={e => setTime(e.target.value)} /></label>
          <button disabled={busy || !time || Date.parse(time) <= Date.now()} onClick={() => request({ operation: "propose", mode: "schedule", scheduledAt: new Date(time).toISOString(), accountId: state.account.id, accountUsername: state.account.username })}>Schedule</button>
        </div>}
        {proposal && <div><p>{proposal.summary}</p><p>Approval sends the complete caption and all three images in the order shown above.</p>
          <button disabled={busy} onClick={() => request({ operation: "decide", proposalId: proposal.proposalId, approve: true })}>Approve {proposal.mode === "schedule" ? "schedule" : "publish"}</button>{" "}
          <button disabled={busy} onClick={() => request({ operation: "decide", proposalId: proposal.proposalId, approve: false })}>Decline</button>
        </div>}
      </> : !message && <p>Checking the connected account…</p>}
    {busy && <p role="status">Working… please keep this page open. Do not retry until the result is known.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
