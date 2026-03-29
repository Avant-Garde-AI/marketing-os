"use client";

export default function ChatPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-2xl">
          {/* Eyebrow */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <span className="w-12 h-[1px] bg-secondary" />
            <span className="text-xs font-semibold text-secondary uppercase tracking-label">
              AI Agent
            </span>
            <span className="w-12 h-[1px] bg-secondary" />
          </div>

          <h1 className="font-display text-4xl tracking-tight mb-4">
            Chat with your <span className="italic">Marketing Agent</span>
          </h1>
          <p className="text-muted-foreground font-light leading-relaxed mb-8">
            Ask questions about your store, generate ad copy, or request improvements.
          </p>

          <div className="bg-card border border-border p-10">
            <p className="text-muted-foreground font-light">
              Chat interface coming soon...
              <br />
              <span className="text-xs uppercase tracking-label mt-4 block text-secondary">
                Will use assistant-ui + Mastra chatRoute
              </span>
            </p>
          </div>

          {/* Footer accent */}
          <div className="flex items-center justify-center gap-4 mt-12">
            <span className="w-8 h-[1px] bg-border" />
            <span className="font-script text-xl text-muted-foreground">Agentic Commerce</span>
            <span className="w-8 h-[1px] bg-border" />
          </div>
        </div>
      </div>
    </div>
  );
}
