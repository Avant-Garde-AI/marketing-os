export default function ActivityPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-screen-xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <span className="w-12 h-[1px] bg-secondary" />
            <span className="text-xs font-semibold text-secondary uppercase tracking-label">
              History
            </span>
          </div>
          <h1 className="font-display text-5xl tracking-tight mb-4">Activity Feed</h1>
          <p className="text-muted-foreground font-light leading-relaxed max-w-md">
            Track all AI-generated changes and skill executions
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-8">
          <div className="flex gap-6 border-b border-border">
            <button className="px-4 py-3 text-xs font-semibold uppercase tracking-label text-secondary border-b-2 border-secondary -mb-[1px]">
              All
            </button>
            <button className="px-4 py-3 text-xs font-semibold uppercase tracking-label text-muted-foreground hover:text-foreground transition-colors">
              PRs
            </button>
            <button className="px-4 py-3 text-xs font-semibold uppercase tracking-label text-muted-foreground hover:text-foreground transition-colors">
              Skills
            </button>
            <button className="px-4 py-3 text-xs font-semibold uppercase tracking-label text-muted-foreground hover:text-foreground transition-colors">
              Scheduled
            </button>
          </div>
        </div>

        {/* Activity List */}
        <div className="space-y-4">
          <div className="bg-card border border-border p-10 text-center">
            <div className="flex items-center justify-center gap-4 mb-6">
              <span className="w-8 h-[1px] bg-secondary" />
              <span className="text-xs font-semibold text-secondary uppercase tracking-label">
                No Activity
              </span>
              <span className="w-8 h-[1px] bg-secondary" />
            </div>
            <p className="text-muted-foreground font-light leading-relaxed">
              No activity yet. Run a skill or make a change to see activity here.
            </p>
          </div>
        </div>

        {/* Footer accent */}
        <div className="flex items-center justify-center gap-4 mt-16 pt-8 border-t border-border">
          <span className="w-12 h-[1px] bg-border" />
          <span className="font-script text-2xl text-muted-foreground">Avant-Garde</span>
          <span className="w-12 h-[1px] bg-border" />
        </div>
      </div>
    </div>
  );
}
