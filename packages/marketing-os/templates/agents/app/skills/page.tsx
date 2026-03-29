export default function SkillsPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-screen-xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <span className="w-12 h-[1px] bg-secondary" />
            <span className="text-xs font-semibold text-secondary uppercase tracking-label">
              Automation
            </span>
          </div>
          <h1 className="font-display text-5xl tracking-tight mb-4">Skills Library</h1>
          <p className="text-muted-foreground font-light leading-relaxed max-w-md">
            Browse and execute marketing automation skills
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-8">
          <div className="flex gap-6 border-b border-border">
            <button className="px-4 py-3 text-xs font-semibold uppercase tracking-label text-secondary border-b-2 border-secondary -mb-[1px]">
              All
            </button>
            <button className="px-4 py-3 text-xs font-semibold uppercase tracking-label text-muted-foreground hover:text-foreground transition-colors">
              Analytics
            </button>
            <button className="px-4 py-3 text-xs font-semibold uppercase tracking-label text-muted-foreground hover:text-foreground transition-colors">
              Creative
            </button>
            <button className="px-4 py-3 text-xs font-semibold uppercase tracking-label text-muted-foreground hover:text-foreground transition-colors">
              Optimization
            </button>
          </div>
        </div>

        {/* Skills Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Skill Card */}
          <div className="group relative bg-card border border-border p-8 transition-all duration-500 hover:shadow-card-lg">
            <div className="accent-bar" />
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-muted flex items-center justify-center border border-border">
                <svg className="h-5 w-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-display text-xl tracking-tight group-hover:text-secondary transition-colors">
                  Store Health Check
                </h3>
                <span className="text-xs font-semibold text-secondary uppercase tracking-label">
                  analytics
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground font-light leading-relaxed mb-6">
              Analyze your store's recent performance across orders, traffic, and key metrics.
            </p>
            <button className="w-full bg-primary text-primary-foreground py-3 font-medium text-sm uppercase tracking-label hover:shadow-card-lg transition-all">
              Execute
            </button>
          </div>

          {/* Placeholder Card */}
          <div className="bg-card border border-border p-8 flex items-center justify-center">
            <p className="text-muted-foreground text-sm font-light italic">
              More skills coming soon...
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
