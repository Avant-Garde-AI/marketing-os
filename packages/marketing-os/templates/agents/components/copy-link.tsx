"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A URL with a button that copies it.
 *
 * The share block relied on `user-select: all` — one click selects the whole
 * URL, then it is still on you to press copy, and on a phone that gesture is a
 * long-press-and-drag. For a link whose entire purpose is to be pasted into
 * Slack, "selected" is not the finish line.
 *
 * The URL stays visible rather than hiding behind the button. These links carry
 * a signed token and an expiry, and someone about to send one to a colleague
 * should be able to see what they are sending.
 */
export function CopyLink({ url, label }: { url: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending reset must not fire into an unmounted component, and navigating
  // away mid-timeout is the normal case here, not an edge one.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async () => {
    const done = (next: "copied" | "failed") => {
      setState(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2000);
    };
    try {
      await navigator.clipboard.writeText(url);
      done("copied");
    } catch {
      // The async clipboard API needs a secure context and a permission that
      // can be refused. Fall back rather than leaving a dead button — and if
      // even that fails, SAY so, because a button that silently does nothing
      // is worse than one that admits it.
      try {
        const el = document.createElement("textarea");
        el.value = url;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(el);
        done(ok ? "copied" : "failed");
      } catch {
        done("failed");
      }
    }
  }, [url]);

  return (
    <div className="border border-hairline bg-paper px-3 py-2">
      {label && (
        <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
          {label}
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 select-all break-all font-mono text-[11.5px] text-ink-2">
          {url}
        </div>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 border border-hairline-strong px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-2 transition-colors hover:border-gold hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold"
        >
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
      {/* Announced to screen readers without moving anything on screen — the
          button's own label already carries the state visually. */}
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? "Link copied to clipboard" : state === "failed" ? "Could not copy — select the link and copy it manually" : ""}
      </span>
    </div>
  );
}
