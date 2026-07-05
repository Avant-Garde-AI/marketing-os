import { NextRequest, NextResponse } from "next/server";

/**
 * Proposal approval → the real async pipeline (spec 13 addendum).
 *
 * The ProposalCard's "Approve" posts here; we file the marketing-os-labeled
 * GitHub issue that triggers the agent runner (planner → design-code agent →
 * reviewed PR). Deterministic and auditable: approval is a mechanical gate,
 * not a model behavior.
 */
export async function POST(req: NextRequest) {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    return NextResponse.json(
      { error: "GitHub is not connected — set GITHUB_REPO and GITHUB_TOKEN." },
      { status: 503 }
    );
  }

  const { proposalId, target, current, proposed, rationale } = await req.json();
  if (!target || !proposed) {
    return NextResponse.json({ error: "target and proposed are required." }, { status: 400 });
  }

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `[Marketing OS] Approved change: ${target}`,
      body: [
        `## Approved storefront change (${proposalId ?? "proposal"})`,
        "",
        `**Target:** ${target}`,
        current ? `**Current:** ${current}` : "",
        `**Approved content:** ${proposed}`,
        rationale ? `**Rationale:** ${rationale}` : "",
        "",
        "Approved by the merchant in the console. Implement exactly this change",
        "on a branch and open a PR; adhere to docs/brand-design.md.",
        "",
        "---",
        "_Created by Marketing OS console (approval widget)_",
      ].filter(Boolean).join("\n"),
      labels: ["marketing-os", "approved-change"],
    }),
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `GitHub dispatch failed (${res.status}).` },
      { status: 502 }
    );
  }
  const issue = await res.json();
  return NextResponse.json({ issueNumber: issue.number, issueUrl: issue.html_url });
}
