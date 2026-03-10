"use client";

import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  category: "analytics" | "creative" | "optimization" | "integration" | "general";
  icon: string;
  inputSchema?: any;
}

interface SkillCardProps {
  metadata: SkillMetadata;
  onExecute?: (inputs: Record<string, any>) => void;
}

export function SkillCard({ metadata, onExecute }: SkillCardProps) {
  // Dynamically resolve the icon from lucide-react
  const iconName = metadata.icon.charAt(0).toUpperCase() + metadata.icon.slice(1);
  const Icon: LucideIcon = (LucideIcons as any)[iconName] || LucideIcons.Zap;

  const handleExecute = () => {
    if (onExecute) {
      // For now, just call with empty object
      // In production, this would be populated from AutoForm
      onExecute({});
    }
  };

  return (
    <Card className="flex flex-col justify-between h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">{metadata.name}</CardTitle>
            <Badge variant="outline" className="mt-1 text-xs">
              {metadata.category}
            </Badge>
          </div>
        </div>
        <CardDescription className="mt-3">
          {metadata.description}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="w-full">Execute</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{metadata.name}</DialogTitle>
              <DialogDescription>{metadata.description}</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {/* AutoForm will be generated from skill's inputSchema */}
              {/* On submit, calls onExecute(formValues) */}
              <p className="text-sm text-muted-foreground">
                Skill execution form will be generated from inputSchema
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline">Cancel</Button>
              <Button onClick={handleExecute}>Execute Skill</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}
