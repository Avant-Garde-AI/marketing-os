"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ConversationSidebar({
  activeThreadId,
  onSelect,
  onNewChat,
  refreshKey,
}: {
  activeThreadId: string | undefined;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  refreshKey: number;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("console-chat-sidebar") === "collapsed");
    setHydrated(true);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("console-chat-sidebar", next ? "collapsed" : "open");
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = await res.json();
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
    } catch {
      // A sidebar that fails to load must never block chat itself.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const prev = conversations;
    setConversations((c) => c.filter((t) => t.id !== id));
    if (id === activeThreadId) onNewChat();
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) setConversations(prev);
    } catch {
      setConversations(prev);
    }
  }

  if (collapsed) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center border-r border-hairline bg-page py-4">
        <button
          onClick={onNewChat}
          title="New chat"
          className="flex h-8 w-8 items-center justify-center text-ink-2 transition-colors duration-[160ms] hover:text-ink"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          onClick={toggle}
          title="Expand conversations"
          aria-label="Expand conversations"
          className="mt-3 text-[13px] text-ink-3 transition-colors duration-[160ms] hover:text-ink"
        >
          &rsaquo;
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-56 shrink-0 flex-col border-r border-hairline bg-page",
        hydrated && "transition-[width] duration-[240ms]",
      )}
    >
      <div className="flex items-center justify-between border-b border-hairline px-3 py-3">
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors duration-[160ms] hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          New chat
        </button>
        <button
          onClick={toggle}
          title="Collapse"
          aria-label="Collapse conversations"
          className="text-ink-3 transition-colors duration-[160ms] hover:text-ink"
        >
          &lsaquo;
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {loading && <p className="px-2 py-2 text-[12px] text-ink-3">Loading…</p>}
        {!loading && conversations.length === 0 && (
          <p className="px-2 py-2 text-[12px] text-ink-3">No conversations yet.</p>
        )}
        {conversations.map((c) => (
          <div key={c.id} className="group flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                "min-w-0 flex-1 px-2 py-2 text-left text-[13px] transition-colors duration-[160ms]",
                c.id === activeThreadId
                  ? "bg-gold-quiet font-medium text-ink"
                  : "text-ink-2 hover:bg-gold-quiet/60 hover:text-ink",
              )}
            >
              <span className="block truncate">{c.title || "New conversation"}</span>
              <span className="block truncate text-[11px] text-ink-3">{relativeTime(c.updatedAt)}</span>
            </button>
            <button
              type="button"
              onClick={(e) => void remove(c.id, e)}
              title="Delete conversation"
              aria-label="Delete conversation"
              className="shrink-0 self-center px-1 text-ink-3 opacity-0 transition-opacity duration-[160ms] group-hover:opacity-100 hover:text-ink"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
