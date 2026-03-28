"use client";

/**
 * Shopify Mini Admin — embedded panel shown inside Shopify Admin.
 *
 * Two states:
 *   1. Onboarding — merchant hasn't connected GitHub yet (no theme repo)
 *   2. Control center — agent status, activity, quick actions
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bot,
  Activity,
  ExternalLink,
  MessageSquare,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  GitBranch,
  Rocket,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentStatus {
  id: string;
  name: string;
  status: "active" | "idle" | "error";
  lastRun: string | null;
}

interface ConnectionStatus {
  shopify: boolean;
  slack: boolean;
  github: boolean;
}

interface ActivityItem {
  id: string;
  type: string;
  summary: string;
  timestamp: string;
}

interface ShopStatus {
  shop: string;
  storeName: string;
  connections: ConnectionStatus;
  agents: AgentStatus[];
  recentActivity: ActivityItem[];
  dashboardUrl: string;
  onboarded: boolean;
  repoUrl?: string;
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: "active" | "idle" | "error" }) {
  const colors = {
    active: "bg-green-500 shadow-green-500/50 shadow-sm",
    idle: "bg-muted-foreground/40",
    error: "bg-red-500 shadow-red-500/50 shadow-sm",
  };
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />
  );
}

function ConnectionRow({
  label,
  connected,
}: {
  label: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {connected ? (
        <Badge variant="success" className="text-[10px] px-1.5 py-0">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Connected
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
          <XCircle className="h-3 w-3 mr-1" />
          Not connected
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding view
// ---------------------------------------------------------------------------

function OnboardingView({
  storeName,
  onComplete,
}: {
  storeName: string;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<"intro" | "github" | "working" | "done">("intro");
  const [githubToken, setGithubToken] = useState("");
  const [githubOrg, setGithubOrg] = useState("");
  const [result, setResult] = useState<{
    repo: string;
    repoUrl: string;
    themeAssetsCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOnboard = async () => {
    setStep("working");
    setError(null);

    try {
      const res = await fetch("/api/shopify/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubToken,
          githubOrg: githubOrg || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.details ?? data.error ?? "Onboarding failed");
      }

      const data = await res.json();
      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("github");
    }
  };

  if (step === "intro") {
    return (
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
            <Rocket className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-lg font-bold mb-2">Welcome to Marketing OS</h1>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Let&apos;s set up your AI agent fleet for {storeName}. We&apos;ll
            pull your theme, create a GitHub repo, and scaffold your agents.
          </p>
          <Button onClick={() => setStep("github")} className="gap-2">
            <GitBranch className="h-4 w-4" />
            Get Started
          </Button>
        </div>

        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">What happens next:</h3>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-primary font-mono text-xs mt-0.5">1.</span>
                Connect your GitHub account
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-mono text-xs mt-0.5">2.</span>
                We pull your live Shopify theme automatically
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-mono text-xs mt-0.5">3.</span>
                A new repo is created with your theme + Marketing OS agents
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-mono text-xs mt-0.5">4.</span>
                GitHub Actions runs your agent fleet on autopilot
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "github") {
    return (
      <div className="p-4 max-w-xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-bold">Connect GitHub</h1>
          <p className="text-xs text-muted-foreground mt-1">
            We need a GitHub token to create the repo and push your theme.
          </p>
        </div>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                GitHub Personal Access Token
              </label>
              <Input
                type="password"
                placeholder="ghp_..."
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Needs <code>repo</code> scope. Create one at github.com/settings/tokens
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                GitHub Organization (optional)
              </label>
              <Input
                placeholder="your-org (leave blank for personal)"
                value={githubOrg}
                onChange={(e) => setGithubOrg(e.target.value)}
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
                {error}
              </div>
            )}

            <Button
              onClick={handleOnboard}
              disabled={!githubToken}
              className="w-full gap-2"
            >
              <Rocket className="h-4 w-4" />
              Set Up My Store
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "working") {
    return (
      <div className="p-4 max-w-xl mx-auto">
        <div className="text-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">Setting up your store...</h2>
          <p className="text-sm text-muted-foreground">
            Pulling theme, creating repo, scaffolding agents.
            <br />
            This takes about 30 seconds.
          </p>
        </div>
      </div>
    );
  }

  // step === "done"
  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      <div className="text-center py-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 mb-4">
          <CheckCircle2 className="h-6 w-6 text-green-500" />
        </div>
        <h2 className="text-lg font-bold mb-2">You&apos;re all set!</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Your theme repo is live with Marketing OS agents ready to go.
        </p>
      </div>

      {result && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Repository</span>
              <a
                href={result.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                {result.repo}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Theme files</span>
              <span className="text-sm">{result.themeAssetsCount} assets</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Agents</span>
              <Badge variant="success" className="text-[10px]">Scaffolded</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      <Button onClick={onComplete} className="w-full">
        Go to Control Center
        <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Control center view (post-onboarding)
// ---------------------------------------------------------------------------

function ControlCenterView({ status }: { status: ShopStatus }) {
  const [runningSkill, setRunningSkill] = useState<string | null>(null);

  const handleRunSkill = async (skillId: string) => {
    setRunningSkill(skillId);
    try {
      await fetch(`/api/skills/${skillId}`, { method: "POST" });
    } catch {
      // Skill execution failed
    } finally {
      setRunningSkill(null);
    }
  };

  const activeAgents = status.agents.filter((a) => a.status === "active").length;

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Marketing OS</h1>
          <p className="text-xs text-muted-foreground">{status.storeName}</p>
        </div>
        <div className="flex gap-2">
          {status.repoUrl && (
            <Button variant="ghost" size="sm" asChild>
              <a
                href={status.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <GitBranch className="h-3 w-3" />
              </a>
            </Button>
          )}
          {status.dashboardUrl && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={status.dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Full Dashboard
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Agent Status */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Agents
            <Badge variant="secondary" className="text-[10px] ml-auto">
              {activeAgents} / {status.agents.length} active
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="space-y-2">
            {status.agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={agent.status} />
                  <span className="text-sm">{agent.name}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {agent.lastRun
                    ? `Last run ${new Date(agent.lastRun).toLocaleDateString()}`
                    : "Never run"}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Connections */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Connections
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <ConnectionRow label="Shopify" connected={status.connections.shopify} />
          <ConnectionRow label="Slack" connected={status.connections.slack} />
          <ConnectionRow label="GitHub" connected={status.connections.github} />
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 space-y-2">
          {[
            { id: "store-health-check", label: "Run Store Health Check" },
            { id: "ad-copy-generator", label: "Generate Ad Copy" },
            { id: "weekly-digest", label: "Send Weekly Digest" },
          ].map(({ id, label }) => (
            <Button
              key={id}
              variant="outline"
              size="sm"
              className="w-full justify-between"
              disabled={runningSkill === id}
              onClick={() => handleRunSkill(id)}
            >
              <span>{label}</span>
              {runningSkill === id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowRight className="h-3 w-3" />
              )}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {status.recentActivity.length > 0 ? (
            <div className="space-y-2">
              {status.recentActivity.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.summary}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(item.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No recent activity. Run a skill to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page — routes between onboarding and control center
// ---------------------------------------------------------------------------

export default function ShopifyMiniAdmin() {
  const [status, setStatus] = useState<ShopStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = () => {
    fetch("/api/shopify/status")
      .then((res) => res.json())
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Unable to load status. Check your configuration.
      </div>
    );
  }

  // Show onboarding if GitHub isn't connected yet
  if (!status.onboarded) {
    return (
      <OnboardingView
        storeName={status.storeName}
        onComplete={fetchStatus}
      />
    );
  }

  return <ControlCenterView status={status} />;
}
