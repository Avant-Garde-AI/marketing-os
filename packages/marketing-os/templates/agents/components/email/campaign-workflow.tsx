"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Where a campaign is, what it says, and the one button that moves it.
 *
 * The lifecycle has three governed steps and the console used to show only a
 * status word — "drafted" — with nothing to say what came next or how to make
 * it happen. This is the same lifecycle drawn as a line, with the three things
 * an owner changes at the last minute (subject, preview text, send time)
 * editable beside it, and a single action: take it the rest of the way.
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
type Field = "subject" | "previewText" | "scheduledAt";

const LEAD_MS = 10 * 60 * 1000;
const linkButton = "text-[13px] text-ink-3 underline-offset-2 hover:underline disabled:opacity-40";
const primaryButton =
  "border border-hairline-strong bg-inverse px-4 py-2 text-[12px] font-medium uppercase tracking-[0.14em] text-paper transition-opacity hover:opacity-90 disabled:opacity-40";

export function CampaignWorkflow({
  campaignId,
  status: initialStatus,
  scheduledAt: initialScheduledAt,
  audience,
  subject: initialSubject = null,
  previewText: initialPreviewText = null,
}: {
  campaignId: string;
  status: string;
  scheduledAt: string | null;
  audience?: string;
  subject?: string | null;
  previewText?: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [scheduledAt, setScheduledAt] = useState(initialScheduledAt);
  const [subject, setSubject] = useState(initialSubject);
  const [previewText, setPreviewText] = useState(initialPreviewText);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState<"save" | "run" | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  // Times are formatted on the viewer's clock, which the server cannot know.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const reached = REACHED[status] ?? 0;
  const editable = reached < 4;
  const future = scheduledAt ? new Date(scheduledAt).getTime() > Date.now() + LEAD_MS : false;
  const when = mounted ? sendTimeLabel(scheduledAt) : null;

  function open(field: Field) {
    setMessage(null);
    setSteps([]);
    setDraft(field === "scheduledAt" ? toLocalInput(future ? scheduledAt : null) : (field === "subject" ? subject : previewText) ?? "");
    setEditing(field);
  }

  async function post(url: string, payload: Record<string, unknown>) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, body };
  }

  async function save() {
    if (!editing) return;
    setWorking("save");
    setMessage(null);
    try {
      const value = editing === "scheduledAt" ? (draft ? new Date(draft).toISOString() : "") : draft;
      const { res, body } = await post("/api/email/campaign-edit", { campaignId, [editing]: value });
      // `ok: true` in the body, not just a 2xx: an expired session redirects to
      // an HTML login page, which is also a 2xx and must never read as "saved".
      if (!res.ok || body.ok !== true) {
        setMessage(typeof body.error === "string" ? body.error : "That did not save. Reload the page and sign in again.");
        return;
      }
      if (typeof body.subject === "string") setSubject(body.subject);
      if (typeof body.previewText === "string") setPreviewText(body.previewText);
      if (typeof body.scheduledAt === "string") setScheduledAt(body.scheduledAt);
      if (typeof body.status === "string") setStatus(body.status);
      setEditing(null);
      setMessage(body.unscheduled ? "Saved. It is off the schedule until you schedule it again." : "Saved.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  }

  async function run() {
    setWorking("run");
    setMessage(null);
    setSteps([]);
    try {
      const { res, body } = await post("/api/email/advance", { campaignId, through: true });
      const results = Array.isArray(body.steps) ? (body.steps as StepResult[]) : [];
      setSteps(results);
      if (res.ok && body.ok === true) {
        if (typeof body.status === "string") setStatus(body.status);
      } else if (results.length === 0) {
        setMessage(typeof body.error === "string" ? body.error : "That did not run. Reload the page and sign in again.");
      } else if (typeof body.status === "string") {
        setStatus(body.status);
      }
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  }

  const busy = working !== null;
  const textEditor = (field: "subject" | "previewText", label: string, limit: number) =>
    editing === field ? (
      <div>
        <input
          type="text"
          value={draft}
          maxLength={limit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) void save(); }}
          disabled={busy}
          aria-label={label}
          className="w-full border border-hairline-strong bg-paper px-3 py-2 text-[15px]"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy || !draft.trim()} className={primaryButton}>
            {working === "save" ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(null)} disabled={busy} className={linkButton}>Cancel</button>
          <span className="text-[12px] text-ink-3">{draft.length} / {limit}</span>
          {status === "scheduled" && <span className="text-[12px] text-ink-3">Saving takes it off the schedule until you schedule it again.</span>}
        </div>
      </div>
    ) : null;

  return (
    <div className="border border-hairline-strong bg-raised px-5 py-4">
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

      {/* What it says */}
      <dl className="mt-4 space-y-3 border-t border-hairline pt-4">
        <div>
          <dt className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-[12px] uppercase tracking-[0.14em] text-ink-3">Subject</span>
            {editable && editing !== "subject" && <button type="button" onClick={() => open("subject")} disabled={busy} className={linkButton}>Edit</button>}
          </dt>
          <dd className="m-0">{textEditor("subject", "Subject line", 150) ?? <span className="font-display text-[19px] leading-snug">{subject ?? "No subject yet"}</span>}</dd>
        </div>
        <div>
          <dt className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-[12px] uppercase tracking-[0.14em] text-ink-3">Preview text</span>
            {editable && editing !== "previewText" && <button type="button" onClick={() => open("previewText")} disabled={busy} className={linkButton}>Edit</button>}
          </dt>
          <dd className="m-0">{textEditor("previewText", "Preview text", 200) ?? <span className="text-[14px] text-ink-2">{previewText ?? "No preview text yet"}</span>}</dd>
        </div>
        <div>
          <dt className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-[12px] uppercase tracking-[0.14em] text-ink-3">{reached >= 4 ? "Sent" : "Sends"}</span>
            {editable && editing !== "scheduledAt" && <button type="button" onClick={() => open("scheduledAt")} disabled={busy} className={linkButton}>Change time</button>}
          </dt>
          <dd className="m-0">
            {editing === "scheduledAt" ? (
              <div className="flex flex-wrap items-center gap-3">
                <input type="datetime-local" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy}
                  aria-label="Send time" className="border border-hairline-strong bg-paper px-2 py-1.5 text-[14px]" />
                <button type="button" onClick={save} disabled={busy || !draft} className={primaryButton}>{working === "save" ? "Saving…" : "Save time"}</button>
                <button type="button" onClick={() => setEditing(null)} disabled={busy} className={linkButton}>Cancel</button>
                {status === "scheduled" && <span className="text-[12px] text-ink-3">Saving takes it off the schedule until you schedule it again.</span>}
              </div>
            ) : (
              <span className="text-[14px] text-ink-2">
                {when ?? (scheduledAt ? "…" : "No send time yet")}
                {audience ? ` · to ${audience}` : ""}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {/* The decision */}
      <div className="mt-4 border-t border-hairline pt-4">
        {reached >= 4 ? (
          <p className="text-[14px] text-ink-2">Sent. Nothing left to do.</p>
        ) : reached === 3 ? (
          <p className="text-[14px] text-ink-2">Scheduled. Klaviyo sends it on its own. Editing anything above takes it off the schedule.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={run} disabled={busy || !future || editing !== null} className={primaryButton}>
              {working === "run" ? "Working…" : reached === 0 ? "Approve & schedule" : "Schedule it"}
            </button>
            <span className="text-[13px] text-ink-3">
              {working === "run"
                ? "Finishing every remaining step. The Klaviyo draft takes about a minute — keep this page open."
                : !future
                  ? "Its send time has passed or is missing. Pick a new one above first."
                  : "One click finishes every remaining step and schedules the send. This is the approval to send."}
            </span>
          </div>
        )}
      </div>

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
      {message && <p role="status" className="mt-3 border-l-2 border-gold pl-3 text-[13px] text-ink">{message}</p>}
    </div>
  );
}
