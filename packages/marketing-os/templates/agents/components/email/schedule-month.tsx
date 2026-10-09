"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendTimeLabel } from "./campaign-workflow";

/**
 * Schedule a whole month from one screen.
 *
 * The approvals list deliberately has no select-all, because its rows are
 * unrelated Actions and waving them through together hides what each one does.
 * This is narrower: one kind of thing (this month's campaigns), each shown
 * with its audience and send time before anything runs, and each still walked
 * through the gate one at a time. The owner asked for it after a planned month
 * sat unsent because nobody clicked twenty-one cards.
 */

export interface MonthCampaign {
  id: string;
  subject: string;
  status: string;
  scheduledAt: string | null;
  audience: string;
}

type RowState = { state: "idle" | "working" | "done" | "error"; note?: string };

const LEAD_MS = 10 * 60 * 1000;

export function ScheduleMonth({ campaigns }: { campaigns: MonthCampaign[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const pending = campaigns.filter((c) => ["proposed", "approved", "drafted"].includes(c.status));
  if (pending.length === 0) return null;
  const ready = pending.filter((c) => c.scheduledAt && new Date(c.scheduledAt).getTime() > Date.now() + LEAD_MS);
  const late = pending.filter((c) => !ready.includes(c));

  async function runAll() {
    setRunning(true);
    // One at a time, in send order: the Klaviyo draft is slow, and a failure
    // should stop on the campaign it belongs to rather than be buried in a batch.
    for (const c of ready) {
      if (rows[c.id]?.state === "done") continue;
      setRows((r) => ({ ...r, [c.id]: { state: "working" } }));
      try {
        const res = await fetch("/api/email/advance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: c.id, through: true }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
          error?: string;
          steps?: Array<{ label: string; ok: boolean; message: string }>;
        };
        const failed = body.steps?.find((s) => !s.ok);
        if (res.ok && body.status === "scheduled") {
          setRows((r) => ({ ...r, [c.id]: { state: "done" } }));
        } else {
          setRows((r) => ({
            ...r,
            [c.id]: {
              state: "error",
              note: failed ? `Stopped at ${failed.label} — ${failed.message}` : (body.error ?? `HTTP ${res.status}`),
            },
          }));
        }
      } catch (e) {
        setRows((r) => ({ ...r, [c.id]: { state: "error", note: e instanceof Error ? e.message : String(e) } }));
      }
    }
    setRunning(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-hairline-strong bg-inverse px-4 py-2 text-[12px] font-medium uppercase tracking-[0.14em] text-paper transition-opacity hover:opacity-90"
      >
        Schedule all {pending.length} unsent
      </button>
    );
  }

  return (
    <div className="border border-gold-line bg-gold-quiet px-5 py-4">
      <p className="text-[15px]">
        {ready.length > 0
          ? `These ${ready.length} will be approved, drafted in Klaviyo and scheduled to send:`
          : "Nothing can be scheduled yet."}
      </p>
      <ul className="mt-3 divide-y divide-hairline border border-hairline bg-raised">
        {ready.map((c) => {
          const st = rows[c.id]?.state ?? "idle";
          return (
            <li key={c.id} className="px-4 py-2.5 text-[14px]">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                <span className="text-[13px] text-ink-2">{sendTimeLabel(c.scheduledAt)}</span>
                <span className="w-24 text-right text-[12px] uppercase tracking-[0.12em] text-ink-3">
                  {st === "working" ? "working…" : st === "done" ? "✓ scheduled" : st === "error" ? "stopped" : c.status}
                </span>
              </div>
              <div className="text-[12px] text-ink-3">{c.audience}</div>
              {rows[c.id]?.note && (
                <p className="mt-1 border-l-2 border-gold pl-3 text-[13px] text-ink">{rows[c.id]!.note}</p>
              )}
            </li>
          );
        })}
      </ul>
      {late.length > 0 && (
        <p className="mt-3 text-[13px] text-ink-2">
          Skipped, because the send time has passed or is missing — open each to pick a new one:{" "}
          {late.map((c) => c.subject).join("; ")}.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {ready.length > 0 && (
          <button
            type="button"
            onClick={runAll}
            disabled={running}
            className="border border-hairline-strong bg-inverse px-4 py-2 text-[12px] font-medium uppercase tracking-[0.14em] text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {running ? "Working…" : `Confirm — schedule these ${ready.length}`}
          </button>
        )}
        {!running && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[13px] text-ink-3 underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        )}
        {running && (
          <span className="text-[13px] text-ink-3">About a minute per email. Keep this page open.</span>
        )}
      </div>
    </div>
  );
}
