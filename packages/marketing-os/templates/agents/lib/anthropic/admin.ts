/**
 * Anthropic Admin API client — manages workspaces and API keys
 * for per-merchant isolation in the managed cloud.
 *
 * Docs: https://docs.anthropic.com/en/api/administration-api
 *
 * Each merchant gets:
 *   - A workspace with a monthly spend cap
 *   - An API key scoped to that workspace
 *   - The key is set as a GitHub Actions secret on their repo
 */

const ADMIN_API_BASE = "https://api.anthropic.com/v1";

function getAdminKey(): string {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) throw new Error("ANTHROPIC_ADMIN_KEY is required for workspace management");
  return key;
}

function getOrgId(): string {
  const orgId = process.env.ANTHROPIC_ORG_ID;
  if (!orgId) throw new Error("ANTHROPIC_ORG_ID is required for workspace management");
  return orgId;
}

function adminHeaders() {
  return {
    "x-api-key": getAdminKey(),
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export interface AnthropicWorkspace {
  id: string;
  name: string;
  display_name: string;
}

export async function createWorkspace(
  name: string,
  displayName: string
): Promise<AnthropicWorkspace> {
  const orgId = getOrgId();
  const res = await fetch(`${ADMIN_API_BASE}/organizations/${orgId}/workspaces`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      name: sanitizeWorkspaceName(name),
      display_name: displayName,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create workspace: ${err}`);
  }

  return res.json();
}

export async function listWorkspaces(): Promise<AnthropicWorkspace[]> {
  const orgId = getOrgId();
  const res = await fetch(
    `${ADMIN_API_BASE}/organizations/${orgId}/workspaces?limit=100`,
    { headers: adminHeaders() }
  );

  if (!res.ok) throw new Error("Failed to list workspaces");
  const data = await res.json();
  return data.data ?? [];
}

export async function getWorkspace(workspaceId: string): Promise<AnthropicWorkspace> {
  const orgId = getOrgId();
  const res = await fetch(
    `${ADMIN_API_BASE}/organizations/${orgId}/workspaces/${workspaceId}`,
    { headers: adminHeaders() }
  );

  if (!res.ok) throw new Error("Failed to get workspace");
  return res.json();
}

export async function archiveWorkspace(workspaceId: string): Promise<void> {
  const orgId = getOrgId();
  const res = await fetch(
    `${ADMIN_API_BASE}/organizations/${orgId}/workspaces/${workspaceId}`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ is_archived: true }),
    }
  );

  if (!res.ok) throw new Error("Failed to archive workspace");
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export interface AnthropicApiKey {
  id: string;
  name: string;
  hint: string;
  api_key?: string; // Only present on creation
  workspace_id: string;
}

export async function createApiKey(
  workspaceId: string,
  name: string
): Promise<AnthropicApiKey> {
  const orgId = getOrgId();
  const res = await fetch(`${ADMIN_API_BASE}/organizations/${orgId}/api_keys`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      name,
      workspace_id: workspaceId,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create API key: ${err}`);
  }

  return res.json();
}

export async function listApiKeys(workspaceId?: string): Promise<AnthropicApiKey[]> {
  const orgId = getOrgId();
  const params = new URLSearchParams({ limit: "100" });
  if (workspaceId) params.set("workspace_id", workspaceId);

  const res = await fetch(
    `${ADMIN_API_BASE}/organizations/${orgId}/api_keys?${params}`,
    { headers: adminHeaders() }
  );

  if (!res.ok) throw new Error("Failed to list API keys");
  const data = await res.json();
  return data.data ?? [];
}

export async function disableApiKey(keyId: string): Promise<void> {
  const orgId = getOrgId();
  const res = await fetch(
    `${ADMIN_API_BASE}/organizations/${orgId}/api_keys/${keyId}`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ status: "disabled" }),
    }
  );

  if (!res.ok) throw new Error("Failed to disable API key");
}

// ---------------------------------------------------------------------------
// Provision — full merchant setup in one call
// ---------------------------------------------------------------------------

export interface ProvisionResult {
  workspace: AnthropicWorkspace;
  apiKey: AnthropicApiKey;
  apiKeyValue: string; // The actual key — only available at creation time
}

/**
 * Provision a complete Anthropic workspace + API key for a merchant.
 * Call this during cloud onboarding.
 */
export async function provisionMerchant(
  shop: string
): Promise<ProvisionResult> {
  const storeName = shop.replace(".myshopify.com", "");

  // Create workspace
  const workspace = await createWorkspace(
    `mos-${storeName}`,
    `Marketing OS — ${storeName}`
  );

  // Create API key scoped to workspace
  const apiKey = await createApiKey(workspace.id, `${storeName}-agent`);

  if (!apiKey.api_key) {
    throw new Error("API key creation did not return key value");
  }

  return {
    workspace,
    apiKey,
    apiKeyValue: apiKey.api_key,
  };
}

/**
 * Deprovision — archive workspace and disable keys on uninstall.
 */
export async function deprovisionMerchant(workspaceId: string): Promise<void> {
  // Disable all keys in this workspace
  const keys = await listApiKeys(workspaceId);
  for (const key of keys) {
    await disableApiKey(key.id);
  }

  // Archive workspace
  await archiveWorkspace(workspaceId);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sanitizeWorkspaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}
