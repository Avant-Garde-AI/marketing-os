/** Only the platform gate calls execute; registration factories resolve tenant bindings per request. */
import { registerAction } from "../actions/registry";
import { hashPreview } from "../actions/hash";
import type { RuntimeAction } from "../actions/types";
import { socialRepo } from "../social/repo";
import { getTenant } from "../tenant-context";
import { getBrandInstructions } from "../../src/mastra/brand/store";
import { persistStoryboardSelection, readStoryboardReview, selectedReviewOption, storyboardSelectionParamsSchema, type StoryboardSelectionParams } from "./reviews";

export function createStoryboardSelectAction(deps: { repo: typeof socialRepo; tenant: string; readBrand: () => Promise<string> }): RuntimeAction<StoryboardSelectionParams> {
  async function load(p: StoryboardSelectionParams) {
    const brand = await deps.readBrand();
    if (!brand.trim()) throw new Error("Storyboard selection requires current brand instructions");
    return readStoryboardReview(deps.repo, p.reviewId, p.reviewHash, { tenant: deps.tenant, brand });
  }
  return {
    kind: "storyboard.select", title: "Select storyboard for realization", risk: "low", scopes: [], paramsSchema: storyboardSelectionParamsSchema,
    async preview(p) {
      const review = await load(p);
      const option = selectedReviewOption(review, p);
      return {
        summary: `Select storyboard ${p.storyboardId}: ${option.storyboard.premise}. Approval affirms this candidate and agrees: ${p.eliminationReason}`,
        rows: [
          { label: "Exact candidate", value: JSON.stringify(option.storyboard) },
          { label: "Independent critique", value: JSON.stringify(option.verdicts) },
          { label: "Agreed elimination", value: `${p.eliminatedStoryboardId}: ${p.eliminationReason}` },
          { label: "Planning context", value: review.contextHash },
          { label: "Review", value: review.reviewHash },
          { label: "Effect", value: "Record this approved narrative selection. No imagery is generated or purchased." },
        ],
        warnings: option.evidenceStatus === "hypothesis" ? ["This candidate remains a hypothesis; observed pattern acceptance has not been established."] : [],
        previewHash: hashPreview({ kind: "storyboard.select", params: p, reviewHash: review.reviewHash, contextHash: review.contextHash, option }),
      };
    },
    async execute(p) {
      const review = await load(p);
      const selection = await persistStoryboardSelection(deps.repo, review, p);
      return { ok: true, summary: `Selected storyboard ${p.storyboardId}; imagery spend remains zero`, detail: { reviewId: p.reviewId, reviewHash: selection.reviewHash, storyboardId: p.storyboardId, storyboardHash: selection.storyboardHash, selectionHash: selection.selectionHash } };
    },
  };
}
let registered = false;
export function registerStoryboardActions(): void {
  if (registered) return;
  registered = true;
  registerAction("storyboard.select", () => {
    const tenant = getTenant();
    return createStoryboardSelectAction({ repo: socialRepo, tenant: tenant.shop, readBrand: () => getBrandInstructions(tenant.shop) });
  });
}
registerStoryboardActions();
