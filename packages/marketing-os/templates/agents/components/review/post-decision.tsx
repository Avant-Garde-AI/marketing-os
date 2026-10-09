"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OutlineButton, PrimaryButton } from "../primitives";

/**
 * The one decision on a post, in plain words, with the edits beside it.
 *
 * The review screen used to open on "instagram · unscheduled · asset_ready",
 * a storyboard id and a "Review 1 schedule" button that produced a second
 * button. Everything needed to decide was on the page; none of it was where
 * the decision was. This puts what it is, when it goes out, the caption and
 * the single action in one place, and lets the caption and time be changed
 * right there.
 *
 * Signed-in owners only. The routes behind these buttons check the session;
 * someone holding only a review link is told to sign in.
 */

const STATUS: Record<string, string> = {
  proposed: "Waiting on its image or video",
  asset_ready: "Ready to schedule",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Publishing failed",
  cancelled: "Cancelled",
};

function timeLabel(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function toLocalInput(at: string | null): string {
  const d = at ? new Date(at) : new Date(Date.now() + 24 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PostDecision({
  postId,
  kind,
  account,
  status: initialStatus,
  when: initialWhen,
  caption: initialCaption,
  permalink,
}: {
  postId: string;
  /** "Instagram Reel", "Instagram carousel" — what a person would call it. */
  kind: string;
  account: string | null;
  status: string;
  /** scheduledAt when scheduled, otherwise the planned time. */
  when: string | null;
  caption: string;
  permalink?: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [when, setWhen] = useState(initialWhen);
  const [caption, setCaption] = useState(initialCaption);
  const [editing, setEditing] = useState<"caption" | "time" | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // null until the session is known: a review link is public, and controls
  // must not flash at someone who cannot use them.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const signedOut = signedIn !== true;
  const setSignedOut = (out: boolean) => setSignedIn(!out);
  useEffect(() => {
    let live = true;
    fetch("/api/social/post-edit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((b: { signedIn?: boolean }) => { if (live) setSignedIn(b.signedIn === true); })
      .catch(() => { if (live) setSignedIn(false); });
    return () => { live = false; };
  }, []);

  const editable = status === "proposed" || status === "asset_ready" || status === "scheduled";
  const future = when ? new Date(when).getTime() > Date.now() : false;

  async function call(url: string, payload: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.status === 401) { setSignedOut(true); return null; }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // `ok: true` in the body, not just a 2xx: a redirect to an HTML page is
      // also a 2xx and must never read as "saved" or "scheduled".
      if (!res.ok || body.ok !== true) { setMessage(typeof body.error === "string" ? body.error : `Something went wrong (${res.status}).`); return null; }
      return body;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const payload = editing === "caption" ? { copy: draft } : { plannedAt: draft ? new Date(draft).toISOString() : "" };
    const body = await call("/api/social/post-edit", { postId, ...payload });
    if (!body) return;
    if (typeof body.copy === "string") setCaption(body.copy);
    if (typeof body.plannedAt === "string") setWhen(body.plannedAt);
    if (typeof body.status === "string") setStatus(body.status);
    setEditing(null);
    setMessage(body.unscheduled ? "Saved. It is off the schedule until you approve it again." : "Saved.");
    router.refresh();
  }

  async function schedule() {
    const body = await call("/api/social/scheduling", { operation: "schedule", postId });
    if (!body) return;
    setStatus("scheduled");
    setMessage(null);
    router.refresh();
  }

  const loginHref = typeof window === "undefined" ? "/login" : `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;

  return (
    <section className="border border-hairline-strong bg-raised p-5 text-[14px] leading-relaxed">
      <p className="text-[12px] uppercase tracking-[0.14em] text-ink-3">{STATUS[status] ?? status}</p>
      <h2 className="mt-1 font-display text-[22px] leading-snug">
        {kind}
        {account ? ` to @${account}` : ""}
      </h2>

      {/* When */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {editing === "time" ? (
          <>
            <input type="datetime-local" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy}
              aria-label="Send time" className="border border-hairline-strong bg-paper px-2 py-1.5 text-[14px]" />
            <PrimaryButton onClick={save} disabled={busy || !draft}>{busy ? "Saving…" : "Save time"}</PrimaryButton>
            <button type="button" onClick={() => setEditing(null)} disabled={busy} className="text-[13px] text-ink-3 underline-offset-2 hover:underline">Cancel</button>
          </>
        ) : (
          <>
            <span className="text-[15px]">
              {status === "published" ? "Published" : status === "scheduled" ? "Goes out" : "Planned for"}{" "}
              <strong>{timeLabel(when) ?? "no time yet"}</strong>
            </span>
            {editable && !signedOut && (
              <button type="button" onClick={() => { setDraft(toLocalInput(future ? when : null)); setEditing("time"); setMessage(null); }}
                className="text-[13px] text-ink-3 underline-offset-2 hover:underline">Change time</button>
            )}
            {permalink && <a href={permalink} target="_blank" rel="noopener noreferrer" className="text-[13px] underline">View on Instagram</a>}
          </>
        )}
      </div>

      {/* Caption */}
      <div className="mt-4 border-t border-hairline pt-4">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink-3">Caption</span>
          {editable && !signedOut && editing !== "caption" && (
            <button type="button" onClick={() => { setDraft(caption); setEditing("caption"); setMessage(null); }}
              className="text-[13px] text-ink-3 underline-offset-2 hover:underline">Edit caption</button>
          )}
        </div>
        {editing === "caption" ? (
          <>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} rows={Math.min(14, Math.max(5, draft.split("\n").length + 1))}
              aria-label="Caption" className="w-full border border-hairline-strong bg-paper p-3 text-[15px] leading-relaxed" />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <PrimaryButton onClick={save} disabled={busy || !draft.trim()}>{busy ? "Saving…" : "Save caption"}</PrimaryButton>
              <button type="button" onClick={() => setEditing(null)} disabled={busy} className="text-[13px] text-ink-3 underline-offset-2 hover:underline">Cancel</button>
              <span className="text-[12px] text-ink-3">{[...draft].length.toLocaleString()} / 2,200</span>
              {status === "scheduled" && <span className="text-[12px] text-ink-3">Saving takes it off the schedule until you approve again.</span>}
            </div>
          </>
        ) : (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{caption}</p>
        )}
      </div>

      {/* The decision */}
      <div className="mt-4 border-t border-hairline pt-4">
        {signedIn === null ? (
          <p className="text-ink-3">Checking your sign-in…</p>
        ) : signedOut ? (
          <p><a href={loginHref} className="underline">Sign in to approve or edit.</a> A review link on its own can only view and leave notes.</p>
        ) : status === "asset_ready" ? (
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={schedule} disabled={busy || !future || editing !== null}>
              {busy && editing === null ? "Scheduling…" : "Approve & schedule"}
            </PrimaryButton>
            <span className="text-[13px] text-ink-3">
              {future ? "It publishes on its own at that time. This is the approval to post." : "Pick a time in the future first."}
            </span>
          </div>
        ) : status === "scheduled" ? (
          <p className="text-ink-2">Approved. It publishes on its own at the time above. Editing the caption or time takes it off the schedule.</p>
        ) : status === "proposed" ? (
          <p className="text-ink-2">Nothing to approve yet. It becomes ready once its image or video is attached.</p>
        ) : status === "published" ? (
          <p className="text-ink-2">This one is live. Nothing left to do.</p>
        ) : (
          <p className="text-ink-2">This post is {status}.</p>
        )}
        {message && <p role="status" className="mt-3 border-l-2 border-gold pl-3 text-[13px]">{message}</p>}
      </div>
    </section>
  );
}
