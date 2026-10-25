"use client";
import { useEffect, useState } from "react";
export function SocialAutopilotControls() {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [postId, setPostId] = useState("");
  async function refresh() {
    const r = await fetch("/api/social/autopilot", { cache: "no-store" }),
      b = await r.json();
    if (!r.ok) throw Error(b.error ?? "Autopilot status unavailable");
    setState(b);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const id = setInterval(() => refresh().catch(() => {}), 30000);
    return () => clearInterval(id);
  }, []);
  async function control(operation: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/social/autopilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation, ...(operation === "hold" ? { postId } : {}) }),
        }),
        b = await r.json();
      if (!r.ok) throw Error(b.error ?? "Control failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="my-6 border border-hairline p-5">
      <h2 className="font-display text-2xl">Automatic two-week batches</h2>
      <p className="my-3">
        Seven artwork loops and seven three-scene carousels. Prepare a fortnight seven days ahead,
        reserve up to 125 Higgsfield credits, notify you in Slack, and schedule them with at least
        24 hours to review before the first publication. Pause also stops already-scheduled
        automatic posts.
      </p>
      <p className="my-3">
        Automation: <strong>{state?.grant?.status ?? "not enabled"}</strong>
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {!state?.grant ? (
          <button
            disabled={busy || !state}
            onClick={() => control("enable")}
            className="border px-4 py-2"
          >
            Enable automatic creation and scheduling · 125 credits per fortnight
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => control(state.grant.status === "paused" ? "resume" : "pause")}
            className="border px-4 py-2"
          >
            {state.grant.status === "paused" ? "Resume autopilot" : "Pause autopilot"}
          </button>
        )}
        <button
          disabled={busy || state?.grant?.status !== "active"}
          onClick={() => control("tick")}
          className="border px-4 py-2"
        >
          Continue production now
        </button>
      </div>
      {state?.batches?.map((b: any) => (
        <div key={b.id} className="mt-4">
          <p>
            {String(b.window_from).slice(0, 10)}–{String(b.window_through).slice(0, 10)} ·{" "}
            <strong>{b.phase}</strong> · {b.scheduled?.length ?? 0} scheduled
          </p>
          {b.detail && <p role="alert">{b.detail}</p>}
          {b.notice && (
            <p>
              Slack review delivered {new Date(b.notice.deliveredAt).toLocaleString()} · first
              release no earlier than {new Date(b.notice.releaseAt).toLocaleString()}
            </p>
          )}
        </div>
      ))}
      {state?.grant && (
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            aria-label="Post ID to hold"
            placeholder="Post ID to hold"
            value={postId}
            onChange={(e) => setPostId(e.target.value)}
            className="border p-2"
          />
          <button
            disabled={busy || !postId}
            onClick={() => control("hold")}
            className="border px-4 py-2"
          >
            Hold this post
          </button>
        </div>
      )}
    </section>
  );
}
