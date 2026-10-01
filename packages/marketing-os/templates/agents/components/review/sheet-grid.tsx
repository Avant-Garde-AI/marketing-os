"use client";

import { useState } from "react";

/**
 * The month sheet's cards, selectable.
 *
 * Selecting sends each campaign's NEXT approval card to Slack and the console —
 * it approves nothing. Bulk here is bulk asking; every card is still decided
 * one at a time by a signed-in person.
 */

export interface SheetCard {
  id: string;
  link: string;
  hero: string | null;
  day: string;
  archetype: string;
  status: string;
  subject: string;
  previewText: string | null;
  notes: { total: number; open: number };
  /** Label of the next gate step, or why there isn't one. */
  step: { ok: true; label: string } | { ok: false; reason: string };
}

interface Props {
  cards: SheetCard[];
  shop: string;
  month: string;
  token: string | null;
  exp: string | null;
}

type Result = { status: "posted" | "skipped" | "error"; message: string };

export function SheetGrid({ cards, shop, month, token, exp }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [error, setError] = useState<string | null>(null);

  const eligible = cards.filter((c) => c.step.ok).map((c) => c.id);
  const allSelected = eligible.length > 0 && eligible.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/email/review-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, month, t: token, e: exp, campaignIds: cards.filter((c) => selected.has(c.id)).map((c) => c.id) }),
      });
      const body = (await res.json()) as {
        results?: Array<{ campaignId: string } & Result>;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const next: Record<string, Result> = {};
      for (const r of body.results ?? []) next[r.campaignId] = { status: r.status, message: r.message };
      setResults((prev) => ({ ...prev, ...next }));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="sticky top-0 z-10 mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 border border-hairline bg-raised px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-[12px] uppercase tracking-[0.12em] text-ink-2">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={eligible.length === 0}
            onChange={() => setSelected(allSelected ? new Set() : new Set(eligible))}
            className="h-4 w-4"
          />
          Select all
        </label>
        <button
          type="button"
          onClick={send}
          disabled={sending || selected.size === 0}
          className="bg-ink px-4 py-2 text-[12px] uppercase tracking-[0.12em] text-paper transition-opacity duration-[160ms] disabled:opacity-40"
        >
          {sending
            ? "Sending…"
            : `Send ${selected.size || ""} ${selected.size === 1 ? "approval" : "approvals"} to Slack`}
        </button>
        <span className="text-[12px] text-ink-3">
          Sends each selected campaign&rsquo;s next approval card. Nothing is approved or sent from this page.
        </span>
        {error && <span className="w-full text-[12.5px] text-danger">{error}</span>}
      </div>

      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const result = results[c.id];
          return (
            <li key={c.id} className="flex flex-col border border-hairline bg-raised">
              <a href={c.link} className="group block flex-1">
                <div className="aspect-[4/3] overflow-hidden bg-[#f2efe9]">
                  {c.hero ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.hero}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[12px] text-ink-3">
                      no imagery yet
                    </div>
                  )}
                </div>
                <div className="p-4 pb-3">
                  <div className="mb-1.5 flex items-baseline gap-2 text-[10px] uppercase tracking-[0.14em] text-ink-3">
                    <span className="tnum">{c.day}</span>
                    <span>· {c.archetype}</span>
                    <span className="ml-auto">{c.status}</span>
                  </div>
                  <div className="font-display text-[16.5px] leading-snug">{c.subject}</div>
                  {c.previewText && <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{c.previewText}</p>}
                  {c.notes.total > 0 && (
                    <p className="mt-2 text-[12px] text-ink-3">
                      {c.notes.open > 0
                        ? `${c.notes.open} open ${c.notes.open === 1 ? "note" : "notes"}`
                        : `${c.notes.total} ${c.notes.total === 1 ? "note" : "notes"}, all handled`}
                    </p>
                  )}
                </div>
              </a>
              <div className="flex items-center gap-2 border-t border-hairline px-4 py-2.5 text-[12px]">
                {c.step.ok ? (
                  <label className="flex min-w-0 cursor-pointer items-center gap-2 text-ink-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="truncate">Next: {c.step.label}</span>
                  </label>
                ) : (
                  <span className="text-ink-3">{c.step.reason}</span>
                )}
                <a
                  href={`/email/campaigns/${encodeURIComponent(c.id)}`}
                  className="arrow-link ml-auto shrink-0 text-[12px]"
                >
                  Console
                </a>
              </div>
              {result && (
                <p
                  className={`border-t border-hairline px-4 py-2 text-[12px] ${
                    result.status === "error" ? "text-danger" : "text-ink-2"
                  }`}
                >
                  {result.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
