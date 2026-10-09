"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Where a campaign is, and the one button that moves it.
 *
 * The lifecycle has three governed steps and the console used to show only a
 * status word — "drafted" — with nothing to say what came next or how to make
 * it happen. This is the same lifecycle drawn as a line, with a single action:
 * take it the rest of the way to scheduled.
 */

const STEPS = [
  { key: "approved", label: "Approved" },
  { key: "drafted", label: "In Klaviyo" },
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent" },
] as const;

const REACHED: Record<string, number> = { proposed: 0, approved: 1, drafted: 2, scheduled: 3, sent: 4, measured: 4 };

export function sendTimeLabel(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  // The viewer's own clock, named — the rest of the console prints UTC, which
  // is how a 10:00 send came to read as "3:00 PM".
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** `datetime-local` wants local wall time with no offset. */
function toLocalInput(at: string | null): string {
  const d = at ? new Date(at) : new Date(Date.now() + 24 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type StepResult = { label: string; ok: boolean; message: string };

export function CampaignWorkflow({
  campaignId,
  status,
  scheduledAt,
  audience,
}: {
  campaignId: string;
  status: string;
  scheduledAt: string | null;
  audience?: string;
}) {
  const router = useRouter();
  const reached = REACHED[status] ?? 0;
  const future = scheduledAt ? new Date(scheduledAt).getTime() > Date.now() + 10 * 60 * 1000 : false;
  const [editing, setEditing] = useState(!future);
  const [local, setLocal] = useState(() => toLocalInput(future ? scheduledAt : null));
  const [working, setWorking] = useState(false);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const chosen = editing ? (local ? new Date(local).toISOString() : null) : scheduledAt;

  async function run() {
    if (!chosen) return;
    setWorking(true);
    setError(null);
    setSteps([]);
    try {
      const res = await fetch("/api/email/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, through: true, ...(editing ? { sendAt: chosen } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { steps?: StepResult[]; error?: string };
      setSteps(body.steps ?? []);
      if (!res.ok && !body.steps?.length) setError(body.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="border border-hairline bg-raised px-5 py-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {STEPS.map((s, i) => {
          const done = reached > i;
          const next = reached === i;
          return (
            <li key={s.key} className="flex items-center gap-2">
              {i > 0 && <span className={`h-px w-6 ${done ? "bg-gold" : "bg-hairline-strong"}`} />}
              <span
                className={
                  done
                    ? "bg-inverse px-2.5 py-1 text-[12px] font-medium text-paper"
                    : next
                      ? "border border-gold px-2.5 py-1 text-[12px] font-medium text-ink"
                      : "border border-hairline px-2.5 py-1 text-[12px] text-ink-3"
                }
              >
                {done ? "✓ " : ""}
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {reached >= 4 ? (
        <p className="mt-3 text-[14px] text-ink-2">Sent. Nothing left to do.</p>
      ) : reached === 3 ? (
        <p className="mt-3 text-[14px] text-ink-2">
          Scheduled. Klaviyo sends it {sendTimeLabel(scheduledAt) ?? "at its send time"}
          {audience ? ` to ${audience}` : ""}.
        </p>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3">
            {editing ? (
              <input
                type="datetime-local"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                disabled={working}
                className="border border-hairline-strong bg-paper px-2 py-1.5 text-[14px]"
                aria-label="Send time"
              />
            ) : (
              <span className="text-[14px] text-ink-2">
                Sends {sendTimeLabel(scheduledAt)}
                {audience ? ` to ${audience}` : ""}
              </span>
            )}
            <button
              type="button"
              onClick={run}
              disabled={working || !chosen}
              className="border border-hairline-strong bg-inverse px-4 py-2 text-[12px] font-medium uppercase tracking-[0.14em] text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {working ? "Working…" : reached === 0 ? "Approve & schedule" : "Schedule it"}
            </button>
            {!editing && !working && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[13px] text-ink-3 underline-offset-2 hover:underline"
              >
                Change time
              </button>
            )}
          </div>
          <p className="mt-2 text-[13px] text-ink-3">
            {working
              ? "Finishing every remaining step. The Klaviyo draft takes about a minute — keep this page open."
              : !future && !local
                ? "Pick a send time."
                : !future
                  ? "Its planned send time has passed, so pick a new one. One click then finishes every remaining step."
                  : "One click finishes every remaining step and schedules the send. This is the approval to send."}
          </p>
        </div>
      )}

      {steps.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {steps.map((s, i) => (
            <li key={i} className={s.ok ? "text-ink-2" : "border-l-2 border-gold pl-3 text-ink"}>
              {s.ok ? "✓" : "Stopped at"} {s.label}
              {s.ok ? "" : ` — ${s.message}`}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 border-l-2 border-gold pl-3 text-[13px] text-ink">{error}</p>}
    </div>
  );
}
