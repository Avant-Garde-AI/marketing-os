/**
 * POST /api/shopify/onboard
 *
 * Cloud-automated onboarding: pulls the merchant's live theme via
 * Shopify Admin API (asset endpoints), creates a GitHub repo,
 * scaffolds Marketing OS into it, and sets up GitHub Actions secrets.
 *
 * This replaces the CLI `marketing-os create` flow for managed cloud users.
 * The merchant never touches a terminal.
 *
 * Requires: shopify_shop cookie (set by OAuth) + GitHub access token.
 */

import { NextRequest, NextResponse } from "next/server";
import { getShopifySession } from "@/lib/shopify/session";
import { getGitHubConnection, updateRepoName } from "@/lib/github/connection";
import { provisionMerchant } from "@/lib/anthropic/admin";
import { createMerchant, updateMerchant } from "@/lib/merchants/store";

const API_VERSION = "2024-10";

// ---------------------------------------------------------------------------
// 1. Pull theme assets via Shopify Admin API (no CLI needed)
// ---------------------------------------------------------------------------
async function pullThemeAssets(
  shop: string,
  token: string
): Promise<{ key: string; value: string }[]> {
  // Get the live theme
  const themesRes = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/themes.json`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (!themesRes.ok) throw new Error("Failed to fetch themes");

  const { themes } = await themesRes.json();
  const liveTheme = themes.find((t: any) => t.role === "main");
  if (!liveTheme) throw new Error("No live theme found");

  // Get all assets for the live theme
  const assetsRes = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/themes/${liveTheme.id}/assets.json`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (!assetsRes.ok) throw new Error("Failed to fetch theme assets");

  const { assets } = await assetsRes.json();

  // Fetch each asset's content (Shopify requires individual requests)
  const assetContents: { key: string; value: string }[] = [];
  for (const asset of assets) {
    try {
      const assetRes = await fetch(
        `https://${shop}/admin/api/${API_VERSION}/themes/${liveTheme.id}/assets.json?asset[key]=${encodeURIComponent(asset.key)}`,
        { headers: { "X-Shopify-Access-Token": token } }
      );
      if (assetRes.ok) {
        const { asset: fullAsset } = await assetRes.json();
        assetContents.push({
          key: fullAsset.key,
          value: fullAsset.value ?? "",
        });
      }
    } catch {
      // Skip assets that fail to fetch (binary files, etc.)
    }
  }

  return assetContents;
}

// ---------------------------------------------------------------------------
// 2. Create GitHub repo and push theme + scaffold via GitHub API
// ---------------------------------------------------------------------------
async function createRepoAndPush(
  githubToken: string,
  repoName: string,
  orgOrUser: string,
  themeAssets: { key: string; value: string }[],
  shop: string
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // Create repo
  const createUrl = orgOrUser.includes("/")
    ? `https://api.github.com/orgs/${orgOrUser}/repos`
    : "https://api.github.com/user/repos";

  const createRes = await fetch(createUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: repoName,
      private: true,
      description: `Shopify theme + Marketing OS for ${shop}`,
      auto_init: true,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create repo: ${err}`);
  }

  const repo = await createRes.json();
  const fullName = repo.full_name;

  // Push theme assets as a tree via GitHub Git Data API
  // Step 1: Get the current commit SHA (from auto-init)
  const refRes = await fetch(
    `https://api.github.com/repos/${fullName}/git/ref/heads/main`,
    { headers }
  );
  const refData = await refRes.json();
  const baseCommitSha = refData.object.sha;

  // Step 2: Create blobs for each file
  const treeItems: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string;
  }> = [];

  for (const asset of themeAssets) {
    if (!asset.value) continue;

    const blobRes = await fetch(
      `https://api.github.com/repos/${fullName}/git/blobs`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: asset.value,
          encoding: "utf-8",
        }),
      }
    );
    if (blobRes.ok) {
      const blob = await blobRes.json();
      treeItems.push({
        path: asset.key,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }
  }

  // Add Marketing OS scaffold files
  const scaffoldFiles = getScaffoldFiles(shop);
  for (const file of scaffoldFiles) {
    const blobRes = await fetch(
      `https://api.github.com/repos/${fullName}/git/blobs`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: file.content,
          encoding: "utf-8",
        }),
      }
    );
    if (blobRes.ok) {
      const blob = await blobRes.json();
      treeItems.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }
  }

  // Step 3: Create tree
  const treeRes = await fetch(
    `https://api.github.com/repos/${fullName}/git/trees`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_tree: baseCommitSha,
        tree: treeItems,
      }),
    }
  );
  const tree = await treeRes.json();

  // Step 4: Create commit
  const commitRes = await fetch(
    `https://api.github.com/repos/${fullName}/git/commits`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "Initial commit: Shopify theme + Marketing OS scaffold",
        tree: tree.sha,
        parents: [baseCommitSha],
      }),
    }
  );
  const commit = await commitRes.json();

  // Step 5: Update ref
  await fetch(
    `https://api.github.com/repos/${fullName}/git/refs/heads/main`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha: commit.sha }),
    }
  );

  return fullName;
}

// ---------------------------------------------------------------------------
// 3. Minimal scaffold files for cloud onboarding
// ---------------------------------------------------------------------------
function getScaffoldFiles(shop: string): { path: string; content: string }[] {
  const storeName = shop.replace(".myshopify.com", "");

  return [
    {
      path: "CLAUDE.md",
      content: `# Marketing OS Agent Instructions

You are the Marketing OS agent for the ${storeName} Shopify store.

## Context
- Store: ${shop}
- Read /docs/brand-voice.md for brand guidelines
- Read /docs/product-knowledge.md for product details

## Rules
- Only modify theme files (never /agents/ directory)
- Create feature branches for changes
- Include before/after descriptions in PR body
- Follow the brand voice guidelines
`,
    },
    {
      path: "docs/brand-voice.md",
      content: `# Brand Voice Guide — ${storeName}

<!-- Fill in your brand's tone, voice, and style guidelines -->

## Tone
-

## Key Messages
-

## Words to Use / Avoid
-
`,
    },
    {
      path: "docs/product-knowledge.md",
      content: `# Product Knowledge — ${storeName}

<!-- Fill in your product catalog details, USPs, and FAQs -->
`,
    },
    {
      path: "marketing-os.config.json",
      content: JSON.stringify(
        {
          version: "1.0",
          store: { url: shop, name: storeName },
          integrations: { shopify: true },
          managedCloud: true,
        },
        null,
        2
      ),
    },
    {
      path: ".github/workflows/marketing-os-agent.yml",
      content: `name: Marketing OS Agent
on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]
  schedule:
    - cron: '0 13 * * 1'  # Monday 9am ET

jobs:
  agent:
    if: >
      (github.event_name == 'issues' && contains(github.event.label.name, 'marketing-os')) ||
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@marketing-os')) ||
      github.event_name == 'schedule'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          max_turns: 20
          model: claude-sonnet-4-20250514
`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const shop = request.cookies.get("shopify_shop")?.value;
  if (!shop) {
    return NextResponse.json(
      { error: "Not authenticated with Shopify" },
      { status: 401 }
    );
  }

  const session = await getShopifySession(shop);
  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "No Shopify access token found" },
      { status: 401 }
    );
  }

  // Get GitHub token from stored OAuth connection (not from request body)
  const ghConn = await getGitHubConnection(shop);
  if (!ghConn?.githubToken) {
    return NextResponse.json(
      { error: "GitHub not connected. Complete GitHub OAuth first." },
      { status: 400 }
    );
  }

  // Optional: allow overriding the GitHub org from the request body
  let githubOrg = "";
  try {
    const body = await request.json();
    githubOrg = body.githubOrg ?? "";
  } catch {
    // No body is fine — we'll use the user's personal account
  }

  const storeName = shop.replace(".myshopify.com", "");
  const repoName = `${storeName}-theme`;

  try {
    // 0. Create merchant record
    await createMerchant({
      shop,
      storeName,
      shopifyScopes: session.scope ?? "",
    });

    // 1. Pull theme from Shopify
    const assets = await pullThemeAssets(shop, session.accessToken);

    // 2. Create repo, push theme + scaffold
    const fullRepoName = await createRepoAndPush(
      ghConn.githubToken,
      repoName,
      githubOrg,
      assets,
      shop
    );

    // 3. Update the stored connection with the repo name
    await updateRepoName(shop, fullRepoName);

    // 4. Provision Anthropic workspace + API key (cloud mode only)
    let anthropicKeyHint = "";
    if (process.env.ANTHROPIC_ADMIN_KEY && process.env.ANTHROPIC_ORG_ID) {
      const provision = await provisionMerchant(shop);

      // Set the workspace-scoped API key as a GitHub Actions secret
      await setGitHubSecret(
        ghConn.githubToken,
        fullRepoName,
        "ANTHROPIC_API_KEY",
        provision.apiKeyValue
      );

      anthropicKeyHint = provision.apiKey.hint ?? "";

      // Update merchant record with Anthropic details
      await updateMerchant(shop, {
        anthropicWorkspaceId: provision.workspace.id,
        anthropicKeyId: provision.apiKey.id,
        anthropicKeyHint: anthropicKeyHint,
      });
    }

    // 5. Mark merchant as active
    await updateMerchant(shop, {
      githubUser: ghConn.githubUser,
      githubRepo: fullRepoName,
      status: "active",
      onboardedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      repo: fullRepoName,
      repoUrl: `https://github.com/${fullRepoName}`,
      themeAssetsCount: assets.length,
      anthropicProvisioned: !!process.env.ANTHROPIC_ADMIN_KEY,
      message: `Created ${fullRepoName} with ${assets.length} theme files + Marketing OS scaffold`,
    });
  } catch (error) {
    console.error("Onboarding error:", error);
    return NextResponse.json(
      {
        error: "Onboarding failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Set a GitHub Actions secret via GitHub API
// ---------------------------------------------------------------------------
async function setGitHubSecret(
  githubToken: string,
  repo: string,
  secretName: string,
  secretValue: string
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
  };

  // Get the repo's public key for secret encryption
  const keyRes = await fetch(
    `https://api.github.com/repos/${repo}/actions/secrets/public-key`,
    { headers }
  );
  if (!keyRes.ok) throw new Error("Failed to get repo public key");
  const { key, key_id } = await keyRes.json();

  // Encrypt the secret using libsodium (tweetnacl in browser/node)
  // We use the Web Crypto API approach for Node.js compatibility
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(secretValue);
  const keyBytes = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));

  // Use tweetnacl-style sealed box encryption
  // In production, use the @octokit/plugin-create-or-update-text-file or
  // tweetnacl-js. For now, we use a simpler base64 approach that works
  // with GitHub's API when the repo has sodium available.
  const { default: sodium } = await import("tweetnacl");
  const { default: sealedbox } = await import("tweetnacl-sealedbox-js");

  const encrypted = sealedbox.seal(messageBytes, keyBytes);
  const encryptedBase64 = btoa(String.fromCharCode(...encrypted));

  // Set the secret
  const setRes = await fetch(
    `https://api.github.com/repos/${repo}/actions/secrets/${secretName}`,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        encrypted_value: encryptedBase64,
        key_id,
      }),
    }
  );

  if (!setRes.ok) {
    const err = await setRes.text();
    throw new Error(`Failed to set GitHub secret: ${err}`);
  }
}
