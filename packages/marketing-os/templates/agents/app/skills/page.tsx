export default function SkillsPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Skills Library</h1>
          <p className="text-muted-foreground">
            Browse and execute marketing automation skills
          </p>
        </div>

        <div className="mb-6">
          <div className="flex gap-2 border-b">
            <button className="px-4 py-2 border-b-2 border-primary font-medium">
              All
            </button>
            <button className="px-4 py-2 text-muted-foreground hover:text-foreground">
              Analytics
            </button>
            <button className="px-4 py-2 text-muted-foreground hover:text-foreground">
              Creative
            </button>
            <button className="px-4 py-2 text-muted-foreground hover:text-foreground">
              Optimization
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-card border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-primary/10">
                <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold">Store Health Check</h3>
                <span className="text-xs text-muted-foreground">analytics</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Analyze your store's recent performance across orders, traffic, and key metrics.
            </p>
            <button className="w-full bg-primary text-primary-foreground py-2 rounded-md font-medium hover:opacity-90">
              Execute
            </button>
          </div>

          <div className="bg-card border rounded-lg p-6">
            <p className="text-muted-foreground text-sm">
              More skills coming soon...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
