/**
 * Social channel adapters (spec 24 §4 D3 — direct platform APIs, SM2).
 *
 * One thin `publish(post, assetUrl) → {platformId, permalink}` connector per
 * channel; the Action layer is channel-agnostic and selects by post.channel.
 * Launch roster: Instagram (verified live for Arthaus) + Threads (built,
 * awaiting a user token). Pinterest et al. add here, demand-driven (D1).
 *
 * CREDENTIAL SEAM — the per-tenant token source. Adapters never read env
 * directly; they ask a ChannelTokenSource. v1 binds `envTokenSource` — the
 * single-tenant bootstrap that reads the Arthaus tokens from the runtime's
 * env (ARTHAUS_IG_ACCESS_TOKEN, verified live 2026-07-17). Multi-tenant
 * replaces ONE binding: a source backed by Vault/provider_connections rows
 * (spec 12 credential-broker pattern, per-tenant OAuth via the Meta login
 * config) resolved inside runWithTenant — the adapters and Actions don't
 * change. The OAuth connect flow itself is the multi-tenant follow-up and is
 * deliberately NOT built here.
 */

import type { SocialChannelAdapter } from "../types";
import { createInstagramAdapter } from "./instagram";
import { createThreadsAdapter } from "./threads";

export interface ChannelTokenSource {
  /** Resolve the publish token for a channel. Throws (clearly) when the channel isn't connected. */
  accessToken(channel: string): Promise<string>;
}

/**
 * v1 single-tenant env bootstrap. Generic SOCIAL_* names win so a rename
 * never requires code; the ARTHAUS_* fallbacks match what's provisioned in
 * the deployed env today.
 */
export const envTokenSource: ChannelTokenSource = {
  async accessToken(channel: string): Promise<string> {
    const byChannel: Record<string, (string | undefined)[]> = {
      instagram: [process.env.SOCIAL_IG_ACCESS_TOKEN, process.env.ARTHAUS_IG_ACCESS_TOKEN],
      threads: [process.env.SOCIAL_THREADS_ACCESS_TOKEN, process.env.THREADS_ACCESS_TOKEN],
    };
    const token = (byChannel[channel] ?? []).find((t) => t);
    if (!token) {
      throw new Error(
        `no publish token configured for channel "${channel}" — v1 reads it from env (instagram: ARTHAUS_IG_ACCESS_TOKEN, threads: THREADS_ACCESS_TOKEN); the per-tenant Vault source lands with the OAuth connect flow`,
      );
    }
    return token;
  },
};

const SUPPORTED = ["instagram", "threads"] as const;

/** Adapter selection by post.channel (spec 24 §4 — the Action layer stays channel-agnostic). */
export function adapterFor(
  channel: string,
  tokens: ChannelTokenSource = envTokenSource,
): SocialChannelAdapter {
  switch (channel) {
    case "instagram":
      return createInstagramAdapter(tokens);
    case "threads":
      return createThreadsAdapter(tokens);
    default:
      throw new Error(
        `no publishing connector for channel "${channel}" — supported today: ${SUPPORTED.join(", ")} (spec 24 D1: channels roll out demand-driven)`,
      );
  }
}
