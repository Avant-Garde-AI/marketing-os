/**
 * Social channel adapters (spec 24 §4 D3 — direct platform APIs, SM2).
 *
 * One thin `publish(post, assetUrl) → {platformId, permalink}` connector per
 * channel; the Action layer is channel-agnostic and selects by post.channel.
 * Launch roster: Instagram (verified live for Arthaus) + Threads (built,
 * awaiting a user token). Pinterest et al. add here, demand-driven (D1).
 *
 * CREDENTIAL SEAM — the per-tenant token source. Adapters never read env
 * directly; they ask a ChannelTokenSource. The default binding is
 * `brokerTokenSource`: the platform's Vault-backed provider_connections row
 * (provider 'meta', product = channel — one Meta connection covers both
 * channels, matching the future config_id OAuth grant) resolved through the
 * credential broker inside runWithTenant. `envTokenSource` — the original
 * single-tenant bootstrap (ARTHAUS_IG_ACCESS_TOKEN, verified live
 * 2026-07-17) — remains the fallback so an unconfigured broker or a
 * not-yet-migrated tenant keeps publishing. The OAuth connect flow itself is
 * the multi-tenant follow-up and is deliberately NOT built here.
 */

import type { SocialChannelAdapter } from "../types";
import { getBrokerToken } from "../../broker-client";
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

/**
 * Vault-backed source (refinement: social secrets → Vault): the platform's
 * provider_connections row for provider 'meta' holds a JSON Vault secret of
 * per-channel publish tokens; the broker serves the one for this channel
 * (product = channel), cached per tenant in broker-client. Env is the
 * explicit fallback on ANY broker failure — an unconfigured broker or an
 * unmigrated tenant publishes exactly as before; when both lanes fail, the
 * error names both so the operator sees the whole picture.
 */
export const brokerTokenSource: ChannelTokenSource = {
  async accessToken(channel: string): Promise<string> {
    let brokerFailure: string;
    try {
      return (await getBrokerToken("meta", channel)).accessToken;
    } catch (e) {
      brokerFailure = e instanceof Error ? e.message : String(e);
    }
    try {
      return await envTokenSource.accessToken(channel);
    } catch (e) {
      const envFailure = e instanceof Error ? e.message : String(e);
      throw new Error(
        `no publish token for channel "${channel}" — broker: ${brokerFailure}; env fallback: ${envFailure}`,
      );
    }
  },
};

const SUPPORTED = ["instagram", "threads"] as const;

/** Adapter selection by post.channel (spec 24 §4 — the Action layer stays channel-agnostic). */
export function adapterFor(
  channel: string,
  tokens: ChannelTokenSource = brokerTokenSource,
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
