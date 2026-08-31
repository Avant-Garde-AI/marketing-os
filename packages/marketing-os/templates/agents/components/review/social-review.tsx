"use client";

/**
 * The notes thread in a social review room.
 *
 * Imports its contract from `lib/review/note-shape` — which has NO imports at
 * all — so this client bundle can never reach `pg` through the notes DB module
 * (spec 26 §5, failure mode 6: `tsc` erases type-only imports, webpack still
 * walks the graph, and the build dies on `node:net`).
 *
 * A note is a REQUEST, never an authorisation. The caveat is rendered, not
 * just documented, because the person typing here is exactly the person who
 * might assume otherwise.
 */

import { useState } from "react";
import {
  IDENTITY_CAVEAT,
  MAX_AUTHOR_LENGTH,
  MAX_NOTE_LENGTH,
  type ReviewNote,
} from "@/lib/review/note-shape";

interface Props {
  groupKey: string;
  shop: string;
  token: string;
  exp: string;
  initial: ReviewNote[];
  /** Variant ids in the group, so a note can name which one it is about. */
  slots: string[];
}

export function SocialReviewNotes({ groupKey, shop, token, exp, initial, slots }: Props) {
  const [notes, setNotes] = useState<ReviewNote[]>(initial);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/social/review-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupKey,
          shop,
          t: token,
          e: exp,
          author,
          body,
          slot: slot || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { note?: ReviewNote; error?: string }
        | null;
      if (!res.ok || !json?.note) {
        // Never swallow: a note the reviewer believes was saved and was not is
        // the failure this whole surface exists to avoid.
        throw new Error(json?.error ?? "Your note did not save.");
      }
      setNotes((n) => [...n, json.note!]);
      setBody("");
      setSlot("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your note did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: "2.5rem" }}>
      <h2 style={{ fontSize: "1rem", letterSpacing: "0.02em", marginBottom: "0.25rem" }}>Notes</h2>
      <p style={{ fontSize: "0.8rem", opacity: 0.7, margin: "0 0 1rem" }}>{IDENTITY_CAVEAT}</p>

      {notes.length === 0 ? (
        <p style={{ fontSize: "0.9rem", opacity: 0.6 }}>No notes yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
          {notes.map((n) => (
            <li
              key={n.id}
              style={{
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 6,
                padding: "0.75rem 0.9rem",
                opacity: n.resolvedAt ? 0.55 : 1,
              }}
            >
              <div style={{ fontSize: "0.78rem", opacity: 0.7, marginBottom: "0.35rem" }}>
                <strong>{n.author}</strong>
                {n.slot ? ` · ${n.slot}` : ""} · {new Date(n.createdAt).toLocaleString()}
                {n.resolvedAt ? " · resolved" : ""}
              </div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: "0.92rem" }}>{n.body}</div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} style={{ marginTop: "1.25rem", display: "grid", gap: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name"
            maxLength={MAX_AUTHOR_LENGTH}
            style={{ flex: "1 1 12rem", padding: "0.5rem", fontSize: "0.9rem" }}
          />
          {slots.length > 1 && (
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              style={{ flex: "0 1 14rem", padding: "0.5rem", fontSize: "0.9rem" }}
            >
              <option value="">About the whole group</option>
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
          placeholder="What should change?"
          rows={4}
          maxLength={MAX_NOTE_LENGTH}
          style={{ padding: "0.5rem", fontSize: "0.95rem", fontFamily: "inherit" }}
        />
        {error && (
          <p role="alert" style={{ color: "#a11", fontSize: "0.85rem", margin: 0 }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !body.trim()}
          style={{
            justifySelf: "start",
            padding: "0.5rem 1.1rem",
            fontSize: "0.9rem",
            cursor: busy || !body.trim() ? "default" : "pointer",
          }}
        >
          {busy ? "Saving…" : "Leave note"}
        </button>
      </form>
    </section>
  );
}
