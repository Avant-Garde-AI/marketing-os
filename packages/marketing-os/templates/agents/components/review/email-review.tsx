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

// ---------------------------------------------------------------------------
// Headline selection
// ---------------------------------------------------------------------------

export interface HeadlineChoice {
  id: string;
  headline: string;
  subheadline: string;
  why?: string;
}

/**
 * Pick the subject line and preview text, from the room where the email is
 * being read.
 *
 * The pair is the whole of what an inbox shows, and every September campaign
 * shipped with one phrasing and no alternatives — so the first thing written
 * became the campaign's voice by default. Options are only worth generating if
 * choosing between them is one click at the moment of review, which is here.
 *
 * Writing your own is a first-class option, not a fallback: it is kept as a
 * `custom` entry so the artifact still records what ran and what it beat.
 */
export function HeadlinePicker({
  campaignId,
  shop,
  token,
  exp,
  options,
  selectedId,
  subject,
  previewText,
  locked,
}: {
  campaignId: string;
  shop: string;
  token: string;
  exp: string;
  options: HeadlineChoice[];
  selectedId?: string;
  subject: string;
  previewText: string;
  locked?: boolean;
}) {
  const [choice, setChoice] = useState<string>(selectedId ?? (options[0]?.id ?? "custom"));
  const [customH, setCustomH] = useState(selectedId === "custom" ? subject : "");
  const [customS, setCustomS] = useState(selectedId === "custom" ? previewText : "");
  const [author, setAuthor] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState({ subject, previewText, selectedId });

  async function save() {
    setState("saving");
    setError(null);
    try {
      const body: Record<string, string> = { campaignId, shop, t: token, e: exp, author };
      if (choice === "custom") {
        body.headline = customH.trim();
        body.subheadline = customS.trim();
      } else {
        body.optionId = choice;
      }
      const res = await fetch("/api/email/headline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string; subject?: string; previewText?: string; selectedHeadlineId?: string };
      if (!res.ok) throw new Error(json.error ?? "could not save that headline");
      setLive({ subject: json.subject ?? "", previewText: json.previewText ?? "", selectedId: json.selectedHeadlineId });
      setState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  if (locked) {
    return (
      <p className="text-[13.5px] text-ink-2">
        This campaign has been staged, so its subject is locked to the draft that was
        already created. Re-draft it to change the headline.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-[13.5px] leading-relaxed text-ink-2">
        What the inbox shows. Currently sending as{" "}
        <span className="font-medium">&ldquo;{live.subject}&rdquo;</span>.
      </p>

      <div className="space-y-2">
        {options.map((o) => (
          <label
            key={o.id}
            className={`flex cursor-pointer gap-3 border px-4 py-3 transition-colors ${
              choice === o.id ? "border-gold-line bg-gold-quiet" : "border-hairline hover:border-hairline-strong"
            }`}
          >
            <input
              type="radio"
              name="headline"
              className="mt-1 shrink-0"
              checked={choice === o.id}
              onChange={() => setChoice(o.id)}
            />
            <span className="min-w-0">
              <span className="block text-[15px] leading-snug">{o.headline}</span>
              <span className="mt-0.5 block text-[13.5px] text-ink-2">{o.subheadline}</span>
              {o.why && (
                <span className="mt-1.5 block text-[11.5px] uppercase tracking-[0.12em] text-ink-3">{o.why}</span>
              )}
              {live.selectedId === o.id && (
                <span className="mt-1.5 inline-block border border-gold-line px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-ink-2">
                  live
                </span>
              )}
            </span>
          </label>
        ))}

        <label
          className={`flex cursor-pointer gap-3 border px-4 py-3 transition-colors ${
            choice === "custom" ? "border-gold-line bg-gold-quiet" : "border-hairline hover:border-hairline-strong"
          }`}
        >
          <input
            type="radio"
            name="headline"
            className="mt-1 shrink-0"
            checked={choice === "custom"}
            onChange={() => setChoice("custom")}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Write your own</span>
            {choice === "custom" && (
              <span className="mt-2 block space-y-2">
                <input
                  value={customH}
                  onChange={(ev) => setCustomH(ev.target.value)}
                  placeholder="Subject line"
                  maxLength={200}
                  className="w-full border border-hairline bg-paper px-3 py-2 text-[14px]"
                />
                <input
                  value={customS}
                  onChange={(ev) => setCustomS(ev.target.value)}
                  placeholder="Preview text"
                  maxLength={300}
                  className="w-full border border-hairline bg-paper px-3 py-2 text-[14px]"
                />
              </span>
            )}
          </span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={author}
          onChange={(ev) => setAuthor(ev.target.value)}
          placeholder="Your name"
          maxLength={80}
          className="w-40 border border-hairline bg-paper px-3 py-1.5 text-[13.5px]"
        />
        <button
          type="button"
          onClick={save}
          disabled={state === "saving" || (choice === "custom" && !customH.trim())}
          className="border border-hairline-strong px-4 py-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-40"
        >
          {state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Use this headline"}
        </button>
        {state === "saved" && (
          <span className="text-[13px] text-ink-2">
            Sending as &ldquo;{live.subject}&rdquo;. Reload the preview to see it.
          </span>
        )}
        {error && <span className="text-[13px] text-ink-2">{error}</span>}
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">
        Changes the subject and preview text only. Nothing sends until this campaign is
        approved in Slack.
      </p>
    </div>
  );
}
