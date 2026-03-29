"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, MessageSquare, Zap, GitPullRequest } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
}

const navItems: NavItem[] = [
  {
    icon: LayoutDashboard,
    label: "Dashboard",
    href: "/",
  },
  {
    icon: MessageSquare,
    label: "Chat",
    href: "/chat",
  },
  {
    icon: Zap,
    label: "Skills",
    href: "/skills",
  },
  {
    icon: GitPullRequest,
    label: "Activity",
    href: "/activity",
  },
];

export function Nav() {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "fixed left-0 top-20 h-[calc(100vh-5rem)] bg-card border-r border-border transition-all duration-300 ease-in-out z-40",
        isExpanded ? "w-64" : "w-16"
      )}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      <div className="flex flex-col gap-1 p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 px-3 py-3 transition-all duration-300",
                isActive
                  ? "text-secondary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {/* Gold accent bar for active state */}
              <div
                className={cn(
                  "absolute left-0 top-0 w-1 h-full bg-secondary transition-transform duration-300",
                  isActive ? "scale-y-100" : "scale-y-0 group-hover:scale-y-100"
                )}
                style={{ transformOrigin: "top" }}
              />
              <Icon className="h-5 w-5 flex-shrink-0" />
              <span
                className={cn(
                  "whitespace-nowrap text-xs font-semibold uppercase tracking-label transition-opacity duration-300",
                  isExpanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
