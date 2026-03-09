# 06 — UI/UX Specification

> Marketing OS · Open Conjecture · March 2026

---

## 1. Design System

- **Framework**: Next.js 15 App Router
- **Styling**: Tailwind CSS 4 + shadcn/ui components
- **Icons**: lucide-react
- **Chat**: assistant-ui + @ai-sdk/react hooks
- **Forms**: Zod schema-driven AutoForm (from @autoform/react + @autoform/zod)
- **Theme**: Dark mode default with light mode toggle, Shopify-inspired color palette

### Color Palette

```css
/* CSS Variables (set in globals.css) */
--primary: 142 71% 45%;        /* Shopify green */
--primary-foreground: 0 0% 98%;
--background: 240 10% 4%;      /* Dark background */
--foreground: 0 0% 98%;
--card: 240 10% 6%;
--card-foreground: 0 0% 98%;
--muted: 240 4% 16%;
--muted-foreground: 240 5% 65%;
--accent: 262 83% 58%;          /* Purple accent */
--destructive: 0 84% 60%;
--border: 240 4% 16%;
```

---

## 2. Layout Structure

```
┌────────────────────────────────────────────────┐
│  Header (store name, user avatar, settings)     │
├──────┬─────────────────────────────────────────┤
│      │                                          │
│  Nav │  Main Content Area                       │
│      │                                          │
│  ──  │  (Dashboard / Chat / Skills / Activity)  │
│  🏠  │                                          │
│  💬  │                                          │
│  ⚡  │                                          │
│  📋  │                                          │
│      │                                          │
│      │                                          │
└──────┴─────────────────────────────────────────┘
```

### Navigation Sidebar

Collapsed by default (icon-only), expandable on hover:

| Icon | Label | Route | Description |
|------|-------|-------|-------------|
| `LayoutDashboard` | Dashboard | `/` | Metrics overview, recent activity |
| `MessageSquare` | Chat | `/chat` | Agent conversation interface |
| `Zap` | Skills | `/skills` | Browsable skill library |
| `GitPullRequest` | Activity | `/activity` | PR feed and agent action log |

### Header

- Left: Marketing OS logo + store name
- Right: User email (from Supabase session), settings gear icon, sign out

---

## 3. Page Specifications

### 3.1 Dashboard (`/`)

The landing page after login. Shows a snapshot of store activity and Marketing OS status.

**Layout**: 2-column grid (responsive → single column on mobile)

**Components**:

1. **Welcome Card** — Greeting with store name, quick action buttons ("Ask a question", "Run a skill", "View PRs")

2. **Metrics Row** — 3-4 `MetricCard` components showing:
   - Total orders (last 7d) — from Shopify Admin API
   - Pending PRs — from GitHub API
   - Skills executed (last 7d) — from Supabase activity_log
   - Agent conversations (last 7d) — from Supabase

3. **Recent Activity** — Last 5 items from the activity log (PR created, skill run, etc.) with "View all" link to `/activity`

4. **Quick Skills** — Top 3 most-used skill cards with "Execute" buttons

```typescript
// app/page.tsx
import { MetricCard } from "@/components/metric-card";
import { SkillCard } from "@/components/skill-card";
import { ActivityItem } from "@/components/activity-item";

export default async function Dashboard() {
  // Server component — fetch data server-side
  return (
    <div className="space-y-8">
      <WelcomeCard />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Orders (7d)" value={42} trend="+12%" />
        <MetricCard title="Pending PRs" value={2} />
        <MetricCard title="Skills Run" value={8} />
        <MetricCard title="Conversations" value={15} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <RecentActivity />
        <QuickSkills />
      </div>
    </div>
  );
}
```

### 3.2 Chat (`/chat`)

The primary interaction surface. Full-height chat interface using assistant-ui.

**Layout**: Full-width centered chat container (max-w-3xl), full viewport height minus header/nav.

**Components**:

1. **Chat Container** — assistant-ui `Thread` component with custom styling
2. **Message Bubbles** — User messages (right-aligned), Agent messages (left-aligned, with markdown rendering)
3. **Tool Result Cards** — When the agent calls tools, results render as structured cards:
   - Performance data → table or chart card
   - PR creation → PR card with link and status badge
   - Ad copy generation → copyable text blocks with variant labels
4. **Input Bar** — Text input with send button, attachment support (for uploading images/docs)

```typescript
// app/chat/page.tsx
"use client";

import { MarketingChat } from "@/components/chat/marketing-chat";

export default function ChatPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <MarketingChat />
    </div>
  );
}
```

```typescript
// components/chat/marketing-chat.tsx
"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Thread } from "@assistant-ui/react";
import { AssistantChatTransport } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react";

export function MarketingChat() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/chat",
    }),
  });

  return (
    <Thread
      runtime={runtime}
      welcome={{
        message: "Hi! I'm your Marketing OS agent. Ask me about your store, generate ad copy, or request improvements.",
        suggestions: [
          { text: "How is my store performing this week?" },
          { text: "Generate ad copy for my best-selling product" },
          { text: "Run a store health check" },
        ],
      }}
    />
  );
}
```

### 3.3 Skills Library (`/skills`)

Browsable grid of available skills with category filtering and execution.

**Layout**: Category tabs across top, card grid below.

**Components**:

1. **Category Tabs** — All | Analytics | Creative | Optimization | Integration
2. **Skill Cards** — Grid of `SkillCard` components (3 columns on desktop, 1 on mobile)
3. **Execution Dialog** — Modal with AutoForm generated from the skill's Zod inputSchema

```typescript
// components/skill-card.tsx
"use client";

import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import * as LucideIcons from "lucide-react";
import type { SkillMetadata } from "@/src/mastra/skills/_registry";

interface SkillCardProps {
  metadata: SkillMetadata;
  onExecute: (inputs: Record<string, any>) => void;
}

export function SkillCard({ metadata, onExecute }: SkillCardProps) {
  const Icon = (LucideIcons as any)[
    metadata.icon.charAt(0).toUpperCase() + metadata.icon.slice(1)
  ] || LucideIcons.Zap;

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
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
            {/* AutoForm generated from skill's inputSchema */}
            {/* On submit, calls onExecute(formValues) */}
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}
```

### 3.4 Activity Feed (`/activity`)

Timeline of all agent actions, PR events, and skill executions.

**Layout**: Single column feed, newest first.

**Components**:

1. **Filter Tabs** — All | PRs | Skills | Scheduled
2. **PR Cards** — For each PR, show:
   - Title, branch name, status badge (open/merged/closed)
   - Diff summary (files changed, insertions, deletions)
   - Skill that triggered it
   - Approve/Reject buttons (proxies to GitHub API)
   - Link to GitHub PR
3. **Skill Execution Cards** — For inline skill results, show:
   - Skill name, execution time, status
   - Expandable result preview

```typescript
// components/pr-card.tsx
"use client";

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitPullRequest, Check, X, ExternalLink } from "lucide-react";

interface PRCardProps {
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
    open: "bg-yellow-500/10 text-yellow-500",
    merged: "bg-purple-500/10 text-purple-500",
    closed: "bg-red-500/10 text-red-500",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div className="flex items-center gap-3">
          <GitPullRequest className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">{props.title}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              #{props.number} · {props.branch} · Skill: {props.skill}
            </p>
          </div>
        </div>
        <Badge className={statusColors[props.status]}>{props.status}</Badge>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{props.filesChanged} files changed</span>
          <span className="text-green-500">+{props.additions}</span>
          <span className="text-red-500">-{props.deletions}</span>
        </div>
      </CardContent>
      {props.status === "open" && (
        <CardFooter className="gap-2">
          <Button size="sm" onClick={props.onApprove}>
            <Check className="h-4 w-4 mr-1" /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={props.onReject}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={props.url} target="_blank" rel="noopener">
              <ExternalLink className="h-4 w-4 mr-1" /> View on GitHub
            </a>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
```

### 3.5 Login (`/login`)

Minimal login page with Supabase magic link.

**Layout**: Centered card on dark background.

**Flow**: Enter email → click "Send magic link" → check email → click link → redirected to dashboard.

---

## 4. Auth Flow (Middleware)

```typescript
// agents/middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();

  // Redirect unauthenticated users to login
  if (!session && !request.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect authenticated users away from login
  if (session && request.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)"],
};
```

---

## 5. API Routes

### 5.1 Chat Route

```typescript
// agents/app/api/chat/route.ts
import { mastra } from "@/src/mastra";
import { chatRoute } from "@mastra/ai-sdk";

export const POST = chatRoute({
  mastra,
  agent: "marketing-agent",
});
```

### 5.2 Skill Execution Route

```typescript
// agents/app/api/skills/[skillId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { mastra } from "@/src/mastra";
import { getSkill } from "@/src/mastra/skills/_registry";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  const { skillId } = await params;
  const skill = getSkill(skillId);

  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = skill.inputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await skill.tool.execute({
    context: parsed.data,
    mastra,
  });

  return NextResponse.json(result);
}
```

### 5.3 GitHub Webhook Route

```typescript
// agents/app/api/webhooks/github/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const event = req.headers.get("x-github-event");

  // Verify webhook signature
  const secret = process.env.GITHUB_WEBHOOK_SECRET!;
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex")}`;

  if (signature !== expected) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Handle PR events
  if (event === "pull_request") {
    await supabase.from("activity_log").insert({
      type: "pr",
      action: payload.action,
      pr_number: payload.pull_request.number,
      pr_title: payload.pull_request.title,
      pr_url: payload.pull_request.html_url,
      pr_status: payload.pull_request.merged
        ? "merged"
        : payload.pull_request.state,
      branch: payload.pull_request.head.ref,
      metadata: {
        additions: payload.pull_request.additions,
        deletions: payload.pull_request.deletions,
        changed_files: payload.pull_request.changed_files,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
```

---

## 6. Responsive Design

| Breakpoint | Layout |
|-----------|--------|
| `< 768px` (mobile) | Nav hidden (hamburger menu), single column, chat full-width |
| `768–1024px` (tablet) | Nav collapsed (icons), 2-column grid |
| `> 1024px` (desktop) | Nav expanded on hover, 3-4 column grids |

All pages should be fully functional on mobile. The Chat page is the most critical mobile experience.
