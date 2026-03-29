"use client";

/**
 * Admin Dashboard — cross-merchant management for platform operators.
 *
 * Overview stats, merchant list with status/plan, and actions
 * (pause, resume, upgrade, uninstall). Protected by ADMIN_SECRET.
 *
 * This page is NOT embedded in Shopify — it's a standalone internal tool
 * at /admin, protected by the admin secret in the request header.
 */

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Store,
  Users,
  Bot,
  Activity,
  ExternalLink,
  Pause,
  Play,
  Trash2,
  Loader2,
  Search,
  GitBranch,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Merchant {
  shop: string;
  storeName: string;
  plan: string;
  status: string;
  githubUser: string | null;
  githubRepo: string | null;
  anthropicWorkspaceId: string | null;
  anthropicKeyHint: string | null;
  agentRunsThisMonth: number;
  agentRunsTotal: number;
  installedAt: string;
  onboardedAt: string | null;
}

interface Stats {
  total: number;
  active: number;
  onboarding: number;
  totalAgentRuns: number;
}

interface AdminData {
  merchants: Merchant[];
  total: number;
  stats: Stats;
}

// ---------------------------------------------------------------------------
// Admin page
// ---------------------------------------------------------------------------

export default function AdminDashboard() {
  const [adminSecret, setAdminSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const fetchMerchants = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);

    try {
      const res = await fetch(`/api/admin/merchants?${params}`, {
        headers: { "x-admin-secret": adminSecret },
      });

      if (res.status === 401) {
        setAuthenticated(false);
        setError("Invalid admin secret");
        setLoading(false);
        return;
      }

      if (!res.ok) throw new Error("Failed to fetch");

      const json = await res.json();
      setData(json);
      setAuthenticated(true);
    } catch {
      setError("Failed to load merchants");
    } finally {
      setLoading(false);
    }
  }, [adminSecret, statusFilter]);

  const handleAction = async (
    shop: string,
    action: string,
    extra?: Record<string, string>
  ) => {
    setActionLoading(`${shop}:${action}`);
    try {
      await fetch("/api/admin/merchants", {
        method: "POST",
        headers: {
          "x-admin-secret": adminSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, shop, ...extra }),
      });
      await fetchMerchants();
    } catch {
      // Action failed
    } finally {
      setActionLoading(null);
    }
  };

  // Login gate
  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Admin Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="password"
              placeholder="Admin secret"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchMerchants()}
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button
              onClick={fetchMerchants}
              className="w-full"
              disabled={!adminSecret || loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = data?.stats;

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Marketing OS Admin</h1>
        <p className="text-sm text-muted-foreground">
          Cross-merchant management
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Store className="h-4 w-4" />
                Total Merchants
              </div>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Users className="h-4 w-4" />
                Active
              </div>
              <div className="text-2xl font-bold text-green-500">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Activity className="h-4 w-4" />
                Onboarding
              </div>
              <div className="text-2xl font-bold text-yellow-500">{stats.onboarding}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Bot className="h-4 w-4" />
                Total Agent Runs
              </div>
              <div className="text-2xl font-bold">{stats.totalAgentRuns.toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {["", "active", "onboarding", "paused", "uninstalled"].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatusFilter(s);
              setTimeout(fetchMerchants, 0);
            }}
          >
            {s || "All"}
          </Button>
        ))}
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={fetchMerchants}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Merchant List */}
      <div className="space-y-3">
        {data?.merchants.map((merchant) => (
          <Card key={merchant.shop}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                {/* Left: merchant info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold truncate">{merchant.storeName}</h3>
                    <StatusBadge status={merchant.status} />
                    <PlanBadge plan={merchant.plan} />
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{merchant.shop}</p>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {merchant.githubRepo && (
                      <a
                        href={`https://github.com/${merchant.githubRepo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        <GitBranch className="h-3 w-3" />
                        {merchant.githubRepo}
                      </a>
                    )}
                    {merchant.anthropicKeyHint && (
                      <span className="flex items-center gap-1">
                        <Bot className="h-3 w-3" />
                        Key: ...{merchant.anthropicKeyHint}
                      </span>
                    )}
                    <span>
                      Runs: {merchant.agentRunsThisMonth}/mo ({merchant.agentRunsTotal} total)
                    </span>
                    <span>
                      Installed {new Date(merchant.installedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex gap-1 flex-shrink-0">
                  {merchant.status === "active" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Pause"
                      disabled={actionLoading === `${merchant.shop}:pause`}
                      onClick={() => handleAction(merchant.shop, "pause")}
                    >
                      {actionLoading === `${merchant.shop}:pause` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  {merchant.status === "paused" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Resume"
                      disabled={actionLoading === `${merchant.shop}:resume`}
                      onClick={() => handleAction(merchant.shop, "resume")}
                    >
                      {actionLoading === `${merchant.shop}:resume` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  {merchant.githubRepo && (
                    <Button variant="ghost" size="icon" title="View repo" asChild>
                      <a
                        href={`https://github.com/${merchant.githubRepo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  {merchant.status !== "uninstalled" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Uninstall"
                      className="text-destructive hover:text-destructive"
                      disabled={actionLoading === `${merchant.shop}:uninstall`}
                      onClick={() => {
                        if (confirm(`Uninstall ${merchant.storeName}? This will archive their Anthropic workspace.`)) {
                          handleAction(merchant.shop, "uninstall");
                        }
                      }}
                    >
                      {actionLoading === `${merchant.shop}:uninstall` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {data?.merchants.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No merchants found.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, any> = {
    active: "success",
    onboarding: "warning",
    paused: "secondary",
    uninstalled: "outline",
  };
  return (
    <Badge variant={variants[status] ?? "outline"} className="text-[10px]">
      {status}
    </Badge>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const variants: Record<string, any> = {
    free: "outline",
    starter: "secondary",
    pro: "info",
    agency: "default",
  };
  return (
    <Badge variant={variants[plan] ?? "outline"} className="text-[10px]">
      {plan}
    </Badge>
  );
}
