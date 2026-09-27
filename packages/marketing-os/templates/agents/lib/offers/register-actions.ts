/**
 * Register the offer pack's four Actions with the runtime registry (spec 32
 * OF2), mirroring lib/email/register-actions.ts exactly.
 *
 * DORMANT BY DESIGN (see docs/plans/offer-agent/KICKOFF.md's OF2 note): this
 * makes offer.activate/pause/retire/reallocate REACHABLE at
 * /api/actions/execute under executor "agents", but nothing calls
 * propose_action with these kinds yet. Today's approval path stays exactly
 * what it always was — the template's own console-approval route
 * (app/api/offers/deploy) for propose_offer's draft; marketing-os-app's own
 * "app"-executor offer.activate registration for the hosted flow. Routing
 * propose_offer through these Actions instead (and removing the
 * marketing-os-app registration so the same kind isn't defined twice) is the
 * explicit cutover spec 32's kickoff doc calls out — a coordinated change
 * across two repos, not something this file does by existing.
 */

import { registerAction } from "../actions/registry";
import { createOfferActions, type OfferActionDeps } from "./actions";
import { offerRepo } from "./repo";
import { offerPlatformClient } from "./platform-client";

function deps(): OfferActionDeps {
  return { repo: offerRepo, platform: offerPlatformClient };
}

let registered = false;

/** Idempotent module-level registration. */
export function registerOfferActions(): void {
  if (registered) return;
  registered = true;
  registerAction("offer.activate", () => createOfferActions(deps()).activateOffer);
  registerAction("offer.pause", () => createOfferActions(deps()).pauseOffer);
  registerAction("offer.retire", () => createOfferActions(deps()).retireOffer);
  registerAction("offer.reallocate", () => createOfferActions(deps()).reallocateOffer);
}

registerOfferActions();
