export default function Dashboard() {
  return (
    <div className="flex min-h-screen">
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
            <p className="text-muted-foreground">
              Welcome to your Marketing OS console
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-card border rounded-lg p-6">
              <div className="text-sm text-muted-foreground mb-1">Orders (7d)</div>
              <div className="text-3xl font-bold">--</div>
              <div className="text-xs text-green-500 mt-2">Loading...</div>
            </div>
            <div className="bg-card border rounded-lg p-6">
              <div className="text-sm text-muted-foreground mb-1">Pending PRs</div>
              <div className="text-3xl font-bold">--</div>
              <div className="text-xs text-muted-foreground mt-2">Loading...</div>
            </div>
            <div className="bg-card border rounded-lg p-6">
              <div className="text-sm text-muted-foreground mb-1">Skills Run</div>
              <div className="text-3xl font-bold">--</div>
              <div className="text-xs text-muted-foreground mt-2">Loading...</div>
            </div>
            <div className="bg-card border rounded-lg p-6">
              <div className="text-sm text-muted-foreground mb-1">Conversations</div>
              <div className="text-3xl font-bold">--</div>
              <div className="text-xs text-muted-foreground mt-2">Loading...</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
              <p className="text-muted-foreground text-sm">
                Activity feed coming soon...
              </p>
            </div>
            <div className="bg-card border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Quick Skills</h2>
              <p className="text-muted-foreground text-sm">
                Quick skills coming soon...
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
