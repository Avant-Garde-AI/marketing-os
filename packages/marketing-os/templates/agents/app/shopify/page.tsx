"use client";

/**
 * Shopify Mini Admin — embedded panel shown inside Shopify Admin.
 *
 * Compact control center: agent status, recent activity, quick actions,
 * and links out to the full branded dashboard + Slack.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";

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
}

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

export default function ShopifyMiniAdmin() {
  const [status, setStatus] = useState<ShopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningSkill, setRunningSkill] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/shopify/status")
      .then((res) => res.json())
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleRunSkill = async (skillId: string) => {
    setRunningSkill(skillId);
    try {
      await fetch(`/api/skills/${skillId}`, { method: "POST" });
      // Refresh status after skill run
      const res = await fetch("/api/shopify/status");
      setStatus(await res.json());
    } catch {
      // Skill execution failed — UI will show idle state
    } finally {
      setRunningSkill(null);
    }
  };

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

  const activeAgents = status.agents.filter((a) => a.status === "active").length;

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Marketing OS</h1>
          <p className="text-xs text-muted-foreground">{status.storeName}</p>
        </div>
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
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between"
            disabled={runningSkill === "store-health-check"}
            onClick={() => handleRunSkill("store-health-check")}
          >
            <span>Run Store Health Check</span>
            {runningSkill === "store-health-check" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ArrowRight className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between"
            disabled={runningSkill === "ad-copy-generator"}
            onClick={() => handleRunSkill("ad-copy-generator")}
          >
            <span>Generate Ad Copy</span>
            {runningSkill === "ad-copy-generator" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ArrowRight className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between"
            disabled={runningSkill === "weekly-digest"}
            onClick={() => handleRunSkill("weekly-digest")}
          >
            <span>Send Weekly Digest</span>
            {runningSkill === "weekly-digest" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ArrowRight className="h-3 w-3" />
            )}
          </Button>
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
