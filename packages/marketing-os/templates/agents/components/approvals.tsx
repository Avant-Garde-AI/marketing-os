"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Approvals, on a screen instead of in a chat.
 *
 * Slack is the right surface for the ambient case: a card arrives, someone
 * decides, it is done. It is the wrong surface for the deliberate one —
 * staging a month of campaigns produced eighteen cards, and clearing eighteen
 * Slack messages one at a time is worse than a list you can read down.
 *
 * Same decision, second surface. The platform still owns the nonce, so a card
 * approved in Slack while this page is open comes back "stale" rather than
 * running twice.
 *
 * Deliberately NOT a select-all. Every row here is a real action against a
 * live store — one of them sends to thousands of people — and a bulk button
 * would make the careful case and the careless one the same gesture. The win
 * is that the rows are in one place and each is one click, not that they can
 * all be waved through at once.
 */

interface Proposal {
  id: string;
  kind: string;
  summary: string;
  risk: "low" | "medium" | "high";
  params?: unknown;
  preview?: { rows?: Array<{ label: string; value: string }>; warnings?: string[] } | null;
}

type RowState = "idle" | "working" | "done" | "declined" | "error";

export function Approvals({ campaignId }: { campaignId?: string } = {}) {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      const body = (await res.json()) as { proposals?: Proposal[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // On a campaign page, show only that campaign's approvals. The gate has
      // no per-campaign filter — campaignId lives inside each Action's params,
      // whose shape is the Action's business, not the gate's — so the narrowing
      // happens here.
      const all = body.proposals ?? [];
      setRows(
        campaignId
          ? all.filter((p) => (p.params as { campaignId?: string } | null)?.campaignId === campaignId)
          : all,
      );
    } catch (e) {
      setRows([]);
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, approve: boolean) {
    setState((s) => ({ ...s, [id]: "working" }));
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: id, approve }),
      });
      const body = (await res.json()) as { status?: string; message?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
      // decideAction reports its own verdict: executed, stale, failed. A
      // non-executed result is not an error and must not read like success.
      if (body.status && body.status !== "executed" && body.status !== "declined") {
        setNote((n) => ({ ...n, [id]: body.message ?? body.status! }));
        setState((s) => ({ ...s, [id]: "error" }));
        return;
      }
      setState((s) => ({ ...s, [id]: approve ? "done" : "declined" }));
    } catch (e) {
      setNote((n) => ({ ...n, [id]: e instanceof Error ? e.message : String(e) }));
      setState((s) => ({ ...s, [id]: "error" }));
    }
  }

  if (rows === null) {
    return <p className="text-[14px] text-ink-2">Checking for approvals…</p>;
  }

  if (loadError) {
    return (
      <div className="border border-hairline bg-raised px-5 py-4">
        <p className="text-[14px] leading-relaxed text-ink-2">
          Could not reach the approval gate. {loadError}
        </p>
        <p className="mt-2 text-[13px] text-ink-3">
          Approvals still work in Slack — this list is a second surface, not the only one.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    // On a campaign page this is the common case and deserves no furniture —
    // a bordered "nothing here" box on every campaign is just noise.
    if (campaignId) return null;
    return (
      <div className="border border-hairline bg-raised px-5 py-4">
        <p className="text-[14px] text-ink-2">Nothing waiting. Approvals appear here and in Slack.</p>
      </div>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-hairline border border-hairline bg-raised">
        {rows.map((p) => {
          const st = state[p.id] ?? "idle";
          const settled = st === "done" || st === "declined";
          return (
            <li key={p.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                      {p.kind}
                    </span>
                    {p.risk === "high" && (
                      <span className="border border-gold-line bg-gold-quiet px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                        high risk
                      </span>
                    )}
                  </div>
                  <p className="text-[15px] leading-snug">{p.summary}</p>

                  {(p.preview?.rows?.length ?? 0) > 0 && (
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                      {p.preview!.rows!.map((r, i) => (
                        <div key={i} className="contents">
                          <dt className="text-ink-3">{r.label}</dt>
                          <dd className="m-0 text-ink-2">{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {/* Warnings are the reason to read before clicking, so they
                      are not collapsed behind anything. */}
                  {p.preview?.warnings?.map((w, i) => (
                    <p key={i} className="mt-2 border-l-2 border-gold pl-3 text-[13px] text-ink-2">
                      {w}
                    </p>
                  ))}

                  {note[p.id] && <p className="mt-2 text-[13px] text-ink-2">{note[p.id]}</p>}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {settled ? (
                    <span className="text-[12px] uppercase tracking-[0.12em] text-ink-3">
                      {st === "done" ? "approved" : "declined"}
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => decide(p.id, false)}
                        disabled={st === "working"}
                        className="border border-hairline px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-3 transition-colors hover:border-hairline-strong hover:text-ink-2 disabled:opacity-40"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(p.id, true)}
                        disabled={st === "working"}
                        className="border border-hairline-strong px-4 py-1.5 text-[11px] uppercase tracking-[0.14em] text-ink transition-colors hover:border-gold disabled:opacity-40"
                      >
                        {st === "working" ? "Working" : "Approve"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => void load()}
        className="mt-3 text-[13px] text-ink-3 underline-offset-2 hover:underline"
      >
        Refresh
      </button>
    </div>
  );
}
