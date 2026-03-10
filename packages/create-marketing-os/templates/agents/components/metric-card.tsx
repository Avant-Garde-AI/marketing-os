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
        return "text-green-500";
      case "down":
        return "text-red-500";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-sm text-muted-foreground mb-1">{title}</div>
        {loading ? (
          <>
            <div className="text-3xl font-bold">--</div>
            <div className="text-xs text-muted-foreground mt-2">Loading...</div>
          </>
        ) : (
          <>
            <div className="text-3xl font-bold">{value}</div>
            {trend && (
              <div className={`flex items-center gap-1 text-xs mt-2 ${getTrendColor()}`}>
                {getTrendIcon()}
                <span>{trend}</span>
              </div>
            )}
            {description && !trend && (
              <div className="text-xs text-muted-foreground mt-2">{description}</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
