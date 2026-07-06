"use client";

import React, { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Eyebrow } from "@/components/primitives";
import {
  GenCard,
  Unavailable,
  RevenueTrend,
  ChannelBreakdown,
  LandingConversion,
  SessionsCompare,
  OfferPerformance,
  OfferProposalCard,
  OfferDecisionCard,
  ProposalCard,
  type RevenueTrendData,
  type ChannelData,
  type LandingData,
  type CompareData,
  type OfferPerfData,
  type OfferProposalData,
  type OfferDecisionData,
  type ProposalData,
} from "@/components/chat/gen-ui";

/**
 * Chat — the console's primary work surface, now on the AI SDK v6 UIMessage
 * stream. Assistant messages arrive as typed parts; tool parts render through
 * the registered generative-UI components (static pattern, spec 13 addendum).
 */

const SUGGESTIONS = [
  "How did revenue trend last month?",
  "Which channels drive our traffic?",
  "Which landing pages convert best?",
  "How is the Collector\u2019s List performing?",
  "Update the hero headline to emphasize sustainability",
];

/* tool name → renderer. Keys cover both Mastra naming styles. */
const CHART_TITLES: Record<string, string> = {
  chart_revenue_trend: "Revenue trend",
  chartRevenueTrend: "Revenue trend",
  chart_channel_breakdown: "Channels",
  chartChannelBreakdown: "Channels",
  chart_landing_conversion: "Landing page conversion",
  chartLandingConversion: "Landing page conversion",
  chart_sessions_compare: "Sessions — period over period",
  chartSessionsCompare: "Sessions — period over period",
  chart_offer_performance: "Offer performance",
  chartOfferPerformance: "Offer performance",
};
const PROPOSAL_NAMES = new Set(["propose_storefront_change", "proposeStorefrontChange"]);
const OFFER_PROPOSAL_NAMES = new Set(["propose_offer", "proposeOffer"]);
const OFFER_REVIEW_NAMES = new Set(["review_offer_experiment", "reviewOfferExperiment"]);

/** A bad tool payload must never whitescreen the console. */
class PartBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return <p className="mt-2 text-[13px] text-ink-3">Couldn&apos;t render that result — the answer continues without it.</p>;
    }
    return this.props.children;
  }
}

function ChartOutput({ name, output }: { name: string; output: unknown }) {
  const data = output as { unavailable?: boolean; reason?: string };
  if (!data || typeof data !== "object") return <Unavailable reason="No data returned." />;
  if (data.unavailable) return <Unavailable reason={data.reason ?? "Data unavailable."} />;
  const n = name.toLowerCase();
  if (n.includes("revenue")) return <RevenueTrend data={output as RevenueTrendData} />;
  if (n.includes("channel")) return <ChannelBreakdown data={output as ChannelData} />;
  if (n.includes("landing")) return <LandingConversion data={output as LandingData} />;
  if (n.includes("offer")) return <OfferPerformance data={output as OfferPerfData} />;
  if (n.includes("sessions") || n.includes("compare")) return <SessionsCompare data={output as CompareData} />;
  return <Unavailable reason="No renderer registered for this result." />;
}

interface ToolPartLike {
  type: string;
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  output?: unknown;
  errorText?: string;
}

export default function ChatPage() {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    const prompt = new URLSearchParams(window.location.search).get("prompt");
    if (prompt) setInput(prompt);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }

  function requestChanges(target: string, feedback: string) {
    void sendMessage({ text: `Revise the ${target} proposal: ${feedback}` });
  }

  function renderToolPart(part: ToolPartLike) {
    const name = part.type.replace(/^tool-/, "");
    const isChart = name in CHART_TITLES;
    const isProposal = PROPOSAL_NAMES.has(name);
    if (OFFER_PROPOSAL_NAMES.has(name)) { /* handled below */ }

    if (part.state === "output-error") {
      return <p className="mt-2 text-[13px] text-ink-3">That lookup didn&apos;t complete — the answer continues without it.</p>;
    }
    if (isChart) {
      if (part.state !== "output-available") {
        return <GenCard title={CHART_TITLES[name] ?? "Working"} loading />;
      }
      return (
        <GenCard title={CHART_TITLES[name] ?? "Result"}>
          <ChartOutput name={name} output={part.output} />
        </GenCard>
      );
    }
    if (OFFER_REVIEW_NAMES.has(name)) {
      if (part.state !== "output-available") {
        return <GenCard title="Reviewing experiment" loading />;
      }
      const d = part.output as OfferDecisionData & { unavailable?: boolean; reason?: string };
      if (d.unavailable) return <GenCard title="Experiment review"><Unavailable reason={d.reason ?? "No data."} /></GenCard>;
      return <OfferDecisionCard data={d} />;
    }
    if (OFFER_PROPOSAL_NAMES.has(name)) {
      if (part.state !== "output-available") {
        return <GenCard title="Designing offer" loading />;
      }
      const data = part.output as OfferProposalData;
      return <OfferProposalCard data={data} onRequestChanges={(fb) => void sendMessage({ text: `Revise the "${data.title}" offer: ${fb}` })} />;
    }
    if (isProposal) {
      if (part.state !== "output-available") {
        return <GenCard title="Drafting proposal" loading />;
      }
      const data = part.output as ProposalData;
      return <ProposalCard data={data} onRequestChanges={(fb) => requestChanges(data.target, fb)} />;
    }
    // Other tools stay visible but quiet.
    if (part.state === "output-available") {
      return <p className="mt-1 text-[12px] text-ink-3">Checked {name.replace(/[-_]/g, " ")}.</p>;
    }
    return <p className="mt-1 text-[12px] text-ink-3">Checking {name.replace(/[-_]/g, " ")}…</p>;
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-hairline px-8 py-4">
        <div className="mx-auto max-w-[760px]">
          <Eyebrow>Chat</Eyebrow>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-[760px] space-y-7">
          {messages.length === 0 && (
            <div className="animate-enter pt-14 text-center">
              <h1 className="mb-3 text-[28px]">
                Ask your <span className="italic">marketing agent.</span>
              </h1>
              <p className="mx-auto mb-10 max-w-md text-[15px] text-ink-2">
                Answers arrive with the evidence — charts from your live store
                data. Changes arrive as proposals you approve.
              </p>
              <div className="mx-auto grid max-w-xl grid-cols-1 gap-2 text-left sm:grid-cols-2">
                {SUGGESTIONS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setInput(prompt)}
                    className="border border-hairline bg-raised p-4 text-left text-sm text-ink-2 transition-colors duration-[160ms] hover:bar-active hover:text-ink"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : "block"}>
              {msg.role === "user" ? (
                <div className="max-w-[80%] border border-hairline bg-raised px-5 py-3.5 text-[15px] leading-relaxed">
                  {msg.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
                </div>
              ) : (
                <div className="max-w-full text-[15px] leading-relaxed">
                  {msg.parts.map((p, i) => {
                    if (p.type === "text") {
                      return p.text ? <p key={i} className="mb-2 max-w-[68ch] whitespace-pre-wrap">{p.text}</p> : null;
                    }
                    if (p.type.startsWith("tool-")) {
                      return <div key={(p as unknown as ToolPartLike).toolCallId ?? i}><PartBoundary>{renderToolPart(p as unknown as ToolPartLike)}</PartBoundary></div>;
                    }
                    return null;
                  })}
                </div>
              )}
            </div>
          ))}

          {busy && <div className="shimmer-line w-24" aria-label="Thinking" />}
          {error && (
            <p className="text-[13px] text-ink-2">
              That didn&apos;t go through. The conversation is unchanged — try again.
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-hairline px-8 py-5">
        <div className="mx-auto max-w-[760px]">
          <form onSubmit={submit} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder="Ask your marketing agent…"
              className="flex-1 border border-hairline bg-raised px-4 py-3 text-[15px] placeholder:text-ink-3 transition-colors duration-[160ms] focus:border-gold focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="bg-inverse px-6 py-3 text-[14px] font-medium text-paper transition-opacity duration-[160ms] hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </form>
          <p className="mt-2.5 text-xs text-ink-3">
            Storefront changes are proposed here and reviewed before going live.
          </p>
        </div>
      </div>
    </div>
  );
}
