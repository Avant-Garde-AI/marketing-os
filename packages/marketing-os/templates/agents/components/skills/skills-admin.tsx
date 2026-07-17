"use client";

/**
 * Skills admin (WS4-R4 / 05 H1.4) — the client half of /skills: enable/
 * disable toggles, requires-status, wiring-config forms, and the Klaviyo
 * connection card. All writes go through the console's own API routes
 * (session-authed by the middleware); the server page supplies the data.
 */

import { useState } from "react";
import { Chip, OutlineButton, PrimaryButton } from "@/components/primitives";
import type { SkillPackMeta } from "@/lib/skills-catalog";
import type { SkillEnablement } from "@/lib/skill-enablements";
import type { ConnectionHealth } from "@/lib/provider-connections";

export interface PackCardData {
  meta: SkillPackMeta;
  enablement: SkillEnablement | null;
  /** Health per required provider, in meta.requires order. */
  requirements: ConnectionHealth[];
}

function healthChip(h: ConnectionHealth) {
  if (h.state === "connected") return <Chip variant="filled">{h.provider} connected</Chip>;
  if (h.state === "reconnect_required")
    return <Chip variant="attention">{h.provider} needs reconnect</Chip>;
  if (h.state === "not_connected") return <Chip variant="attention">{h.provider} not connected</Chip>;
  return <Chip variant="outline">{h.provider} status unknown</Chip>;
}

/* ─── One pack ────────────────────────────────────────────────────── */

function PackCard({ pack, integrationsUrl }: { pack: PackCardData; integrationsUrl: string | null }) {
  const { meta, requirements } = pack;
  const [enablement, setEnablement] = useState(pack.enablement);
  const [config, setConfig] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      meta.configFields.map((f) => [f.key, String(pack.enablement?.config?.[f.key] ?? "")])
    )
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const enabled = enablement?.enabled ?? false;
  const blocked = requirements.some((r) => r.state !== "connected");
  const blocker = requirements.find((r) => r.state !== "connected");

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/skill-enablements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: meta.id, ...body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNote({ kind: "error", text: (json.error as string) ?? "Save failed." });
        return false;
      }
      setEnablement(json.enablement as SkillEnablement);
      return true;
    } catch {
      setNote({ kind: "error", text: "Save failed — the console couldn't reach its API." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    const ok = await post({ enabled: !enabled });
    if (ok) setNote({ kind: "ok", text: !enabled ? "Enabled — tools appear on the agent's next request." : "Disabled — tools drop within one request cycle." });
  }

  async function saveConfig() {
    const ok = await post({ config });
    if (ok) setNote({ kind: "ok", text: "Configuration saved." });
  }

  return (
    <article className="border border-hairline bg-raised">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <div className="flex items-baseline gap-3">
          <h2 className="font-body text-[15px] font-medium">{meta.name}</h2>
          <span className="tnum text-[11.5px] text-ink-3">v{enablement?.version ?? meta.version}</span>
        </div>
        <div className="flex items-center gap-2">
          {requirements.map((r) => (
            <span key={r.provider}>{healthChip(r)}</span>
          ))}
          <Chip variant={enabled ? "filled" : "outline"}>{enabled ? "Enabled" : "Off"}</Chip>
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="max-w-2xl text-sm leading-relaxed text-ink-2">{meta.description}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {enabled ? (
            <OutlineButton onClick={toggle} disabled={busy}>
              {busy ? "Saving…" : "Disable"}
            </OutlineButton>
          ) : (
            <PrimaryButton
              onClick={toggle}
              disabled={busy || blocked}
              title={blocked ? `Connect ${blocker?.provider} first` : undefined}
            >
              {busy ? "Saving…" : "Enable"}
            </PrimaryButton>
          )}
          {blocked && !enabled && (
            <span className="text-[13px] text-ink-2">
              Connect {blocker?.provider} first
              {integrationsUrl && (
                <>
                  {" — "}
                  <a href={blocker?.actionUrl ?? integrationsUrl} target="_blank" rel="noreferrer" className="arrow-link">
                    open Integrations
                  </a>
                </>
              )}
            </span>
          )}
        </div>

        {meta.configFields.length > 0 && (
          <div className="mt-5 border-t border-hairline pt-4">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
              Configuration
            </div>
            <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
              {meta.configFields.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink">{f.label}</span>
                  <input
                    value={config[f.key] ?? ""}
                    onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full border border-hairline bg-page px-3 py-2 text-[14px] placeholder:text-ink-3 focus:border-gold focus:outline-none"
                  />
                  {f.help && <span className="mt-1 block text-[11.5px] leading-snug text-ink-3">{f.help}</span>}
                </label>
              ))}
            </div>
            <div className="mt-3">
              <OutlineButton onClick={saveConfig} disabled={busy}>
                {busy ? "Saving…" : "Save configuration"}
              </OutlineButton>
            </div>
          </div>
        )}

        {note && (
          <p className={"mt-3 text-[13px] " + (note.kind === "error" ? "text-danger" : "text-ink-2")}>
            {note.text}
          </p>
        )}
      </div>
    </article>
  );
}

/* ─── Klaviyo connection card ─────────────────────────────────────── */

export function KlaviyoConnectionCard({
  health,
  integrationsUrl,
}: {
  health: ConnectionHealth;
  integrationsUrl: string | null;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [connected, setConnected] = useState(health.state === "connected");

  async function connectWithKey(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/klaviyo/connect-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNote({ kind: "error", text: (json.error as string) ?? "Connect failed." });
        return;
      }
      setConnected(true);
      setApiKey("");
      setNote({
        kind: "ok",
        text: `Connected${json.organizationName ? ` — ${json.organizationName}` : ""}. Enable the Email Campaign pack above.`,
      });
    } catch {
      setNote({ kind: "error", text: "Connect failed — the console couldn't reach its API." });
    } finally {
      setBusy(false);
    }
  }

  const connectUrl = health.actionUrl ?? integrationsUrl;

  return (
    <article className="border border-hairline bg-raised">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <h2 className="font-body text-[15px] font-medium">Klaviyo</h2>
        {connected ? (
          <Chip variant="filled">Connected</Chip>
        ) : health.state === "reconnect_required" ? (
          <Chip variant="attention">Needs reconnect</Chip>
        ) : health.state === "unknown" ? (
          <Chip variant="outline">Status unknown</Chip>
        ) : (
          <Chip variant="attention">Not connected</Chip>
        )}
      </div>
      <div className="px-5 py-4">
        <p className="max-w-2xl text-sm leading-relaxed text-ink-2">
          The Email Campaign Agent drafts, schedules, and measures through your Klaviyo
          account. Credentials live in the platform&apos;s vault — this console never stores
          them.
        </p>
        {health.message && !connected && (
          <p className="mt-2 text-[12.5px] text-ink-3">{health.message}</p>
        )}

        {!connected && (
          <form onSubmit={connectWithKey} className="mt-4 flex max-w-xl gap-2">
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste a private API key (pk_…)"
              aria-label="Klaviyo private API key"
              type="password"
              autoComplete="off"
              className="flex-1 border border-hairline bg-page px-3 py-2 text-[14px] placeholder:text-ink-3 focus:border-gold focus:outline-none"
            />
            <PrimaryButton type="submit" disabled={busy || !apiKey.trim()}>
              {busy ? "Connecting…" : "Connect with API key"}
            </PrimaryButton>
          </form>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-hairline pt-3.5 text-[13.5px]">
          {connectUrl && (
            <a href={connectUrl} target="_blank" rel="noreferrer" className="arrow-link">
              {connected ? "Manage in Marketing OS Integrations" : "Connect with OAuth"}
            </a>
          )}
          {connected && connectUrl && (
            <a href={connectUrl} target="_blank" rel="noreferrer" className="text-ink-3 transition-colors duration-[160ms] hover:text-gold">
              Disconnect
            </a>
          )}
          {!connectUrl && (
            <span className="text-ink-3">
              OAuth connect and disconnect live in Marketing OS → Integrations (set
              MARKETING_OS_API_URL to link them here).
            </span>
          )}
        </div>
        {connected && (
          <p className="mt-2 text-[11.5px] text-ink-3">
            OAuth connect, key rotation, and disconnect run in the Marketing OS app —
            the platform owns the vault and the revocation path.
          </p>
        )}

        {note && (
          <p className={"mt-3 text-[13px] " + (note.kind === "error" ? "text-danger" : "text-ink-2")}>
            {note.text}
          </p>
        )}
      </div>
    </article>
  );
}

/* ─── The admin surface ───────────────────────────────────────────── */

export function SkillsAdmin({
  packs,
  klaviyo,
  integrationsUrl,
}: {
  packs: PackCardData[];
  klaviyo: ConnectionHealth;
  integrationsUrl: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {packs.map((p) => (
          <PackCard key={p.meta.id} pack={p} integrationsUrl={integrationsUrl} />
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-4">
          <span className="rule" />
          <span className="eyebrow">Connections</span>
        </div>
        <KlaviyoConnectionCard health={klaviyo} integrationsUrl={integrationsUrl} />
      </div>
    </div>
  );
}
