"use client";

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitPullRequest, Check, X, ExternalLink } from "lucide-react";

export interface PRCardProps {
  title: string;
  number: number;
  status: "open" | "merged" | "closed";
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  skill: string;
  url: string;
  createdAt: string;
  onApprove?: () => void;
  onReject?: () => void;
}

export function PRCard(props: PRCardProps) {
  const statusVariant = {
    open: "warning" as const,
    merged: "gold" as const,
    closed: "destructive" as const,
  };

  return (
    <Card>
      {/* Gold accent bar */}
      <div className="accent-bar" />

      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
        <div className="flex items-center gap-4 flex-1">
          <div className="w-10 h-10 bg-muted flex items-center justify-center border border-border">
            <GitPullRequest className="h-4 w-4 text-secondary" strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="group-hover:text-secondary transition-colors">
              {props.title}
            </CardTitle>
            <p className="text-xs text-muted-foreground font-light mt-2">
              #{props.number} · {props.branch} · Skill: {props.skill}
            </p>
          </div>
        </div>
        <Badge variant={statusVariant[props.status]}>
          {props.status}
        </Badge>
      </CardHeader>

      <CardContent>
        <div className="flex gap-6 text-xs">
          <span className="text-muted-foreground font-light">{props.filesChanged} files changed</span>
          <span className="text-green-400">+{props.additions}</span>
          <span className="text-red-400">-{props.deletions}</span>
        </div>
        <p className="text-xs text-muted-foreground font-light mt-3 uppercase tracking-label">
          Created {new Date(props.createdAt).toLocaleDateString()}
        </p>
      </CardContent>

      {props.status === "open" && (
        <CardFooter className="gap-3 flex-wrap border-t border-border pt-6">
          <Button size="sm" onClick={props.onApprove}>
            <Check className="h-4 w-4 mr-2" /> Approve
          </Button>
          <Button size="sm" variant="brand-outline" onClick={props.onReject}>
            <X className="h-4 w-4 mr-2" /> Close
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={props.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" /> View on GitHub
            </a>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
