"use client";

import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface MetricCardProps {
  title: string;
  value: string | number;
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  description?: string;
  loading?: boolean;
}

export function MetricCard({
  title,
  value,
  trend,
  trendDirection = "neutral",
  description,
  loading = false,
}: MetricCardProps) {
  const getTrendIcon = () => {
    switch (trendDirection) {
      case "up":
        return <TrendingUp className="h-3 w-3" />;
      case "down":
        return <TrendingDown className="h-3 w-3" />;
      default:
        return <Minus className="h-3 w-3" />;
    }
  };

  const getTrendColor = () => {
    switch (trendDirection) {
      case "up":
        return "text-green-400";
      case "down":
        return "text-red-400";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <Card>
      {/* Gold accent bar */}
      <div className="accent-bar" />

      <CardContent className="p-8">
        <div className="text-xs font-semibold text-secondary uppercase tracking-label mb-3">
          {title}
        </div>
        {loading ? (
          <>
            <div className="font-display text-4xl tracking-tight">--</div>
            <div className="text-xs text-muted-foreground font-light mt-2">Loading...</div>
          </>
        ) : (
          <>
            <div className="font-display text-4xl tracking-tight">{value}</div>
            {trend && (
              <div className={`flex items-center gap-1.5 text-xs mt-3 ${getTrendColor()}`}>
                {getTrendIcon()}
                <span className="font-light">{trend}</span>
              </div>
            )}
            {description && !trend && (
              <div className="text-xs text-muted-foreground font-light mt-2">{description}</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
