"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Eyebrow } from "@/components/primitives";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import {
  GenCard,
  Unavailable,
  ImageGallery,
  type GalleryData,
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
 * ChatPanel — the console's chat surface as a reusable component (AI SDK v6
 * UIMessage stream + the registered generative-UI renderers, spec 13
 * addendum). /chat renders it full-screen with the conversation sidebar; the
 * Design Studio (/studio, spec 23 DS4) mounts it as the left pane beside the
 * embedded canvas. One implementation, one /api/chat backend, one message
 * renderer — extracted rather than duplicated.
 */

const MARKDOWN_COMPONENTS = {
  p: (props: React.ComponentPropsWithoutRef<"p">) => <p className="mb-2 last:mb-0" {...props} />,
  strong: (props: React.ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-medium text-ink" {...props} />
  ),
  ul: (props: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="mb-2 ml-5 list-disc space-y-1 last:mb-0" {...props} />
  ),
  ol: (props: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="mb-2 ml-5 list-decimal space-y-1 last:mb-0" {...props} />
  ),
  a: (props: React.ComponentPropsWithoutRef<"a">) => (
    <a className="text-gold underline underline-offset-2 hover:opacity-80" target="_blank" rel="noreferrer" {...props} />
  ),
  code: (props: React.ComponentPropsWithoutRef<"code">) => (
    <code className="bg-raised px-1 py-0.5 text-[13px]" {...props} />
  ),
  pre: (props: React.ComponentPropsWithoutRef<"pre">) => (
    <pre className="mb-2 overflow-x-auto border border-hairline bg-raised p-3 text-[13px] last:mb-0" {...props} />
  ),
};

/**
 * The ```mos-gallery``` directive (brand-soul candidates AND design-surface
 * export renders — the WS4 REVISIT fix: these previously rendered as raw
 * JSON in a <pre>). A fenced block whose language is mos-gallery and whose
 * body parses as {title?, images:[{id?, url, label?}]} routes to the gallery
 * renderer; anything else (including a still-streaming, not-yet-valid JSON
 * body) falls back to the plain code block until it completes.
 */
function galleryFromPre(children: React.ReactNode): GalleryData | null {
  const el = React.Children.toArray(children)[0];
  if (!React.isValidElement(el)) return null;
  const p = el.props as { className?: string; children?: React.ReactNode };
  if (!p.className?.includes("language-mos-gallery")) return null;
  const text = Array.isArray(p.children)
    ? p.children.filter((c): c is string => typeof c === "string").join("")
    : typeof p.children === "string"
      ? p.children
      : null;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as GalleryData;
    if (parsed && Array.isArray(parsed.images)) return parsed;
  } catch {
    // Incomplete while streaming, or malformed — keep the raw block.
  }
  return null;
}

const DEFAULT_SUGGESTIONS = [
  "How did revenue trend last month?",
  "Which channels drive our traffic?",
  "Which landing pages convert best?",
  "How is the Collector’s List performing?",
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

export interface ChatPanelProps {
  /** Past-conversation rail. On by default; the Studio's side pane hides it. */
  showSidebar?: boolean;
  /** Header eyebrow above the thread. */
  eyebrow?: string;
  /** Empty-thread hero (Playfair, the editorial moment). */
  heroTitle?: React.ReactNode;
  heroSub?: string;
  /** Empty-thread prompt suggestions. */
  suggestions?: string[];
  /** The one-liner under the composer. */
  footnote?: string;
}

export function ChatPanel({
  showSidebar = true,
  eyebrow = "Chat",
  heroTitle = (
    <>
      Ask your <span className="italic">marketing agent.</span>
    </>
  ),
  heroSub = "Answers arrive with the evidence — charts from your live store data. Changes arrive as proposals you approve.",
  suggestions = DEFAULT_SUGGESTIONS,
  footnote = "Storefront changes are proposed here and reviewed before going live.",
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // The active conversation. useChat's `id` re-keys its internal state, so a
  // new id + fresh `messages` (New chat, or picking a past conversation from
  // the sidebar) produces an independent conversation instead of appending to
  // the current one. The same id is also the `threadId` sent to /api/chat, so
  // client-side chat identity and server-side memory thread identity match.
  const [threadId, setThreadIdState] = useState<string>(() => crypto.randomUUID());
  const threadIdRef = useRef(threadId);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  function setThreadId(id: string) {
    threadIdRef.current = id;
    setThreadIdState(id);
  }

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ threadId: threadIdRef.current }),
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    const prompt = new URLSearchParams(window.location.search).get("prompt");
    if (prompt) setInput(prompt);
  }, []);

  // A brand-new thread needs a row in the sidebar; an existing one may just
  // have been auto-titled by Mastra after this exchange. Refresh right after
  // streaming ends, and once more after title generation has had a moment.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      setSidebarRefreshKey((k) => k + 1);
      const t = setTimeout(() => setSidebarRefreshKey((k) => k + 1), 2500);
      return () => clearTimeout(t);
    }
    wasBusy.current = busy;
  }, [busy]);

  function newChat() {
    setThreadId(crypto.randomUUID());
    setInitialMessages([]);
    setInput("");
  }

  async function selectConversation(id: string) {
    if (busy) return;
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      const loaded: UIMessage[] = Array.isArray(data.messages)
        ? data.messages.map((m: { role: "user" | "assistant"; content: string }) => ({
            id: crypto.randomUUID(),
            role: m.role,
            parts: [{ type: "text", text: m.content }],
          }))
        : [];
      setThreadId(id);
      setInitialMessages(loaded);
    } catch {
      // Leave the current conversation as-is rather than losing it.
    }
  }

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

  // Per-instance markdown components: the base set plus the mos-gallery
  // interception on <pre>, wired to this conversation's sendMessage so a
  // gallery selection continues the thread.
  const markdownComponents = useMemo(
    () => ({
      ...MARKDOWN_COMPONENTS,
      pre: (props: React.ComponentPropsWithoutRef<"pre">) => {
        const gallery = galleryFromPre(props.children);
        if (gallery) {
          return (
            <ImageGallery
              data={gallery}
              onSelect={(img) =>
                void sendMessage({
                  text: `Use ${img.label ? `the "${img.label}" option` : "this one"}${img.id ? ` (id ${img.id})` : ""}.`,
                })
              }
            />
          );
        }
        return MARKDOWN_COMPONENTS.pre(props);
      },
    }),
    [sendMessage],
  );

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
    <div className="flex h-full min-h-0">
      {showSidebar && (
        <ConversationSidebar
          activeThreadId={threadId}
          onSelect={selectConversation}
          onNewChat={newChat}
          refreshKey={sidebarRefreshKey}
        />
      )}

      <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="border-b border-hairline px-8 py-4">
        <div className="mx-auto max-w-[760px]">
          <Eyebrow>{eyebrow}</Eyebrow>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-[760px] space-y-7">
          {messages.length === 0 && (
            <div className="animate-enter pt-14 text-center">
              <h1 className="mb-3 text-[28px]">{heroTitle}</h1>
              <p className="mx-auto mb-10 max-w-md text-[15px] text-ink-2">{heroSub}</p>
              <div className="mx-auto grid max-w-xl grid-cols-1 gap-2 text-left sm:grid-cols-2">
                {suggestions.map((prompt) => (
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
                      return p.text ? (
                        <div key={i} className="mb-2 max-w-[68ch] last:mb-0">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {p.text}
                          </ReactMarkdown>
                        </div>
                      ) : null;
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
          <p className="mt-2.5 text-xs text-ink-3">{footnote}</p>
        </div>
      </div>
      </div>
    </div>
  );
}
