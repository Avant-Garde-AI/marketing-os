"use client";

/**
 * AppShell — the console's fixed, labeled rail + content column (spec 13 §4).
 *
 * Replaces the hover-expand sidebar: 240px, always labeled, collapse is a
 * CLICK (persisted), never hover — no layout shift on mouse travel. Active
 * item carries the 2px gold bar + gold-quiet wash. Login renders bare.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid,
  MessageSquare,
  BookOpen,
  Palette,
  Layers,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const NAV = [
  { label: "Overview", href: "/", icon: LayoutGrid },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Brand", href: "/brand", icon: Palette },
  { label: "Playbooks", href: "/playbooks", icon: BookOpen },
  { label: "Surfaces", href: "/surfaces", icon: Layers },
  { label: "Activity", href: "/activity", icon: Clock },
];

export function AppShell({
  storeName,
  children,
}: {
  storeName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("console-rail") === "collapsed");
    setHydrated(true);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("console-rail", next ? "collapsed" : "open");
  }

  async function signOut() {
    try {
      await createClient().auth.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  // Login is the one full-editorial surface — no shell.
  // Bare surfaces: login and the public Brand Portal render without the rail.
  if (pathname.startsWith("/login") || pathname.startsWith("/brand/")) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col border-r border-hairline bg-page",
          hydrated && "transition-[width] duration-[240ms]",
          // Icon rail below md regardless of preference — labels need room.
          collapsed ? "w-16" : "w-16 md:w-60",
        )}
      >
        {/* Wordmark */}
        <div className="flex h-16 items-center gap-3 border-b border-hairline px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-inverse">
            <span className="font-display text-base italic text-gold">A</span>
          </div>
          {!collapsed && (
            <div className="hidden min-w-0 md:block">
              <div className="truncate text-[15px] font-medium leading-tight">Marketing OS</div>
              <div className="truncate text-xs text-ink-3">{storeName}</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 p-2 pt-4">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 text-[15px] transition-colors duration-[160ms]",
                  active
                    ? "bar-active bg-gold-quiet font-medium text-ink"
                    : "text-ink-2 hover:bg-gold-quiet/60 hover:text-ink",
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                {!collapsed && <span className="hidden md:inline">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Foot: collapse + sign out */}
        <div className="border-t border-hairline p-2">
          <button
            onClick={signOut}
            title={collapsed ? "Sign out" : undefined}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-[15px] text-ink-2 transition-colors duration-[160ms] hover:text-ink"
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
            {!collapsed && <span className="hidden md:inline">Sign out</span>}
          </button>
          <button
            onClick={toggle}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-[15px] text-ink-3 transition-colors duration-[160ms] hover:text-ink"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
            ) : (
              <>
                <PanelLeftClose className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                <span className="hidden md:inline">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
