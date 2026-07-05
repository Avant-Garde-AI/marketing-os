"use client";

/**
 * Registered generative-UI components (spec 13 addendum, static pattern).
 *
 * Each component's props = the outputSchema of a chart tool. The agent picks
 * a tool; the console owns the pixels. Chart specs follow the dataviz method:
 * navy single-series marks, chart-gold (#9a784e, 3.9:1 on cream) for
 * emphasis, ≤24px bars with 4px rounded data-ends, 2px lines, ≥8px end
 * markers with a 2px surface ring, hairline grids, tabular numerals,
 * selective direct labels. Text never wears the data color.
 */

import { useState } from "react";

const MARK = "#1b263b";
const MARK_GOLD = "#9a784e";
const MARK_CONTEXT = "rgb(27 38 59 / 0.22)";

/* ── shared card chrome ─────────────────────────────────────────── */

export function GenCard({
  title,
  loading = false,
  children,
}: {
  title: string;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="animate-enter mt-3 border border-hairline bg-raised shadow-card" style={{ boxShadow: "inset 2px 0 0 var(--color-gold)" }}>
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-3">GA4 + Shopify</span>
      </div>
      <div className="overflow-x-auto p-4">
        {loading ? (
          <div className="space-y-3 py-2">
            <div className="skeleton h-6 w-40" />
            <div className="skeleton h-28 w-full" />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function Unavailable({ reason }: { reason: string }) {
  return <p className="py-2 text-sm text-ink-2">{reason}</p>;
}

/* ── KPI row + revenue trend ────────────────────────────────────── */

export interface RevenueTrendData {
  days: string[];
  values: number[];
  kpis: { label: string; value: string; note: string }[];
}

export function RevenueTrend({ data }: { data: RevenueTrendData }) {
  const w = 640, h = 190, pad = { l: 46, r: 64, t: 12, b: 22 };
  const max = Math.max(1000, Math.ceil(Math.max(...data.values) / 500) * 500);
  const n = data.values.length;
  const X = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, n - 1);
  const Y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const pts = data.values.map((v, i) => `${X(i)},${Y(v)}`);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {data.kpis.map((k) => (
          <div key={k.label} className="border border-hairline px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.1em] text-ink-3">{k.label}</div>
            <div className="tnum text-[22px] leading-tight">{k.value}</div>
            <div className="mt-1 border-t border-hairline pt-1 text-[11px] text-ink-3">{k.note}</div>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Daily revenue trend">
        {[0, max / 2, max].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={w - pad.r} y1={Y(g)} y2={Y(g)} stroke="rgb(27 38 59 / 0.08)" />
            <text x={pad.l - 8} y={Y(g) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-3)" className="tnum">
              ${g >= 1000 ? `${g / 1000}k` : g}
            </text>
          </g>
        ))}
        <path d={`M${pts.join(" L")} L${X(n - 1)},${Y(0)} L${X(0)},${Y(0)} Z`} fill="rgb(27 38 59 / 0.06)" />
        <path d={`M${pts.join(" L")}`} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={X(n - 1)} cy={Y(data.values[n - 1] ?? 0)} r={6} fill={MARK_GOLD} stroke="var(--color-raised)" strokeWidth={2} />
        <text x={X(n - 1) + 10} y={Y(data.values[n - 1] ?? 0) + 4} fontSize={12} fill="var(--color-ink)" className="tnum">
          ${(data.values[n - 1] ?? 0).toLocaleString()}
        </text>
        <text x={pad.l} y={h - 5} fontSize={11} fill="var(--color-ink-3)">{data.days[0]}</text>
        <text x={w - pad.r} y={h - 5} textAnchor="end" fontSize={11} fill="var(--color-ink-3)">{data.days[n - 1]}</text>
        {data.values.map((v, i) => (
          <rect key={i} x={X(i) - (w - pad.l - pad.r) / (2 * n)} y={0} width={(w - pad.l - pad.r) / n} height={h}
            fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={X(hover)} x2={X(hover)} y1={pad.t} y2={h - pad.b} stroke="rgb(27 38 59 / 0.25)" />
            <text x={Math.min(X(hover) + 8, w - 90)} y={pad.t + 12} fontSize={12} fill="var(--color-ink)" className="tnum">
              {data.days[hover]} · ${data.values[hover]?.toLocaleString()}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/* ── channel breakdown (emphasis bars) ──────────────────────────── */

export interface ChannelData { metric: string; rows: { name: string; value: number }[] }

export function ChannelBreakdown({ data }: { data: ChannelData }) {
  const rows = data.rows.slice(0, 6);
  const max = Math.max(...rows.map((r) => r.value), 1);
  const topIdx = rows.findIndex((r) => r.value === Math.max(...rows.map((x) => x.value)));
  const w = 640, rowH = 32, pad = { l: 140, r: 90 };
  const h = rows.length * rowH + 8;
  const isRev = data.metric === "totalRevenue";
  const fmt = (v: number) => (isRev ? `$${v.toLocaleString()}` : v.toLocaleString());

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`${isRev ? "Revenue" : "Sessions"} by channel`}>
      {rows.map((r, i) => {
        const y = i * rowH + 5, bh = 20;
        const bw = Math.max(4, ((w - pad.l - pad.r) * r.value) / max);
        const emph = i === topIdx;
        return (
          <g key={r.name}>
            <text x={pad.l - 10} y={y + bh / 2 + 4} textAnchor="end" fontSize={12}
              fill={emph ? "var(--color-ink)" : "var(--color-ink-2)"}>{r.name}</text>
            <path d={`M${pad.l},${y} h${bw - 4} a4,4 0 0 1 4,4 v${bh - 8} a4,4 0 0 1 -4,4 h-${bw - 4} Z`}
              fill={emph ? MARK_GOLD : MARK_CONTEXT} />
            <text x={pad.l + bw + 8} y={y + bh / 2 + 4} fontSize={12} fill="var(--color-ink)" className="tnum">
              {fmt(r.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── landing-page conversion table ──────────────────────────────── */

export interface LandingData { rows: { page: string; sessions: number; cvr: number }[] }

export function LandingConversion({ data }: { data: LandingData }) {
  const rows = data.rows.slice(0, 6);
  const maxC = Math.max(...rows.map((r) => r.cvr), 0.1);
  const best = Math.max(...rows.map((r) => r.cvr));
  return (
    <table className="w-full border-collapse text-[14px]">
      <thead>
        <tr>
          {["Landing page", "Sessions", "Conversion"].map((hd) => (
            <th key={hd} className="border-b border-hairline-strong px-2.5 py-2 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">{hd}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.page}>
            <td className={`tnum border-b border-hairline px-2.5 py-2 ${r.cvr === best ? "font-semibold" : ""}`}
              style={r.cvr === best ? { boxShadow: "inset 0 -1px 0 var(--color-gold)" } : undefined}>
              {r.page}
            </td>
            <td className="tnum border-b border-hairline px-2.5 py-2">{r.sessions.toLocaleString()}</td>
            <td className="tnum border-b border-hairline px-2.5 py-2">
              <span className="mr-2 inline-block h-2 align-middle" style={{ width: (r.cvr / maxC) * 80, background: MARK }} />
              {r.cvr.toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── sessions period-over-period ────────────────────────────────── */

export interface CompareData { labels: string[]; now: number[]; prev: number[] }

export function SessionsCompare({ data }: { data: CompareData }) {
  const w = 640, h = 180, pad = { l: 46, r: 116, t: 12, b: 22 };
  const max = Math.max(...data.now, ...data.prev, 10);
  const n = data.labels.length;
  const X = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, n - 1);
  const Y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const line = (vals: number[]) => `M${vals.map((v, i) => `${X(i)},${Y(v)}`).join(" L")}`;
  return (
    <div>
      <div className="flex gap-4 pb-2 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-2"><i className="inline-block h-[3px] w-3.5" style={{ background: MARK }} />This period</span>
        <span className="inline-flex items-center gap-2"><i className="inline-block h-[3px] w-3.5" style={{ background: MARK_CONTEXT }} />Prior period</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Sessions, this period versus previous">
        {[0, max].map((g) => (
          <line key={g} x1={pad.l} x2={w - pad.r} y1={Y(g)} y2={Y(g)} stroke="rgb(27 38 59 / 0.08)" />
        ))}
        <path d={line(data.prev)} fill="none" stroke={MARK_CONTEXT} strokeWidth={2} strokeLinejoin="round" />
        <path d={line(data.now)} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" />
        {([["Prior", data.prev, MARK_CONTEXT, "var(--color-ink-2)"], ["Now", data.now, MARK, "var(--color-ink)"]] as const).map(
          ([label, vals, color, ink]) => (
            <g key={label}>
              <circle cx={X(n - 1)} cy={Y(vals[n - 1] ?? 0)} r={5} fill={color} stroke="var(--color-raised)" strokeWidth={2} />
              <text x={X(n - 1) + 10} y={Y(vals[n - 1] ?? 0) + 4} fontSize={12} fill={ink} className="tnum">
                {label} {(vals[n - 1] ?? 0).toLocaleString()}
              </text>
            </g>
          )
        )}
        {data.labels.map((l, i) => (
          <text key={l} x={X(i)} y={h - 5} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">{l}</text>
        ))}
      </svg>
    </div>
  );
}

/* ── the approval widget ────────────────────────────────────────── */

export interface ProposalData {
  proposalId: string;
  target: string;
  current: string;
  proposed: string;
  rationale: string;
  reviewNote: string;
}

export function ProposalCard({
  data,
  onRequestChanges,
}: {
  data: ProposalData;
  onRequestChanges: (feedback: string) => void;
}) {
  const [state, setState] = useState<"review" | "revising" | "dispatching" | "published" | "error">("review");
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState<{ issueNumber: number; issueUrl: string } | null>(null);
  const [error, setError] = useState("");

  async function approve() {
    setState("dispatching");
    try {
      const res = await fetch("/api/proposals/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Dispatch failed.");
      setResult(json);
      setState("published");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dispatch failed.");
      setState("error");
    }
  }

  if (state === "published") {
    return (
      <div className="animate-enter mt-3 bg-inverse px-7 py-8 text-paper">
        <div className="flex items-center gap-3.5">
          <span className="inline-block h-px w-12 bg-gold" />
          <span className="eyebrow">Approved</span>
        </div>
        <h3 className="mt-3 font-display text-[24px]">Queued. <em className="italic">In practice soon.</em></h3>
        <p className="mt-1.5 text-[12.5px] text-paper-2">
          {data.target} — dispatched to the reviewed pipeline
          {result && (
            <> · <a className="underline decoration-gold underline-offset-2" href={result.issueUrl} target="_blank" rel="noopener noreferrer">change #{result.issueNumber}</a></>
          )}
        </p>
        <div className="mt-4 font-script text-[21px] text-paper-2">Avant-Garde.</div>
      </div>
    );
  }

  return (
    <div className="relative ml-2.5 mt-4">
      <div className="pointer-events-none absolute -left-2.5 -top-2.5 h-full w-full border border-gold-line" />
      <div className="relative border border-hairline bg-raised shadow-card">
        <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-3">
          <span className="text-[13px] font-semibold">Proposed change — {data.target}</span>
          <span className="border-b border-gold px-1 text-[11.5px] font-medium">Needs review</span>
        </div>
        <div className="px-4 py-4">
          <div className="mb-3 border border-hairline">
            <div className="border-b border-hairline bg-page px-4 py-3">
              <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-ink-3">Current</span>
              <span className="font-display text-[18px] text-ink-3 line-through decoration-[rgb(27_38_59_/_0.35)]">{data.current}</span>
            </div>
            <div className="px-4 py-3">
              <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-ink-3">Proposed</span>
              <span className="font-display text-[18px]">{data.proposed}</span>
            </div>
          </div>
          <p className="text-[13px] text-ink-2">{data.rationale}</p>
        </div>
        <div className="border-t border-hairline px-4 py-3">
          {state === "revising" ? (
            <div className="flex w-full gap-2">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should change?"
                aria-label="Revision feedback"
                className="flex-1 border border-hairline bg-page px-3 py-2 text-[14px] focus:border-gold focus:outline-none"
              />
              <button
                onClick={() => feedback.trim() && onRequestChanges(feedback.trim())}
                className="bg-inverse px-4 py-2 text-[13.5px] font-medium text-paper hover:opacity-90"
              >
                Send
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={approve}
                disabled={state === "dispatching"}
                className="bg-inverse px-5 py-2.5 text-[14px] font-medium text-paper transition-opacity duration-[160ms] hover:opacity-90 disabled:opacity-40"
              >
                {state === "dispatching" ? "Dispatching…" : "Approve & publish"}
              </button>
              <button
                onClick={() => setState("revising")}
                disabled={state === "dispatching"}
                className="border border-hairline-strong px-5 py-2.5 text-[14px] font-medium transition-colors duration-[160ms] hover:border-gold disabled:opacity-40"
              >
                Request changes
              </button>
              <span className="ml-auto text-[12px] text-ink-3">{data.reviewNote}</span>
            </div>
          )}
          {state === "error" && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}
