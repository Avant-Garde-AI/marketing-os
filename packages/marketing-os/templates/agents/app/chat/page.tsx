"use client";

import { useState, useRef, useEffect } from "react";
import { Eyebrow } from "@/components/primitives";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How many orders did we get this week?",
  "Write Instagram copy for our bestseller",
  "Update the hero headline to emphasize sustainability",
  "What's the status of open marketing changes?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Playbooks can deep-link with a prefilled prompt (?prompt=…)
  useEffect(() => {
    const prompt = new URLSearchParams(window.location.search).get("prompt");
    if (prompt) setInput(prompt);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    const assistantIdx = newMessages.length;
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const updated = [...m];
          updated[assistantIdx] = { role: "assistant", content: accumulated };
          return updated;
        });
      }
    } catch {
      setMessages((m) => {
        const updated = [...m];
        updated[assistantIdx] = {
          role: "assistant",
          content: "That didn't go through. The conversation is unchanged — try again.",
        };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }

  const lastIsStreaming = (i: number) =>
    streaming && i === messages.length - 1 && messages[i]?.role === "assistant";

  return (
    <div className="flex h-screen flex-col">
      {/* Quiet header */}
      <div className="border-b border-hairline px-8 py-4">
        <div className="mx-auto max-w-[720px]">
          <Eyebrow>Chat</Eyebrow>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-[720px] space-y-7">
          {messages.length === 0 && (
            <div className="animate-enter pt-14 text-center">
              <h1 className="mb-3 text-[28px]">
                Ask your <span className="italic">marketing agent.</span>
              </h1>
              <p className="mx-auto mb-10 max-w-md text-[15px] text-ink-2">
                Store questions, ad copy, storefront changes. Anything that ships
                goes through review first.
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

          {messages.map((msg, i) => (
            <div key={i} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  msg.role === "user"
                    ? "max-w-[80%] border border-hairline bg-raised px-5 py-3.5 text-[15px] leading-relaxed"
                    : "max-w-[92%] text-[15px] leading-relaxed whitespace-pre-wrap"
                }
              >
                {msg.content}
                {lastIsStreaming(i) && (
                  <div className="shimmer-line mt-3 w-24" aria-label="Thinking" />
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-hairline px-8 py-5">
        <div className="mx-auto max-w-[720px]">
          <form onSubmit={submit} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={streaming}
              placeholder="Ask your marketing agent…"
              className="flex-1 border border-hairline bg-raised px-4 py-3 text-[15px] placeholder:text-ink-3 transition-colors duration-[160ms] focus:border-gold focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="bg-inverse px-6 py-3 text-[14px] font-medium text-paper transition-opacity duration-[160ms] hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </form>
          <p className="mt-2.5 text-xs text-ink-3">
            Storefront changes are reviewed before going live.
          </p>
        </div>
      </div>
    </div>
  );
}
