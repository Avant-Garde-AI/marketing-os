/**
 * The assemble binding (WS3-R4) — wires the vendored email-assembly package
 * to a campaign's current state: skeleton resolution, section mapping, brand
 * tokens, and the deterministic html+sha the Actions hash against.
 *
 * Skeleton resolution order (04 §3 + 06):
 *   1. email/templates/skeletons/{skeletonRef}/skeleton.html (ingested)
 *   2. composed from the scaffolded design system: email/partials/* + a slot
 *      frame derived from the campaign's sections (the 06 scaffold's
 *      cold-start answer)
 * Neither present → a clear error telling the agent to scaffold or ingest.
 *
 * Image URLs: surface sections use their Klaviyo-hosted imageUrl once the
 * draft Action has uploaded them; before upload (ungated previews) they fall
 * back to this deployment's design-surface export route — deterministic, so
 * preview hashes are stable. Assembly runs strict (Klaviyo-host allowlist)
 * only when every surface section carries an imageUrl: the draft Action's
 * execute re-assembles AFTER uploads, so what lands in Klaviyo always passed
 * strict; pre-upload previews degrade honestly.
 *
 * Block-vocabulary seam: campaign.md html sections carry blocks as loose
 * objects keyed `type` (the pack's convention); email-assembly's vocabulary
 * keys `kind`. Normalized here — the ONE place the two shapes meet.
 */

import { createHash } from "node:crypto";
import { assembleEmail, composePartials } from "../email-assembly";
import type { AssembleEmailInput, AssemblyIssue, EmailSection } from "../email-assembly/types";
import { compileDesignTokens } from "../design-surfaces/dtcg";
import { getBrandDoc } from "../../src/mastra/brand/store";
import { getTenant } from "../tenant-context";
import { emailRepo } from "./repo";
import { parseSkeleton, skeletonHtmlPath, skeletonPath } from "./artifacts";
import type { AssembledEmail } from "./actions";
import type { CampaignSection, EmailCampaign } from "./types";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Load + compile the tenant's DESIGN.md tokens (the design-surfaces tool's
 * degrade-to-empty posture: no brand tokens beats a failed assembly). The
 * compiledAt stamp is pinned so token compilation stays deterministic. */
async function loadTokens(): Promise<Record<string, unknown>> {
  try {
    const doc = await getBrandDoc(getTenant().shop, "DESIGN.md");
    if (!doc?.content) return {};
    return compileDesignTokens(doc.content, {
      compiledAt: "1970-01-01T00:00:00.000Z",
    }) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const DEFAULT_FRAME = (slots: string[]) =>
  [
    "<!--PARTIAL:head-->",
    "<body>",
    '<div class="email-wrapper"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td align="center">',
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container">',
    "  <!--PARTIAL:header-->",
    ...slots.map((s) => `  <tr><td>{{slot:${s}}}</td></tr>`),
    "  <!--PARTIAL:footer-->",
    "</table>",
    "</td></tr></table></div>",
    "</body>",
    "</html>",
  ].join("\n");

async function resolveSkeleton(campaign: EmailCampaign): Promise<{ html: string; source: string }> {
  const ingested = await emailRepo.readFile(skeletonHtmlPath(campaign.skeletonRef));
  if (ingested !== null) return { html: ingested, source: `skeleton:${campaign.skeletonRef}` };

  // Scaffold path: compose the default frame from the store's partials.
  const partialPaths = await emailRepo.list("email/partials/");
  if (partialPaths.length > 0) {
    const partials: Record<string, string> = {};
    for (const p of partialPaths) {
      const name = p.replace(/^email\/partials\//, "").replace(/\.html$/, "");
      const content = await emailRepo.readFile(p);
      if (content !== null) partials[name] = content;
    }
    const slots = [...new Set(campaign.sections.map((s) => s.slot))];
    const { html, report } = composePartials(DEFAULT_FRAME(slots), partials);
    if (report.missing.length > 0) {
      throw new Error(
        `default frame needs partials [${report.missing.join(", ")}] — the scaffold is incomplete; re-run scaffoldEmailSystem`,
      );
    }
    return { html, source: "scaffold-frame" };
  }

  throw new Error(
    `no skeleton "${campaign.skeletonRef}" and no email/partials/ — scaffold the email design system or ingest a reference template first`,
  );
}

function exportRouteUrl(section: Extract<CampaignSection, { type: "surface" }>): string | null {
  const base = process.env.MOS_AGENTS_PUBLIC_URL;
  if (!base || !section.surfaceId) return null;
  const boardQ = section.boardName ? `?board=${encodeURIComponent(section.boardName)}` : "";
  return `${base.replace(/\/$/, "")}/api/design-surfaces/export/${section.surfaceId}${boardQ}`;
}

/** Pack block ({type: "paragraph", …}) → assembly block ({kind: …}). Blocks
 * already keyed `kind` pass through. */
function normalizeBlock(block: Record<string, unknown>): Record<string, unknown> {
  if ("kind" in block) return block;
  const { type, ...rest } = block;
  return { kind: type, ...rest };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : fallback;
}

function issues(list: AssemblyIssue[]): string[] {
  return list.map((i) => `${i.code}: ${i.message}`);
}

/** The EmailActionDeps.assemble binding. Deterministic: same campaign state
 * (+ same DESIGN.md + same skeleton) → byte-identical html. */
export async function assembleCampaign(campaign: EmailCampaign): Promise<AssembledEmail> {
  const [skeletonSrc, tokens] = await Promise.all([resolveSkeleton(campaign), loadTokens()]);

  const sections: EmailSection[] = [];
  let allUploaded = true;
  for (const s of campaign.sections) {
    if (s.type === "surface") {
      const url = s.imageUrl ?? exportRouteUrl(s);
      if (!s.imageUrl) allUploaded = false;
      if (!url) {
        throw new Error(
          `surface section "${s.slot}" has neither imageUrl nor surfaceId — compose/export its board first`,
        );
      }
      sections.push({
        slot: s.slot,
        type: "surface",
        imageUrl: url,
        alt: s.alt,
        // Exported @2x board dimensions; compose-template geometry rides the
        // section payload when the drafting flow authored it (04 §2 default:
        // hero 600×750 → 1200×1500 export).
        width: num(s.payload?.exportWidth, 1200),
        height: num(s.payload?.exportHeight, 1500),
      });
    } else {
      sections.push({
        slot: s.slot,
        type: "html",
        block: s.blocks.map(normalizeBlock),
      } as EmailSection);
    }
  }

  const slotNames = [...skeletonSrc.html.matchAll(/\{\{slot:([\w-]+)\}\}/g)].map((m) => m[1]!);
  const skeletonVersion = await (async () => {
    const raw = await emailRepo.readFile(skeletonPath(campaign.skeletonRef));
    return raw === null ? 0 : parseSkeleton(raw).version;
  })();

  const input: AssembleEmailInput = {
    skeleton: { html: skeletonSrc.html, slots: slotNames.map((name) => ({ name })) },
    sections,
    tokens,
    meta: {
      // Envelope guards live in the Actions (draftReadiness); the ungated
      // preview path still renders with placeholders so a human can look.
      subject: campaign.subject ?? "(subject not chosen yet)",
      previewText: campaign.previewText ?? "(preview text not written yet)",
      skeletonVersion: String(skeletonVersion),
    },
    options: { strict: allUploaded },
  };

  const { html, report } = assembleEmail(input);
  return {
    html,
    htmlSha256: sha256(html),
    report: { ok: report.ok, errors: issues(report.errors), warnings: issues(report.warnings) },
  };
}
