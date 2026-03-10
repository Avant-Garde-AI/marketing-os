// agents/src/mastra/tools/pr-status.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const prStatusTool = createTool({
  id: "pr-status",
  description: "Get the status of a pull request by PR number",
  inputSchema: z.object({
    prNumber: z.number().describe("The pull request number to check"),
  }),
  outputSchema: z.object({
    number: z.number(),
    title: z.string(),
    state: z.string(),
    url: z.string(),
    author: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    mergeable: z.boolean().nullable(),
    checks_status: z.string().nullable(),
    review_status: z.string(),
  }),
  execute: async ({ context }) => {
    const repo = process.env.GITHUB_REPO!;
    const token = process.env.GITHUB_TOKEN!;

    // Get PR details
    const prRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${context.prNumber}`,
      {
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!prRes.ok) {
      throw new Error(`Failed to fetch PR #${context.prNumber}: ${prRes.statusText}`);
    }

    const pr = await prRes.json();

    // Get review status
    const reviewsRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${context.prNumber}/reviews`,
      {
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reviews = await reviewsRes.json();
    let reviewStatus = "no-reviews";

    if (Array.isArray(reviews) && reviews.length > 0) {
      const latestReview = reviews[reviews.length - 1];
      reviewStatus = latestReview.state.toLowerCase(); // approved, changes_requested, commented
    }

    // Get checks status
    const checksRes = await fetch(
      `https://api.github.com/repos/${repo}/commits/${pr.head.sha}/check-runs`,
      {
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    let checksStatus = null;
    if (checksRes.ok) {
      const checks = await checksRes.json();
      if (checks.total_count > 0) {
        const allSuccess = checks.check_runs.every((run: any) => run.conclusion === "success");
        const anyFailure = checks.check_runs.some((run: any) => run.conclusion === "failure");
        const anyPending = checks.check_runs.some((run: any) => run.status === "in_progress" || run.status === "queued");

        if (anyFailure) checksStatus = "failure";
        else if (anyPending) checksStatus = "pending";
        else if (allSuccess) checksStatus = "success";
      }
    }

    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.html_url,
      author: pr.user.login,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      mergeable: pr.mergeable,
      checks_status: checksStatus,
      review_status: reviewStatus,
    };
  },
});
