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
  const statusColors = {
    open: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    merged: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    closed: "bg-red-500/10 text-red-500 border-red-500/20",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="flex items-center gap-3 flex-1">
          <GitPullRequest className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">{props.title}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              #{props.number} · {props.branch} · Skill: {props.skill}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={statusColors[props.status]}
        >
          {props.status}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{props.filesChanged} files changed</span>
          <span className="text-green-500">+{props.additions}</span>
          <span className="text-red-500">-{props.deletions}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Created {new Date(props.createdAt).toLocaleDateString()}
        </p>
      </CardContent>
      {props.status === "open" && (
        <CardFooter className="gap-2 flex-wrap">
          <Button size="sm" onClick={props.onApprove}>
            <Check className="h-4 w-4 mr-1" /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={props.onReject}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={props.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" /> View on GitHub
            </a>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
