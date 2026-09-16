/**
 * The offer Actions (spec 32 §3/§4/OF2) — spec 20 `Action<P>` declarations.
 *
 * DECLARED here (the pack owns the semantics); EXECUTED by whichever gate
 * dispatches to this deployment's `/api/actions/execute` (spec 20 §4). The
 * pack never sees a credential and never decides — it defines what
 * "activate this offer" precisely means.
 *
 * Write order is GIT-FIRST (spec 32 §4.1 — a deliberate reversal of an
 * earlier draft of that spec, see its own note): every execute() writes the
 * repo artifact before it touches the platform's surface store, because
 * `commitFile()` through a `StoreRepo` bound in `mirror`/`git` mode is an
 * API call on the order of the platform write beside it (proven live by the
 * email pack since 2026-08-31), and because the artifact lying about what
 * shipped is the worse failure — the harder one to notice. A store still on
 * `STORE_REPO_MODE=db` gets identical externally-visible behaviour; the
 * write just lands in `mos_offer_artifacts` instead of git.
 *
 * `offer.activate`'s params carry the FULL compiled manifest (not just the
 * surface id) — this is what makes the git-first write possible at
 * approval time: the content has to be here to write `offer.md`. Today's
 * `marketing-os-app` registration of `offer.activate` only ever passed
 * `{surfaceId}` (it doesn't need the manifest — the surface was already
 * staged PAUSED at propose time via `stageSurface`, and its `execute()` is
 * a Prisma status flip with no repo access). Routing THIS Action's richer
 * params through the actual approval flow is the OF2 cutover spec 32's
 * kickoff doc calls out explicitly — not done as part of this file.
 *
 * `offer.pause`/`offer.retire` reuse the same amendment idiom email's
 * Actions use: load, mutate the in-memory record, save.
 *
 * `offer.reallocate` deliberately does NOT recompute a decision — it applies
 * exactly what `review_offer_experiment` already recommended (spec 32 §8:
 * "reallocation among approved arms is not a new approval" — the merchant
 * approved the EXPERIMENT, and this Action is the engine doing what was
 * approved; recomputing here would let the Action's own judgment drift from
 * the read the merchant or the ritual actually saw).
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Action, ActionPreview, ActionResult } from "@avant-garde/skill-kit";
import type { Offer, OfferPlatformClient, OfferRepo, OfferResultEntry } from "./types";
import {
  appendResultEntry,
  offerManifestSchema,
  offerPath,
  parseOffer,
  parseResults,
  resultsPath,
  serializeOffer,
  serializeResults,
} from "./artifacts";
import { gateOfferContent } from "./gates";

export interface OfferActionDeps {
  repo: OfferRepo;
  platform: OfferPlatformClient;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function hashMaterial(material: unknown): string {
  return sha256(JSON.stringify(material));
}

async function loadOffer(repo: OfferRepo, id: string): Promise<Offer> {
  const raw = await repo.readFile(offerPath(id));
  if (raw === null) throw new Error(`offer "${id}" not found (${offerPath(id)})`);
  return parseOffer(raw);
}

async function saveOffer(repo: OfferRepo, offer: Offer): Promise<void> {
  await repo.writeFile(offerPath(offer.id), serializeOffer(offer));
}

async function appendResults(repo: OfferRepo, id: string, entry: OfferResultEntry): Promise<void> {
  const raw = await repo.readFile(resultsPath(id));
  const existing = raw === null ? null : parseResults(raw);
  const updated = appendResultEntry(existing, id, entry);
  await repo.writeFile(resultsPath(id), serializeResults(updated));
}

// ---------------------------------------------------------------------------
// offer.activate (medium) — approved -> active
// ---------------------------------------------------------------------------

const activateParams = z.object({
  id: z.string().regex(/^[a-z0-9_-]{4,48}$/),
  title: z.string().min(1),
  hypothesis: z.string().min(1),
  personaRef: z.string().optional(),
  manifest: offerManifestSchema,
});
export type ActivateOfferParams = z.infer<typeof activateParams>;

function activateOffer(deps: OfferActionDeps): Action<ActivateOfferParams> {
  return {
    kind: "offer.activate",
    title: "Activate offer",
    paramsSchema: activateParams,
    summary: (p) => `Put "${p.title}" live on the storefront, as an experiment with a held-out control`,
    scopes: ["storefront:write_offers"],
    risk: "medium",
    async preview(p) {
      // Defense in depth: the platform re-validates on POST too (spec 14
      // O4's own comment — "so the agent can fix its copy instead of being
      // rejected at the door" — applies equally to a stale re-approval).
      const variantsById = Object.fromEntries(
        Object.entries(p.manifest.variants).map(([k, v]) => [k, v.content as unknown as Record<string, string>]),
      );
      const gates = gateOfferContent(variantsById);
      if (!gates.passed) {
        throw new Error(
          `offer.activate: content no longer passes the gates (${gates.darkPattern.findings.map((f) => f.message).join("; ") || "consent missing"})`,
        );
      }
      const arms = p.manifest.experiment.arms.map((a) => `${a.key} ${Math.round(a.weight * 100)}%`).join(" · ");
      return {
        summary: `Offer "${p.title}" goes ACTIVE — ${p.manifest.placement}, arms: ${arms}`,
        rows: [
          { label: "Offer", value: p.id },
          { label: "Hypothesis", value: p.hypothesis },
          { label: "Placement", value: p.manifest.placement },
          { label: "Arms", value: arms },
          { label: "Consent", value: "present, gate-checked" },
        ],
        previewHash: hashMaterial({ kind: "offer.activate", id: p.id, manifest: p.manifest }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const offer: Offer = {
        id: p.id,
        title: p.title,
        hypothesis: p.hypothesis,
        status: "active",
        manifest: p.manifest,
        experimentId: p.manifest.experiment.id,
        provenance: [{ claim: `activated ${new Date().toISOString()}`, origin: "owner" }],
        body: `Activated by offer.activate.`,
      };
      if (p.personaRef !== undefined) offer.personaRef = p.personaRef;

      // 1. TRUTH — write offer.md before the surface deploys (git-first, §4.1).
      await saveOffer(deps.repo, offer);

      // 2. THE DEPLOY — idempotent whether or not the surface was already
      // staged PAUSED at propose time (stageSurface upserts by surfaceId).
      await deps.platform.stageSurface(p.manifest, "ACTIVE");

      return {
        ok: true,
        summary: `"${p.title}" is ACTIVE`,
        detail: { id: p.id, experimentId: p.manifest.experiment.id },
      } satisfies ActionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// offer.pause (medium) — active -> paused, reversible
// ---------------------------------------------------------------------------

const pauseParams = z.object({ id: z.string().regex(/^[a-z0-9_-]{4,48}$/) });
export type PauseOfferParams = z.infer<typeof pauseParams>;

function pauseOffer(deps: OfferActionDeps): Action<PauseOfferParams> {
  return {
    kind: "offer.pause",
    title: "Pause offer",
    paramsSchema: pauseParams,
    summary: (p) => `Pause offer "${p.id}" — stops showing on the storefront, resumable`,
    scopes: ["storefront:write_offers"],
    risk: "medium",
    async preview(p) {
      const offer = await loadOffer(deps.repo, p.id);
      return {
        summary: `Pause "${offer.title}" — current status: ${offer.status}`,
        rows: [{ label: "Offer", value: offer.id }, { label: "Current status", value: offer.status }],
        previewHash: hashMaterial({ kind: "offer.pause", id: p.id, offerStatus: offer.status }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const offer = await loadOffer(deps.repo, p.id);
      await saveOffer(deps.repo, { ...offer, status: "paused" });
      await deps.platform.reallocate(p.id, "pause");
      return { ok: true, summary: `"${offer.title}" is paused`, detail: { id: p.id } } satisfies ActionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// offer.retire (medium) — terminal; records why in results.md
// ---------------------------------------------------------------------------

const retireParams = z.object({
  id: z.string().regex(/^[a-z0-9_-]{4,48}$/),
  reason: z.string().min(1),
});
export type RetireOfferParams = z.infer<typeof retireParams>;

function retireOffer(deps: OfferActionDeps): Action<RetireOfferParams> {
  return {
    kind: "offer.retire",
    title: "Retire offer",
    paramsSchema: retireParams,
    summary: (p) => `Retire offer "${p.id}" — ${p.reason}`,
    scopes: ["storefront:write_offers"],
    risk: "medium",
    async preview(p) {
      const offer = await loadOffer(deps.repo, p.id);
      return {
        summary: `Retire "${offer.title}" — ${p.reason}`,
        rows: [{ label: "Offer", value: offer.id }, { label: "Reason", value: p.reason }],
        warnings: offer.status === "active" ? ["This offer is currently live — retiring stops it immediately."] : [],
        previewHash: hashMaterial({ kind: "offer.retire", id: p.id, reason: p.reason }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const offer = await loadOffer(deps.repo, p.id);
      await saveOffer(deps.repo, { ...offer, status: "retired" });
      await appendResults(deps.repo, p.id, {
        at: new Date().toISOString(),
        decision: "retire",
        rationale: p.reason,
        winner: null,
        posteriors: {},
      });
      await deps.platform.reallocate(p.id, "retire");
      return { ok: true, summary: `"${offer.title}" retired`, detail: { id: p.id } } satisfies ActionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// offer.reallocate (medium) — applies an ALREADY-RECOMMENDED decision
// ---------------------------------------------------------------------------

const reallocateParams = z.object({
  id: z.string().regex(/^[a-z0-9_-]{4,48}$/),
  mode: z.enum(["promote", "thompson"]),
  winner: z.string().optional(),
  days: z.number().int().min(7).max(90),
  rationale: z.string().min(1),
  posteriors: z.record(z.string(), z.number()),
});
export type ReallocateOfferParams = z.infer<typeof reallocateParams>;

function reallocateOffer(deps: OfferActionDeps): Action<ReallocateOfferParams> {
  return {
    kind: "offer.reallocate",
    title: "Reallocate offer traffic",
    paramsSchema: reallocateParams,
    summary: (p) =>
      p.mode === "promote"
        ? `Promote "${p.winner ?? "the leading arm"}" — it takes the full variant share`
        : `Shift traffic toward the leader (Thompson) on offer "${p.id}"`,
    scopes: ["storefront:write_offers"],
    risk: "medium",
    async preview(p) {
      const offer = await loadOffer(deps.repo, p.id);
      if (p.mode === "promote" && !p.winner) throw new Error("offer.reallocate: promote requires winner");
      return {
        summary: `${p.mode === "promote" ? "Promote" : "Reallocate"} on "${offer.title}": ${p.rationale}`,
        rows: [
          { label: "Offer", value: offer.id },
          { label: "Mode", value: p.mode },
          ...(p.winner ? [{ label: "Winner", value: p.winner }] : []),
        ],
        previewHash: hashMaterial({ kind: "offer.reallocate", id: p.id, mode: p.mode, winner: p.winner ?? null }),
      } satisfies ActionPreview;
    },
    async execute(p) {
      const offer = await loadOffer(deps.repo, p.id);
      // TRUTH first: the historical record of why traffic moved, before the
      // move itself (§4.1's ordering, applied to a non-status-change write).
      await appendResults(deps.repo, p.id, {
        at: new Date().toISOString(),
        decision: p.mode === "promote" ? "promote" : "reallocate",
        rationale: p.rationale,
        winner: p.winner ?? null,
        posteriors: p.posteriors,
      });
      await deps.platform.reallocate(p.id, p.mode, { days: p.days, winner: p.winner });
      return {
        ok: true,
        summary: `Applied ${p.mode} on "${offer.title}"`,
        detail: { id: p.id, mode: p.mode, winner: p.winner ?? null },
      } satisfies ActionResult;
    },
  };
}

export function createOfferActions(deps: OfferActionDeps) {
  return {
    activateOffer: activateOffer(deps),
    pauseOffer: pauseOffer(deps),
    retireOffer: retireOffer(deps),
    reallocateOffer: reallocateOffer(deps),
  };
}
