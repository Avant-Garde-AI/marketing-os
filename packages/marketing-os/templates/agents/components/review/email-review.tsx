"use client";

/**
 * Client half of the review room: the device toggle over the assembled email,
 * and the notes thread.
 *
 * Both are deliberately small. The room is a place to LOOK and to SAY
 * something — it is not an approval surface. A token-bearing URL proves
 * possession of a link, not identity, so nothing here can produce an approver
 * record; that stays in Slack where there's a real user id behind the click.
 */

import { useState } from "react";
// From review-note-shape, NOT review-notes: the latter imports platform-db →
// pg → node:net, and webpack walks that graph even for a type-only import.
import { MAX_AUTHOR_LENGTH, MAX_NOTE_LENGTH, type ReviewNote } from "@/lib/email/review-note-shape";

// 600px is the email column; 640 gives it a little air. 375 is the iPhone
// viewport most mobile opens land in.
const DEVICES = [
  { key: "desktop", label: "Desktop", width: 640 },
  { key: "mobile", label: "Mobile", width: 375 },
] as const;

export function EmailFrame({ src, subject }: { src: string; subject: string }) {
  const [device, setDevice] = useState<(typeof DEVICES)[number]["key"]>("desktop");
  const width = DEVICES.find((d) => d.key === device)!.width;

  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        {DEVICES.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDevice(d.key)}
            aria-pressed={device === d.key}
            className={`px-3 py-1.5 text-[12px] uppercase tracking-[0.12em] transition-colors duration-[160ms] ${
              device === d.key
                ? "bg-ink text-paper"
                : "border border-hairline text-ink-3 hover:text-ink"
            }`}
          >
            {d.label}
          </button>
        ))}
        <span className="ml-2 tnum text-[11.5px] text-ink-3">{width}px</span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="arrow-link ml-auto text-[13px]"
        >
          Open full size
        </a>
      </div>

      <div className="flex justify-center border border-hairline bg-[#f2efe9] py-6">
        <iframe
          // sandbox="" strips every permission — no scripts, no forms, no
          // same-origin — so the assembled email cannot reach this page. It
          // still loads <img> subresources, which is all an email needs.
          sandbox=""
          referrerPolicy="no-referrer"
          src={src}
          title={`Assembled email — ${subject}`}
          style={{ width, height: 900 }}
          className="border border-hairline bg-white transition-[width] duration-200"
        />
      </div>
    </div>
  );
}

interface NotesProps {
  campaignId: string;
  shop: string;
  token: string;
  exp: string;
  initial: ReviewNote[];
  slots: string[];
}

function when(at: string): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ReviewNotes({ campaignId, shop, token, exp, initial, slots }: NotesProps) {
  const [notes, setNotes] = useState<ReviewNote[]>(initial);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [slot, setSlot] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/email/review-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          shop,
          t: token,
          e: exp,
          author,
          body,
          slot: slot || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.note) {
        // Say so loudly. A silently-dropped note is indistinguishable from a
        // note nobody acted on, which is the worst failure this page has.
        throw new Error(json.error ?? "Your note did not save.");
      }
      setNotes((n) => [...n, json.note as ReviewNote]);
      setBody("");
      setSlot("");
      setState("idle");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Your note did not save.");
    }
  }

  return (
    <div>
      {notes.length > 0 ? (
        <ul className="mb-6 space-y-4">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-gold-line pl-4">
              <div className="flex items-baseline gap-2">
                <span className="text-[14px] font-medium">{n.author}</span>
                {n.slot && (
                  <span className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                    on {n.slot}
                  </span>
                )}
                <span className="tnum ml-auto text-[11.5px] text-ink-3">{when(n.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink-2">
                {n.body}
              </p>
              {n.resolvedAt && (
                <p className="mt-1 text-[11.5px] text-ink-3">handled {when(n.resolvedAt)}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-[14px] text-ink-3">
          No notes yet. Anything left here reaches whoever picks this campaign up next.
        </p>
      )}

      <form onSubmit={submit} className="border-t border-hairline pt-5">
        <div className="mb-2 flex flex-wrap gap-2">
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            maxLength={MAX_AUTHOR_LENGTH}
            placeholder="Your name"
            className="w-40 border border-hairline bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
          />
          {slots.length > 0 && (
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              className="border border-hairline bg-paper px-3 py-2 text-[14px] text-ink-2 outline-none focus:border-gold"
            >
              <option value="">the campaign as a whole</option>
              {slots.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          rows={3}
          placeholder="What would you change?"
          className="w-full resize-y border border-hairline bg-paper px-3 py-2 text-[14.5px] leading-relaxed outline-none focus:border-gold"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={state === "saving" || !body.trim()}
            className="bg-ink px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition-opacity duration-[160ms] disabled:opacity-40"
          >
            {state === "saving" ? "Saving…" : "Leave note"}
          </button>
          <span className="text-[11.5px] text-ink-3">
            Names here are typed, not verified — a note is a request, not an approval.
          </span>
        </div>
        {error && (
          <p className="mt-2 text-[13px] text-[#a2442f]">
            {error} Copy your text before leaving this page.
          </p>
        )}
      </form>
    </div>
  );
}
