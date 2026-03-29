export default function Dashboard() {
  return (
    <div className="flex min-h-screen">
      <main className="flex-1 p-8">
        <div className="max-w-screen-xl mx-auto">
          {/* Eyebrow + Heading */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-6">
              <span className="w-12 h-[1px] bg-secondary" />
              <span className="text-xs font-semibold text-secondary uppercase tracking-label">
                Marketing OS
              </span>
            </div>
            <h1 className="font-display text-5xl tracking-tight mb-4">Dashboard</h1>
            <p className="text-muted-foreground font-light leading-relaxed max-w-md">
              Welcome to your AI-powered marketing operations console
            </p>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            <div className="group relative bg-card border border-border p-8 transition-all duration-500 hover:shadow-card-lg">
              <div className="accent-bar" />
              <div className="text-xs font-semibold text-secondary uppercase tracking-label mb-3">
                Orders (7d)
              </div>
              <div className="font-display text-4xl tracking-tight mb-2">--</div>
              <div className="text-xs text-muted-foreground font-light">Loading...</div>
            </div>

            <div className="group relative bg-card border border-border p-8 transition-all duration-500 hover:shadow-card-lg">
              <div className="accent-bar" />
              <div className="text-xs font-semibold text-secondary uppercase tracking-label mb-3">
                Pending PRs
              </div>
              <div className="font-display text-4xl tracking-tight mb-2">--</div>
              <div className="text-xs text-muted-foreground font-light">Loading...</div>
            </div>

            <div className="group relative bg-card border border-border p-8 transition-all duration-500 hover:shadow-card-lg">
              <div className="accent-bar" />
              <div className="text-xs font-semibold text-secondary uppercase tracking-label mb-3">
                Skills Run
              </div>
              <div className="font-display text-4xl tracking-tight mb-2">--</div>
              <div className="text-xs text-muted-foreground font-light">Loading...</div>
            </div>

            <div className="group relative bg-card border border-border p-8 transition-all duration-500 hover:shadow-card-lg">
              <div className="accent-bar" />
              <div className="text-xs font-semibold text-secondary uppercase tracking-label mb-3">
                Conversations
              </div>
              <div className="font-display text-4xl tracking-tight mb-2">--</div>
              <div className="text-xs text-muted-foreground font-light">Loading...</div>
            </div>
          </div>

          {/* Content Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="group relative bg-card border border-border p-10 transition-all duration-500 hover:shadow-card-lg">
              <div className="accent-bar" />
              <div className="flex items-center gap-4 mb-6">
                <span className="w-8 h-[1px] bg-secondary" />
                <span className="text-xs font-semibold text-secondary uppercase tracking-label">
                  Activity
                </span>
              </div>
              <h2 className="font-display text-2xl italic tracking-tight mb-4">
                Recent Activity
              </h2>
              <p className="text-muted-foreground text-sm font-light leading-relaxed">
                Activity feed coming soon...
              </p>
            </div>

            <div className="group relative bg-card border border-border p-10 transition-all duration-500 hover:shadow-card-lg">
              <div className="accent-bar" />
              <div className="flex items-center gap-4 mb-6">
                <span className="w-8 h-[1px] bg-secondary" />
                <span className="text-xs font-semibold text-secondary uppercase tracking-label">
                  Quick Actions
                </span>
              </div>
              <h2 className="font-display text-2xl italic tracking-tight mb-4">
                Quick Skills
              </h2>
              <p className="text-muted-foreground text-sm font-light leading-relaxed">
                Quick skills coming soon...
              </p>
            </div>
          </div>

          {/* Footer Script Accent */}
          <div className="flex items-center justify-center gap-4 mt-16 pt-8 border-t border-border">
            <span className="w-12 h-[1px] bg-border" />
            <span className="font-script text-2xl text-muted-foreground">Avant-Garde</span>
            <span className="w-12 h-[1px] bg-border" />
          </div>
        </div>
      </main>
    </div>
  );
}
