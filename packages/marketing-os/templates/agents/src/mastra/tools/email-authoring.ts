/**
 * Campaign authoring — the missing write between "plan" and "stage".
 *
 * The pack could PLAN (email_plan_propose), PREVIEW (email_render_preview) and
 * STAGE to Klaviyo (the create_campaign_draft Action), but nothing let an agent
 * author a campaign's actual content: its subject, preview text, audience and
 * sections. That content was only ever written by hand or by a harness script,
 * which is why campaigns could not be driven end-to-end from a chat or an MCP
 * client. This closes it.
 *
 * ## Why this is not an Action
 *
 * Spec 20's line is that writes to EXTERNAL state are Actions. This writes a
 * campaign artifact into the store's own repo — it creates nothing in Klaviyo,
 * schedules nothing, and sends nothing. The gate stays exactly where it was: a
 * campaign only reaches Klaviyo through `klaviyo.create_campaign_draft`, and
 * only sends through `klaviyo.schedule_campaign`, both of which are proposed
 * for human approval. Authoring freely and publishing under approval is the
 * intended shape.
 *
 * Two guards keep that honest:
 *   - a campaign that has already been DRAFTED into Klaviyo or SCHEDULED is not
 *     editable here; re-drafting is what re-syncs it, and silently mutating the
 *     artifact under an approved send would make the approval nonce a lie.
 *   - `status` is never settable by the caller — it is derived from the
 *     lifecycle, so an agent cannot mark its own work approved.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { emailRepo } from "../../../lib/email/repo";
import { syncCampaignIndex } from "../../../lib/email/index-sync";
import { isEphemeralUrl, persistAsset } from "../../../lib/store-repo/assets";
import { emailAssetLink } from "../../../lib/email/review-links";
import { resolveAudienceRefs, reconcileWithStrategy } from "../../../lib/email/audience";
import { loadWallSets, rankWallSets, toWallSetBlock, priceWallSet } from "../../../lib/email/wall-sets";
import { readArtistProfile, toArtistCardBlock } from "../../../lib/email/artist-profile";
import { readPrices, handleFromHref, isPlaceholderPrice } from "../../../lib/email/product-prices";
import { emailBlockSchema } from "../../../lib/email-assembly/types";
import { betterFrame, isWhiteLeaningMockup } from "../../../lib/email/leaning-mockups";
import { getTenant } from "../../../lib/tenant-context";
import { campaignPath, parseCampaign, serializeCampaign, parseStrategy, strategyPathFor, resolveEmailRoot } from "../../../lib/email/artifacts";
import type { EmailCampaign, StrategyAudience, CampaignAudienceRef } from "../../../lib/email/types";

/**
 * An audience, named the way the planner names one.
 *
 * `email_plan_propose` assigns each slot a roster KEY out of strategy.md
 * ("full-reach"), never a Klaviyo ref — the rotation and the cadence caps are
 * keyed. So a campaign written from a plan arrives holding a key, and the
 * six-character Klaviyo id is the one thing the agent cannot know. Requiring
 * the id here forced it to either invent one or, once inventing was refused,
 * leave the audience off entirely. Both happened, in that order.
 *
 * So `key` alone is enough: the roster is the authority and supplies the type
 * and id. `type`+`id` still work for an audience outside the roster, resolved
 * against Klaviyo as before.
 *
 * Kept a plain object rather than a `.refine`d one: a refinement turns this
 * into a ZodEffects, and what reaches Gemini is a function declaration, not
 * Zod. The "key, or type and id" rule is enforced in execute() where it can
 * also name the roster.
 */
const audienceRefSchema = z.object({
  key: z.string().optional().describe('Roster key from strategy.md, e.g. "full-reach". Preferred — the store resolves it to the real Klaviyo list or segment.'),
  type: z.enum(["list", "segment"]).optional(),
  id: z.string().optional().describe("Klaviyo list/segment id. Only for an audience outside the roster — never guess one; call klaviyo_audiences_read."),
  label: z.string().optional(),
});

const sectionSchema = z.union([
  z.object({
    slot: z.string().min(1),
    type: z.literal("html"),
    blocks: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .describe("email-assembly blocks: heading, paragraph, button, productRow, eyebrow, callout, ctaBand, featuredCard, list, swatches, chips, trustBadges, divider, image, graphCallout."),
  }),
  z.object({
    slot: z.string().min(1),
    type: z.literal("surface"),
    alt: z.string().min(1).describe("Describes the MESSAGE, not the pixels. Mandatory — the invariant gate rejects an image without it."),
    imageUrl: z.string().optional().describe("A resolved image URL (e.g. from imagery_resolve). Signed URLs expire; the draft Action re-uploads to the ESP."),
    surfaceId: z.string().optional(),
    boardName: z.string().optional(),
    assetPath: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
]);

/** Statuses whose artifact must not be edited in place — see module doc. */
const FROZEN = new Set(["drafted", "scheduled", "sent", "measured"]);

export const emailCampaignUpsert = createTool({
  id: "email_campaign_upsert",
  description:
    "Create or update a campaign's CONTENT in the store repo: subject, preview text, audience, and the ordered sections that make up the email. Writes only the repo artifact — nothing is created in Klaviyo and nothing sends; staging to the ESP is a separate approved Action. Pass only the fields you want to change; omitted fields are preserved. Refuses to edit a campaign already drafted into Klaviyo or scheduled (re-draft it instead, so the approval and the artifact cannot drift apart). Use email_render_preview afterwards to see it and check the invariant report.",
  inputSchema: z.object({
    id: z.string().min(1).describe("Campaign id, e.g. 2026-09-01-artist-mirimo."),
    archetype: z.string().optional().describe("Required when creating: editorial, artist-drop, set-feature, room-recommendation, new-arrivals, seasonal…"),
    subject: z.string().optional(),
    subjectCandidates: z.array(z.string()).optional(),
    headlineOptions: z
      .array(z.object({
        id: z.string().min(1).describe('Short stable slug, e.g. "occasion-led".'),
        headline: z.string().min(1).describe("Becomes the subject line."),
        subheadline: z.string().min(1).describe("Becomes the preview text."),
        why: z.string().optional().describe("One sentence on the angle this takes, so a reviewer can tell the three apart."),
      }))
      .optional()
      .describe("Three headline/subheadline pairs to choose from. ALWAYS supply three when writing or revising a campaign: the pair is the whole of what an inbox shows, and one unreviewed phrasing should not become the campaign's voice by default. Set `subject`/`previewText` to your recommended option as well, and selectedHeadlineId to its id."),
    selectedHeadlineId: z.string().optional().describe("Which of headlineOptions is live. Keep it consistent with subject/previewText."),
    previewText: z.string().optional(),
    audienceIncluded: z.array(audienceRefSchema).optional().describe('Who receives it. Prefer the roster key email_plan_propose assigned to the slot — [{"key": "full-reach"}]. The store resolves it to the real Klaviyo list or segment; you do not need the id, and must not guess one.'),
    audienceExcluded: z.array(audienceRefSchema).optional(),
    sections: z.array(sectionSchema).optional().describe("The email body, in order. Replaces the existing sections wholesale when supplied."),
    skeletonRef: z.string().optional(),
    copyFormulaRef: z.string().optional().describe("The brand.md copy formula this instantiates."),
    discountCode: z.string().optional().describe('The discount code this campaign promises, e.g. "LABORDAY15". Declare it here whenever the copy names one — the approval gate verifies it exists in Shopify and refuses a campaign that promises a code the store cannot honour.'),
    body: z.string().optional().describe("Markdown rationale — why this campaign, why these pieces. Kept with the artifact."),
    scheduledAt: z.string().optional().describe("Intended send time (ISO). Recording it here does NOT schedule anything."),
  }),
  execute: async (input: {
    id: string;
    archetype?: string;
    subject?: string;
    subjectCandidates?: string[];
    headlineOptions?: Array<{ id: string; headline: string; subheadline: string; why?: string }>;
    selectedHeadlineId?: string;
    previewText?: string;
    audienceIncluded?: Array<{ key?: string; type?: "list" | "segment"; id?: string; label?: string }>;
    audienceExcluded?: Array<{ key?: string; type?: "list" | "segment"; id?: string; label?: string }>;
    sections?: unknown[];
    skeletonRef?: string;
    copyFormulaRef?: string;
    discountCode?: string;
    body?: string;
    scheduledAt?: string;
  }) => {
    const path = campaignPath(input.id);
    const raw = await emailRepo.readFile(path);
    const existing = raw === null ? null : parseCampaign(raw);

    if (existing && FROZEN.has(existing.status)) {
      throw new Error(
        `campaign "${input.id}" is "${existing.status}" — its artifact is frozen so the approved draft and the file cannot drift. Re-run klaviyo.create_campaign_draft to re-sync after changes, or work on a new campaign id.`,
      );
    }
    if (!existing && !input.archetype) {
      throw new Error(`campaign "${input.id}" does not exist — pass archetype to create it.`);
    }

    const next: EmailCampaign = existing
      ? { ...existing }
      : {
          id: input.id,
          archetype: input.archetype!,
          audience: { included: [], excluded: [] },
          subjectCandidates: [],
          skeletonRef: input.skeletonRef ?? "emails-frame",
          sections: [],
          utm: { campaign: input.id, source: "klaviyo", medium: "email" },
          provenance: [],
          status: "proposed",
          body: "",
        };

    if (input.archetype !== undefined) next.archetype = input.archetype;
    if (input.subject !== undefined) next.subject = input.subject;
    if (input.subjectCandidates !== undefined) next.subjectCandidates = input.subjectCandidates;
    if (input.headlineOptions !== undefined) next.headlineOptions = input.headlineOptions;
    if (input.selectedHeadlineId !== undefined) next.selectedHeadlineId = input.selectedHeadlineId;
    // Keep the pair and the selection from drifting. If a selection names an
    // option, that option IS the subject and preview text — otherwise the
    // review room shows one thing selected and the email sends another.
    if (next.selectedHeadlineId) {
      const chosen = (next.headlineOptions ?? []).find((o) => o.id === next.selectedHeadlineId);
      if (chosen) {
        next.subject = chosen.headline;
        next.previewText = chosen.subheadline;
      }
    }
    if (input.previewText !== undefined) next.previewText = input.previewText;
    if (input.skeletonRef !== undefined) next.skeletonRef = input.skeletonRef;
    if (input.copyFormulaRef !== undefined) next.copyFormulaRef = input.copyFormulaRef;
    if (input.discountCode !== undefined) next.discountCode = input.discountCode.trim().toUpperCase();
    if (input.body !== undefined) next.body = input.body;
    if (input.scheduledAt !== undefined) next.scheduledAt = input.scheduledAt;
    // Held loosely here: a key-only ref has no id yet, and the roster supplies
    // one below. Narrowed back to CampaignAudienceRef once reconciled — nothing
    // between here and there reads id.
    if (input.audienceIncluded !== undefined) {
      next.audience = { ...next.audience, included: input.audienceIncluded as CampaignAudienceRef[] };
    }
    if (input.audienceExcluded !== undefined) {
      next.audience = { ...next.audience, excluded: input.audienceExcluded as CampaignAudienceRef[] };
    }
    if (input.sections !== undefined) {
      // Check every block against the renderer's own schema, HERE, before
      // anything is written.
      //
      // The upsert schema listed the block kinds by name and nothing else, so
      // every field was a guess. The agent guessed `items` for a productRow's
      // products — twice, in two separate campaigns — and nothing objected:
      // the artifact was written, committed to git, indexed, and shown in the
      // console with a subject, a send date and an audience. The only symptom
      // was an empty preview frame, several minutes and one page load later,
      // reported as a 404. A validation failure had to travel through git and
      // a render route to become visible.
      //
      // Reporting the Zod path back to the caller is also how the agent learns
      // the shape it could not have known — cheaper and more current than
      // enumerating every block's fields in a tool description.
      const problems: string[] = [];
      (input.sections as Array<Record<string, unknown>>).forEach((section, si) => {
        const blocks = section?.blocks;
        if (!Array.isArray(blocks)) return; // surface sections carry no blocks
        blocks.forEach((block, bi) => {
          const check = emailBlockSchema.safeParse(block);
          if (check.success) return;
          const where = `sections[${si}] (slot "${section.slot ?? "?"}") block[${bi}] kind "${(block as { kind?: string })?.kind ?? "missing"}"`;
          problems.push(
            `${where}: ${check.error.issues.map((i) => `${i.path.join(".") || "(root)"} — ${i.message}`).join("; ")}`,
          );
        });
      });
      if (problems.length > 0) {
        throw new Error(
          `${problems.length} block(s) will not render, so nothing was written:\n` +
            problems.map((p) => `  - ${p}`).join("\n") +
            `\nFix the blocks and call again. A productRow takes "products", not "items".`,
        );
      }
      next.sections = input.sections as EmailCampaign["sections"];
    }

    // Status is LIFECYCLE, never content-derived: a campaign becomes `approved`
    // via the email.approve_plan Action and `drafted` via create_campaign_draft.
    // Authoring content must not promote it, or an agent could approve its own
    // work by writing a section.

    const imageryWarnings: string[] = [];

    // An artifact may not carry an EXPIRING url. imagery_resolve returns signed
    // GCS links good for 24h; a review link lives 30 days, so from day two every
    // reviewer opened a page of broken images. Copy the bytes now, while the
    // signature is still valid, and point the artifact at a URL that survives.
    const shop = getTenant().shop;

    /** Persist one ephemeral url and hand back its durable replacement. */
    const durable = async (url: string, label: string): Promise<string> => {
      if (!isEphemeralUrl(url)) return url;
      const stored = await persistAsset(emailRepo, next.id, label, url);
      if (stored) return emailAssetLink(shop, next.id, stored.name).url;
      // Keep the working-but-expiring url rather than dropping the image, and
      // say so — a campaign whose imagery failed to copy is still worth saving.
      imageryWarnings.push(
        `${label}: could not copy imagery to durable storage; the artifact still holds an expiring URL that will break within 24h.`,
      );
      return url;
    };

    /**
     * The WHITE leaning mockup renders its frame invisible against the wall, so
     * the artwork reads as floating in a blank panel — a printing fault, not a
     * product. One shipped in the Labor Day callout beside a walnut and a black
     * frame and was the only thing anyone noticed about the email.
     *
     * CORRECTED rather than merely flagged. The same artwork usually exists in
     * black, oak or walnut, and a warning that requires someone to go find the
     * alternative is a warning most people will skip — this campaign set had six
     * white mockups across three campaigns, and every one of them had been
     * reviewed by a human already. Swapping is safe because it changes the frame
     * around the work, never the work.
     *
     * When the library genuinely has no other colourway (about a quarter of
     * artworks), it warns instead and names the piece, because the only fix left
     * is an editorial one: choose a different work.
     */
    const fixWhiteFrame = async (url: string, label: string): Promise<string> => {
      if (!isWhiteLeaningMockup(url)) return url;
      const swap = await betterFrame(url);
      if (swap?.to) {
        imageryWarnings.push(
          `${label}: swapped the white leaning mockup for the ${swap.toFrame} one ` +
            `(the white colourway renders the frame invisible).`,
        );
        return swap.to;
      }
      imageryWarnings.push(
        `${label}: this is the WHITE leaning mockup and "${swap?.handle ?? "this artwork"}" has no ` +
          `black, oak or walnut render in the library. It will look like the piece is floating in a ` +
          `blank panel. Choose a different artwork for this slot.`,
      );
      return url;
    };

    // Walk EVERY image, not just the section-level hero. Blocks carry images
    // too — a productRow's leaning shots, a graphCallout's pieces — and an
    // expiring url is just as broken there. The first version of this only
    // covered section.imageUrl, which was fine until product imagery stopped
    // being flat catalogue scans.
    for (const section of next.sections) {
      const sec = section as { slot: string; imageUrl?: string; blocks?: Array<Record<string, unknown>> };
      if (sec.imageUrl) {
        sec.imageUrl = await durable(await fixWhiteFrame(sec.imageUrl, sec.slot), sec.slot);
      }
      for (const block of sec.blocks ?? []) {
        for (const key of ["imageUrl", "src", "url"]) {
          const v = block[key];
          if (typeof v === "string") {
            const fixed = await fixWhiteFrame(v, `${sec.slot}/${block.kind ?? "block"}`);
            block[key] = await durable(fixed, `${sec.slot}-${block.kind ?? "block"}`);
          }
        }
        // Composite blocks nest their images one level down.
        const items = (block.products ?? block.pieces ?? block.items) as
          | Array<Record<string, unknown>>
          | undefined;
        for (const item of items ?? []) {
          for (const key of ["imageUrl", "src", "url"]) {
            const v = item[key];
            if (typeof v === "string") {
              const fixed = await fixWhiteFrame(v, `${sec.slot}/${String(item.name ?? item.title ?? "piece")}`);
              item[key] = await durable(fixed, `${sec.slot}-item`);
            }
          }
        }
      }
    }

    // Real prices. Cards shipped with the literal string "View piece" where
    // money belongs, which no reviewer can judge. Resolved on write so the
    // campaign is REVIEWABLE; the draft Action must re-resolve before staging,
    // because a price is a fact about a moment and an artifact written today
    // may send in three weeks.
    // A store may decline prices outright — see EmailStrategy.showPrices. For a
    // multi-currency catalogue one figure is right for some readers and wrong
    // for the rest, and a wrong price is a promise the store never made. Such a
    // store shows the work and lets the storefront quote in the reader's own
    // currency.
    // Try BOTH roots. resolveEmailRoot probes `emails/partials/`, and in mirror
    // mode list() unions git with the DB — so a store whose partials are still
    // DB-only can answer "emails" while its strategy sits at `email/strategy.md`.
    // That mismatch made this read return null and the policy silently not
    // apply, which is the failure shape this codebase keeps producing: a
    // decision that quietly does nothing.
    let showPrices = true;
    // Kept beyond the price policy: the same document carries the audience
    // roster, and the audience the agent hands in has to be checked against it.
    let roster: StrategyAudience[] = [];
    let policyFrom = "default (no strategy found at either root)";
    for (const path of ["email/strategy.md", "emails/strategy.md"]) {
      try {
        const raw = await emailRepo.readFile(path);
        if (raw === null) continue;
        const parsed = parseStrategy(raw);
        showPrices = parsed.showPrices !== false;
        roster = parsed.audiences ?? [];
        policyFrom = `${path} (showPrices=${parsed.showPrices ?? "unset"})`;
        break;
      } catch (e) {
        // A strategy that exists but will not parse must not read as "no
        // policy" — say so rather than falling through to the default.
        policyFrom = `${path} UNPARSEABLE: ${e instanceof Error ? e.message : e}`;
      }
    }
    console.info(`[email] price policy ← ${policyFrom}`);
    if (!showPrices) {
      for (const section of next.sections) {
        for (const block of (section as { blocks?: Array<Record<string, unknown>> }).blocks ?? []) {
          if (block.kind === "productRow") {
            for (const p of (block.products as Array<Record<string, unknown>>) ?? []) delete p.price;
          }
          if (block.kind === "wallSet") delete block.price;
        }
      }
      imageryWarnings.push(`prices hidden by store policy (${policyFrom})`);
    }

    // Every product card the store may know something about. Prices and images
    // come off the SAME batched productByHandle node, so they are collected
    // together — but they are wanted under different conditions, which is why
    // this is one walk and two counters rather than two walks.
    const cards: Array<{ href: string; p: Record<string, unknown> }> = [];
    for (const section of next.sections) {
      for (const block of (section as { blocks?: Array<Record<string, unknown>> }).blocks ?? []) {
        if (block.kind !== "productRow") continue;
        for (const p of (block.products as Array<Record<string, unknown>>) ?? []) {
          if (typeof p.href === "string") cards.push({ href: p.href, p });
        }
      }
    }
    const wantsPrice = (p: Record<string, unknown>) => isPlaceholderPrice(p.price as string | undefined);
    const wantsImage = (p: Record<string, unknown>) => typeof p.imageUrl !== "string" || !p.imageUrl;
    const toResolve = cards.filter(({ p }) => (showPrices && wantsPrice(p)) || wantsImage(p));

    if (toResolve.length > 0) {
      const facts = await readPrices(toResolve.map((x) => handleFromHref(x.href)));
      let priced = 0;
      let pictured = 0;
      const needPrice = showPrices ? toResolve.filter(({ p }) => wantsPrice(p)).length : 0;
      const needImage = toResolve.filter(({ p }) => wantsImage(p)).length;

      for (const { href, p } of toResolve) {
        const hit = facts.get(handleFromHref(href));
        if (!hit) continue;
        if (showPrices && wantsPrice(p) && hit.display) { p.price = hit.display; priced++; }
        // The agent supplies handle, name, href and blurb — everything it can
        // know about a piece. The picture is the one thing it cannot, and the
        // card renders without it rather than failing, so an image-less product
        // row shipped looking finished. The store answers this, from the handle.
        if (wantsImage(p) && hit.imageUrl) {
          p.imageUrl = hit.imageUrl;
          if (!p.alt && hit.imageAlt) p.alt = hit.imageAlt;
          pictured++;
        }
      }
      if (needPrice > priced) {
        imageryWarnings.push(
          `${needPrice - priced} of ${needPrice} products could not be priced from Shopify; those cards keep their placeholder. Prices are never invented.`,
        );
      }
      if (needImage > pictured) {
        imageryWarnings.push(
          `${needImage - pictured} of ${needImage} product cards have no image — Shopify returned none for those handles. Check the handles are right; a card with no picture reads as broken.`,
        );
      }
    }

    // Resolve audiences to something a human can review. Stored on the artifact
    // rather than looked up at render time because the artifact lives in git and
    // should be legible in a diff without Klaviyo access — and because a size is
    // a fact about a moment, so it travels with the date it was true.
    if (next.audience.included.length > 0 || (next.audience.excluded?.length ?? 0) > 0) {
      // Correct against the store's roster BEFORE resolving. A model knows the
      // audience it wants by name and cannot know the Klaviyo id, so it fills
      // that field with something plausible; the strategy is the authority on
      // what the id actually is.
      const fixed = reconcileWithStrategy(next.audience, roster);
      for (const c of fixed.corrections) {
        console.info(`[email/audience] ${c}`);
        imageryWarnings.push(c);
      }

      // A ref the roster could not complete has nothing to send to. This is the
      // schema's "key, or type and id" rule, enforced here because here it can
      // name the roster instead of restating the rule.
      const rosterNames = roster.map((a) => `${a.key} (${a.klaviyoRef.type} ${a.klaviyoRef.id})`);
      const incomplete = [...fixed.audience.included, ...(fixed.audience.excluded ?? [])].filter(
        (r) => !r.id || !r.type,
      );
      if (incomplete.length > 0) {
        throw new Error(
          `${incomplete.length} audience reference(s) name neither a roster key the store knows nor a Klaviyo type and id: ` +
            incomplete.map((r) => JSON.stringify(r)).join(", ") +
            `. Nothing was written. The store's roster is — ${rosterNames.join("; ") || "empty"} — ` +
            `and email_plan_propose assigns one of those keys per slot; pass it as {"key": "..."}.`,
        );
      }

      const resolved = await resolveAudienceRefs(fixed.audience);
      next.audience = resolved.audience;

      // An id that survived the roster AND is unknown to a Klaviyo we actually
      // reached is a fiction, and this artifact is about to be committed and
      // handed to a reviewer who cannot check it. Refuse. Only when Klaviyo was
      // reachable — an unreachable Klaviyo makes every id unverifiable, which
      // is not evidence that any of them is wrong.
      if (resolved.reachedKlaviyo && resolved.unknown.length > 0) {
        const known = roster.map((a) => `${a.key} (${a.klaviyoRef.type} ${a.klaviyoRef.id})`);
        throw new Error(
          `Klaviyo does not know ${resolved.unknown.length === 1 ? "audience" : "audiences"} ${resolved.unknown.join(", ")}, ` +
            `and the store's strategy roster does not name ${resolved.unknown.length === 1 ? "it" : "them"} either. ` +
            `Nothing was written. Use one of the roster audiences by key — ${known.join("; ") || "the roster is empty"} — ` +
            `or call klaviyo_audiences_read for the real ids. Never invent an audience id.`,
        );
      }
    }

    await emailRepo.writeFile(path, serializeCampaign(next));

    // Write THROUGH to the index. Files stay truth (spec 22 D1) and the email
    // cron still rebuilds the whole projection from them, but without this the
    // campaign is invisible everywhere the console and calendar look — they
    // read mos_email_campaigns / mos_calendar_items, not the artifact store.
    // A campaign that renders perfectly at its preview URL and appears nowhere
    // in the UI is the worst kind of half-built: it looks like it worked.
    // Failures inside syncCampaignIndex are already swallowed and logged there,
    // because a broken index must never fail an authoring write.
    await syncCampaignIndex(getTenant().shop, next);

    const missing: string[] = [];
    // The draft Action refuses anything not yet approved (draftReadiness), so
    // an unapproved plan is a genuine blocker to staging, not a nicety.
    if (next.status !== "approved") missing.push(`plan approval (status is "${next.status}"; email.approve_plan promotes it)`);
    if (!next.subject) missing.push("subject");
    if (!next.previewText) missing.push("previewText");
    if (!next.sections.length) missing.push("sections");
    if (!next.audience.included.length) missing.push("audience");

    return {
      id: next.id,
      created: existing === null,
      status: next.status,
      repoPath: path,
      sectionCount: next.sections.length,
      readyToStage: missing.length === 0,
      missingForStaging: missing,
      ...(imageryWarnings.length > 0 ? { imageryWarnings } : {}),
      next:
        missing.length === 0
          ? "Call email_render_preview to see it, then propose_action { kind: 'klaviyo.create_campaign_draft' } to stage it for approval."
          : `Still needed before staging: ${missing.join(", ")}.`,
    };
  },
});



/**
 * Strategy authoring.
 *
 * The pack's own instructions tell the agent to "co-create email/strategy.md
 * with the owner from brand.md" — but there was no tool to write one, so the
 * standing strategy could only ever be seeded by hand. Every planning call
 * depends on it (`email_plan_propose` derives the whole calendar from it), so
 * a store with no strategy had no path to one from inside the product.
 *
 * VALIDATE-BEFORE-WRITE is the point: the content is parsed with the same
 * parser the planner uses, and a document that would not parse is rejected
 * with the parser's own error rather than saved. A malformed strategy is worse
 * than no strategy — it fails later, further from the cause.
 *
 * Repo artifact only: no external state, nothing sends. Like campaign content,
 * it is human-reviewable in the store repo and every campaign it produces
 * still goes through the Action gate.
 */
export const emailStrategyUpsert = createTool({
  id: "email_strategy_upsert",
  description:
    "Write the store's standing email strategy (strategy.md): the audiences, the weighted archetype rotation, cadence and send days, seasonal arcs and guardrails. Pass the COMPLETE markdown document — YAML front matter plus the prose body — and it is validated with the planner's own parser before saving, so a malformed strategy is rejected rather than stored. Read the current one with email_strategy_read first if you are revising. Every calendar email_plan_propose produces derives from this, so it should be co-created with the owner from brand.md, not invented.",
  inputSchema: z.object({
    content: z
      .string()
      .min(1)
      .describe(
        "The full strategy.md: YAML front matter (audiences[], archetypes[] with weights, campaignsPerMonth, sendDays[], sendTime HH:MM, optional seasonalArcs/guardrails) then --- then the markdown body.",
      ),
  }),
  execute: async ({ content }: { content: string }) => {
    // Parse FIRST. The planner will use exactly this parser, so anything it
    // rejects must never reach the store.
    let parsed;
    try {
      parsed = parseStrategy(content);
    } catch (e) {
      throw new Error(
        `strategy rejected — it would not parse, so it was NOT saved: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const root = await resolveEmailRoot(emailRepo);
    const path = strategyPathFor(root);
    const previous = await emailRepo.readFile(path);
    await emailRepo.writeFile(path, content);

    return {
      repoPath: path,
      created: previous === null,
      audiences: parsed.audiences.map((a) => ({ key: a.key, cadenceCap: a.cadenceCap })),
      archetypes: parsed.archetypes.map((a) => ({ name: a.name, weight: a.weight })),
      campaignsPerMonth: parsed.campaignsPerMonth,
      sendDays: parsed.sendDays,
      sendTime: parsed.sendTime,
      next: "Call email_plan_propose { month } to see the calendar this produces.",
    };
  },
});

export const emailStrategyRead = createTool({
  id: "email_strategy_read",
  description:
    "Read the store's current email strategy document verbatim, so it can be revised rather than rewritten from scratch. Returns null content when the store has no strategy yet.",
  inputSchema: z.object({}),
  execute: async () => {
    const root = await resolveEmailRoot(emailRepo);
    const path = strategyPathFor(root);
    const content = await emailRepo.readFile(path);
    return { repoPath: path, exists: content !== null, content };
  },
});


/**
 * Design-system seeding.
 *
 * The frame an email is assembled on comes from the store's partials (head,
 * header, footer, divider, product-card…). Those live in the store's git repo,
 * but the artifact store the runtime reads is DB-backed (see lib/email/repo.ts
 * — the git lane is deferred), so a store whose design system has never been
 * seeded cannot assemble anything: `email_render_preview` fails with "no
 * partials", and so does every draft Action.
 *
 * This is the bridge until the git write path lands. It is deliberately
 * scoped to partials rather than being a general file-write: the assembly
 * frame is the one thing that must exist before anything else works, and a
 * general "write any path" tool over the artifact store is a much wider
 * surface than this problem needs.
 */
export const emailPartialsUpsert = createTool({
  id: "email_partials_upsert",
  description:
    "Seed or update the store's email design-system partials — the shared HTML fragments (head, header, footer, divider, button, product-card) that every campaign's frame is composed from. Required before any email can be assembled or previewed. Pass a map of partial name → HTML. Klaviyo template tags are preserved verbatim; the composer only substitutes <!--PARTIAL:name--> markers.",
  inputSchema: z.object({
    partials: z
      .record(z.string(), z.string())
      .describe('Map of name → HTML, e.g. { "head": "<!DOCTYPE html>…", "header": "<table>…" }. Names match the <!--PARTIAL:name--> markers.'),
  }),
  execute: async ({ partials }: { partials: Record<string, string> }) => {
    const names = Object.keys(partials);
    if (!names.length) throw new Error("no partials supplied");
    const root = await resolveEmailRoot(emailRepo);
    const written: string[] = [];
    for (const [name, html] of Object.entries(partials)) {
      if (!/^[\w-]+$/.test(name)) throw new Error(`invalid partial name "${name}" — use letters, digits, dashes`);
      const path = `${root}/partials/${name}.html`;
      await emailRepo.writeFile(path, html);
      written.push(path);
    }
    // The frame needs these three at minimum; say so rather than letting
    // assembly fail later with a less obvious message.
    const required = ["head", "header", "footer"];
    const present = new Set(names);
    const missing = required.filter((r) => !present.has(r));
    return {
      written,
      root,
      complete: missing.length === 0,
      ...(missing.length ? { stillMissing: missing, note: `The default frame composes head + header + footer; without ${missing.join(", ")} assembly will still fail.` } : {}),
    };
  },
});

/**
 * Curated wall sets, ranked against a campaign. Read-only: it selects among
 * arrangements a curator already composed and never invents one.
 */
const wallSetsRead = createTool({
  id: "gallery_wall_sets_read",
  description:
    "Find gallery wall sets — curated multi-piece arrangements the store sells together — ranked against a campaign's theme and, for an artist drop, the artist featured. Returns each set with its room, rationale, piece count, price, artists, room photography, and a `why` explaining what earned it the rank, plus a ready-to-use `block` you can drop straight into a campaign section. Selects among sets a curator composed; it never invents an arrangement. Read-only.",
  inputSchema: z.object({
    concept: z.string().optional().describe("Campaign theme, e.g. 'autumn ochre rust and sage'."),
    artist: z.string().optional().describe("Prefer sets featuring this artist — the artist-drop case."),
    limit: z.number().int().min(1).max(5).optional(),
  }),
  outputSchema: z.object({
    sets: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        room: z.string().nullable(),
        pieceCount: z.number().nullable(),
        price: z.string().nullable(),
        artists: z.array(z.string()),
        why: z.string(),
        block: z.record(z.unknown()).describe("Drop this into a section's blocks array."),
      }),
    ),
    note: z.string(),
  }),
  execute: async (input: { concept?: string; artist?: string; limit?: number }) => {
    const all = await loadWallSets(getTenant().githubRepo);
    const ranked = rankWallSets(all, input);
    const priced = await Promise.all(ranked.map((s) => priceWallSet(s)));
    return {
      sets: ranked.map((s, i) => ({
        id: s.id,
        name: s.name,
        room: s.room_name ?? null,
        pieceCount: s.piece_count ?? null,
        price: priced[i] ?? null,
        artists: [...new Set((s.artists ?? []).map((a) => a.name).filter(Boolean))],
        why: s.why,
        block: toWallSetBlock(s, priced[i]),
      })),
      note:
        all.length === 0
          ? "No sets could be read — this is 'could not reach the file', not 'the store has none'. Check the store repo and the App installation before concluding there is nothing to show."
          : `${all.length} sets available; ${ranked.length} matched. A set with no thematic overlap is omitted rather than shown as filler.`,
    };
  },
});

const artistProfileRead = createTool({
  id: "artist_profile_read",
  description:
    "Read an artist as the store's own artist collection page presents them — portrait, location, the italic pull-quote, works count, and how many curated collections they appear in — and get a ready-to-use `artistCard` block for a campaign. Use this on every artist drop: an artist email that opens on a room shot with no artist is a product email wearing an editorial hat. Fields the store has not filled in come back in `missing`, so a thin card is legible as a content gap rather than a bug. Read-only.",
  inputSchema: z.object({
    artist: z.string().min(1).describe("Artist name or collection handle, e.g. 'Kaethe Butcher' or 'kaethe-butcher'."),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    name: z.string().nullable(),
    url: z.string().nullable(),
    location: z.string().nullable(),
    worksCount: z.number().nullable(),
    collectionsCount: z.number().nullable(),
    missing: z.array(z.string()),
    block: z.record(z.unknown()).nullable(),
    note: z.string(),
  }),
  execute: async ({ artist }: { artist: string }) => {
    const p = await readArtistProfile(artist);
    if (!p) {
      return {
        found: false, name: null, url: null, location: null,
        worksCount: null, collectionsCount: null, missing: [], block: null,
        note: `No artist collection matched "${artist}". This means Shopify has no such collection — it does NOT mean Shopify was unreachable, which raises instead.`,
      };
    }
    return {
      found: true,
      name: p.name,
      url: p.url,
      location: p.location ?? null,
      worksCount: p.worksCount ?? null,
      collectionsCount: p.collectionsCount ?? null,
      missing: p.missing,
      block: toArtistCardBlock(p),
      note: p.missing.length
        ? `Store has not filled in: ${p.missing.join(", ")}. The card renders without them; do not invent replacements.`
        : "Complete profile.",
    };
  },
});

export const emailAuthoringTools = {
  artist_profile_read: artistProfileRead,
  gallery_wall_sets_read: wallSetsRead,
  email_campaign_upsert: emailCampaignUpsert,
  email_strategy_upsert: emailStrategyUpsert,
  email_strategy_read: emailStrategyRead,
  email_partials_upsert: emailPartialsUpsert,
};
