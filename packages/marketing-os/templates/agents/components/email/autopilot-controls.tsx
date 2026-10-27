"use client";
import { useEffect, useState } from "react";
type Status = { grant: null | { status: string; policy: { sendDays: string[]; localTime: string; timeZone: string; holdHours: number } }; batches: { id: string; window_from: string; window_through: string; phase: string; detail?: string; staged?: { campaignId: string; subject?: string; state: string; scheduleProposalId?: string }[] }[] };
export function EmailAutopilotControls() {
  const [state, setState] = useState<Status | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function refresh() {
    const r = await fetch("/api/email/autopilot", { cache: "no-store" }); const b = await r.json();
    if (!r.ok) throw Error(b.error ?? "Email automation unavailable"); setState(b);
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); const id = setInterval(() => refresh().catch(() => {}), 30000); return () => clearInterval(id); }, []);
  async function control(operation: string, proposalId?: string) {
    setBusy(true); setError("");
    try { const r = await fetch("/api/email/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, ...(proposalId ? { proposalId } : {}) }) }); const b = await r.json(); if (!r.ok) throw Error(b.error ?? "Control failed"); await refresh(); }
    catch(e) { setError(e instanceof Error ? e.message : "Control failed"); } finally { setBusy(false); }
  }
  return <section className="my-6 border border-hairline p-5">
    <h2 className="font-display text-2xl">Automatic two-week email batches</h2>
    <p className="my-3">Create two weeks of email seven days ahead, following your strategy’s cadence and audiences. A Slack digest starts the review period; eligible campaigns send automatically unless you Hold or Pause. No approval is needed for each covered campaign.</p>
    <p className="my-3">Automation: <strong>{state?.grant?.status ?? "not enabled"}</strong>{state?.grant && ` · ${state.grant.policy.sendDays.join(" / ")} at ${state.grant.policy.localTime} ${state.grant.policy.timeZone} · ${state.grant.policy.holdHours} hours to decline`}</p>
    {error && <p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button className="border px-4 py-2" disabled={busy || !state} onClick={() => control(!state?.grant ? "enable" : state.grant.status === "paused" ? "resume" : "pause")}>{!state?.grant ? "Enable automatic email creation and sending" : state.grant.status === "paused" ? "Resume email automation" : "Pause email automation"}</button>
      {state?.grant && <button className="border px-4 py-2" disabled={busy || state.grant.status !== "active"} onClick={() => control("tick")}>Continue production now</button>}
    </div>
    {state?.batches.map(b => <div key={b.id} className="mt-4"><p>{b.window_from.slice(0,10)}–{b.window_through.slice(0,10)} · <strong>{b.phase}</strong></p>{b.detail && <p>{b.detail}</p>}<ul>{b.staged?.map(c => <li key={c.campaignId} className="my-2"><a className="underline" href={`/email/campaigns/${encodeURIComponent(c.campaignId)}`}>{c.subject ?? c.campaignId}</a> · {c.state === "held" ? "Sends automatically after review" : c.state}{c.state === "held" && c.scheduleProposalId && <button className="ml-3 border px-3 py-1" disabled={busy} onClick={() => control("hold", c.scheduleProposalId)}>Hold this email</button>}</li>)}</ul></div>)}
  </section>;
}
