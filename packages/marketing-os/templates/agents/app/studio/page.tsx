import { Eyebrow, PageHeader, EmptyState } from "@/components/primitives";
import { ChatPanel } from "@/components/chat/chat-panel";

/**
 * Design Studio (spec 23 DS4, D2: iframe from the start) — the side-by-side
 * workspace: the agent chat on the left, the embedded Penpot canvas on the
 * right. Penpot-powered, never Penpot-branded (§3 naming).
 *
 * The iframe embeds NEXT_PUBLIC_PENPOT_EMBED_URL — the tenant's SAME-SITE
 * Design Studio alias (e.g. https://design.arthaus.cloud), which is what
 * satisfies Penpot's cookie + frame-ancestors constraints (spec 23 §1/§3).
 * ?team-id/&file-id/&page-id query params deep-link a specific draft's
 * workspace (the studioPath the design-surface tools mint); without them the
 * canvas opens on the Penpot dashboard root.
 *
 * Degradation: no embed alias configured → an editorial explainer with an
 * external link to the raw Design Studio when PENPOT_URL is known (this is a
 * server component, so the server-side env is readable). Some browsers also
 * block third-party auth inside iframes, so the embedded view always carries
 * an "Open in new tab" escape hatch.
 */

export const dynamic = "force-dynamic";

const STUDIO_SUGGESTIONS = [
  "Compose a 1080×1080 Instagram post draft for our bestseller",
  "List my design drafts",
  "Draft a story-format announcement for the next drop",
  "Try the gold variant of this layout",
];

function embedBase(): string {
  return (process.env.NEXT_PUBLIC_PENPOT_EMBED_URL ?? "").replace(/\/$/, "");
}

/** The Penpot workspace hash for a draft, or "" for the dashboard root. */
function workspaceHash(teamId?: string, fileId?: string, pageId?: string): string {
  if (!teamId || !fileId) return "";
  let hash = `#/workspace?team-id=${encodeURIComponent(teamId)}&file-id=${encodeURIComponent(fileId)}`;
  if (pageId) hash += `&page-id=${encodeURIComponent(pageId)}`;
  return hash;
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const teamId = firstParam(params["team-id"]);
  const fileId = firstParam(params["file-id"]);
  const pageId = firstParam(params["page-id"]);

  const base = embedBase();

  // ── Not wired: the editorial explainer, never a broken frame ─────────────
  if (!base) {
    // Server-side design-surfaces env (the tools' backend) may still exist —
    // offer the raw canvas externally; with neither, offer nothing.
    const external = (process.env.PENPOT_URL ?? "").replace(/\/$/, "");
    return (
      <div className="px-8 py-10">
        <div className="mx-auto max-w-[1200px]">
          <PageHeader
            eyebrow="Design Studio"
            title={
              <>
                The canvas, <span className="italic">in the console.</span>
              </>
            }
            sub="Agent-composed drafts open here as an editable, on-brand canvas — chat on the left, design on the right."
          />
          <div className="animate-enter-2 border border-hairline bg-raised">
            <EmptyState
              headline={
                <>
                  Design Studio isn&apos;t wired for this deployment
                  <span className="italic"> yet.</span>
                </>
              }
              sub="Set NEXT_PUBLIC_PENPOT_EMBED_URL to this store's same-site Design Studio alias (e.g. https://design.your-console-domain) to embed the canvas here."
              action={
                external ? (
                  <a href={external} target="_blank" rel="noreferrer" className="arrow-link text-[15px]">
                    Open Design Studio
                  </a>
                ) : undefined
              }
            />
          </div>
        </div>
      </div>
    );
  }

  // ── The workspace: chat beside canvas ────────────────────────────────────
  const src = `${base}/${workspaceHash(teamId, fileId, pageId)}`;
  const onDraft = Boolean(teamId && fileId);

  return (
    <div className="flex h-screen">
      {/* Left: the same agent, the same /api/chat — no sidebar in the pane. */}
      <div className="flex w-[400px] shrink-0 flex-col border-r border-hairline xl:w-[460px]">
        <ChatPanel
          showSidebar={false}
          eyebrow="Studio"
          heroTitle={
            <>
              Design, <span className="italic">side by side.</span>
            </>
          }
          heroSub="Ask for a draft — it opens on the canvas beside you. Iterate in words; approve what you see."
          suggestions={STUDIO_SUGGESTIONS}
          footnote="Drafts are free. Nothing ships to the storefront without your approval."
        />
      </div>

      {/* Right: the canvas. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <Eyebrow>Design Studio</Eyebrow>
            <span className="truncate text-[13px] text-ink-3">
              {onDraft ? "Draft canvas" : "All drafts"}
            </span>
          </div>
          {/* Escape hatch: some browsers block embedded auth flows. */}
          <a href={src} target="_blank" rel="noreferrer" className="arrow-link shrink-0 text-[14px]">
            Open in new tab
          </a>
        </div>
        <iframe
          src={src}
          title="Design Studio canvas"
          className="min-h-0 w-full flex-1 border-0 bg-raised"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </div>
    </div>
  );
}
